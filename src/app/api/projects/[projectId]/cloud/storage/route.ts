import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import {
  buildPublicCdnUrl,
  copyBucketObject,
  createPresignedStorageUrl,
  createProjectBucket,
  deleteBucketObject,
  deleteProjectBucket,
  ensureProjectStorageBucket,
  getBucketlineS3GatewayEndpoint,
  getCredentialsForProjectBucket,
  isBucketlineConfigured,
  listBucketObjects,
  listProjectBuckets,
  normalizeObjectKey,
  putBucketObject,
} from "@/lib/cloud/bucketline";
import { errorResponse, notFound } from "@/lib/http";
import { getDecryptedSecrets, getProject, getProjectCloud } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ projectId: string }> };

const noStore = { "Cache-Control": "no-store" };

async function requireReadyCloudProject(projectId: string, viewerId: string) {
  const project = await getProject(projectId, viewerId);
  if (!project) return { error: notFound() };
  const cloud = await getProjectCloud(project.id);
  if (cloud?.status !== "ready") {
    return {
      error: Response.json(
        { error: "Turn on Cognix Cloud first before managing storage buckets." },
        { status: 409, headers: noStore },
      ),
    };
  }
  return { project };
}

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const guard = await requireReadyCloudProject(projectId, viewer.id);
    if ("error" in guard) return guard.error;
    const { project } = guard;

    const url = new URL(request.url);
    const requestedBucket = url.searchParams.get("bucket")?.trim() || null;
    const prefix = url.searchParams.get("prefix")?.trim() || "";

    if (!isBucketlineConfigured()) {
      const secrets = await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>));
      return Response.json(
        {
          configured: false,
          s3Endpoint: secrets.S3_ENDPOINT ?? null,
          activeBucket: secrets.S3_BUCKET ?? null,
          buckets: [],
          objects: [],
          folders: [],
          prefix: "",
        },
        { headers: noStore },
      );
    }

    const [buckets, secrets] = await Promise.all([
      listProjectBuckets(project.id),
      getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
    ]);

    const activeBucketName = secrets.S3_BUCKET ?? buckets[0]?.name ?? null;
    const selectedBucket =
      (requestedBucket ? buckets.find((b) => b.name === requestedBucket) : undefined) ??
      (activeBucketName ? buckets.find((b) => b.name === activeBucketName) : undefined) ??
      buckets[0] ??
      null;

    if (!selectedBucket) {
      return Response.json(
        {
          configured: true,
          s3Endpoint: getBucketlineS3GatewayEndpoint(),
          activeBucket: null,
          selectedBucket: null,
          buckets: [],
          objects: [],
          folders: [],
          prefix: "",
        },
        { headers: noStore },
      );
    }

    const creds = await getCredentialsForProjectBucket(project, selectedBucket, {
      makeActive: !secrets.S3_BUCKET,
    });
    const listing = await listBucketObjects(creds, { prefix, delimiter: "/" });

    return Response.json(
      {
        configured: true,
        s3Endpoint: getBucketlineS3GatewayEndpoint(),
        activeBucket: secrets.S3_BUCKET ?? selectedBucket.name,
        selectedBucket: selectedBucket.name,
        buckets,
        prefix: listing.prefix,
        folders: listing.folders,
        objects: listing.objects,
        truncated: listing.truncated,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("provision"),
    accessMode: z.enum(["private", "public"]).optional(),
  }),
  z.object({
    action: z.literal("create_bucket"),
    suffix: z.string().trim().min(1).max(48),
    accessMode: z.enum(["private", "public"]).default("private"),
    makeActive: z.boolean().optional().default(true),
  }),
  z.object({
    action: z.literal("use_bucket"),
    bucket: z.string().min(3).max(63),
  }),
  z.object({
    action: z.literal("rotate_credentials"),
    bucket: z.string().min(3).max(63),
  }),
  z.object({
    action: z.literal("delete_bucket"),
    bucket: z.string().min(3).max(63),
    force: z.boolean().optional().default(false),
  }),
  z.object({
    action: z.literal("create_folder"),
    bucket: z.string().min(3).max(63),
    folderPath: z.string().trim().min(1).max(400),
  }),
  z.object({
    action: z.literal("delete_object"),
    bucket: z.string().min(3).max(63),
    key: z.string().min(1).max(800),
  }),
  z.object({
    action: z.literal("copy_object"),
    bucket: z.string().min(3).max(63),
    sourceKey: z.string().min(1).max(800),
    destinationKey: z.string().min(1).max(800),
  }),
  z.object({
    action: z.literal("presign_url"),
    bucket: z.string().min(3).max(63),
    key: z.string().min(1).max(800),
    method: z.enum(["GET", "PUT"]).optional().default("GET"),
    expiresInSeconds: z.number().int().min(60).max(604_800).optional().default(86_400),
  }),
]);

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const guard = await requireReadyCloudProject(projectId, viewer.id);
    if ("error" in guard) return guard.error;
    const { project } = guard;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const bucketName = String(form.get("bucket") ?? "").trim();
      const prefix = String(form.get("prefix") ?? "").trim().replace(/^\/+/, "");
      if (!(file instanceof File)) {
        return Response.json({ error: "Choose a file to upload." }, { status: 400, headers: noStore });
      }
      if (file.size > 50 * 1024 * 1024) {
        return Response.json({ error: "Files must be 50 MB or smaller." }, { status: 400, headers: noStore });
      }
      const buckets = await listProjectBuckets(project.id);
      const bucket = buckets.find((b) => b.name === bucketName) ?? buckets[0];
      if (!bucket) {
        return Response.json({ error: "Create or provision a bucket before uploading files." }, { status: 404, headers: noStore });
      }
      const creds = await getCredentialsForProjectBucket(project, bucket, { makeActive: false });
      const cleanName = file.name.replace(/[\\/]+/g, "_");
      const key = normalizeObjectKey(prefix ? `${prefix.replace(/\/+$/, "")}/${cleanName}` : cleanName);
      const uploaded = await putBucketObject(creds, {
        key,
        body: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
      });
      return Response.json({ uploaded }, { headers: noStore });
    }

    const input = actionSchema.parse(await request.json());

    if (input.action === "provision") {
      const result = await ensureProjectStorageBucket(project, { accessMode: input.accessMode });
      return Response.json(result, { headers: noStore });
    }

    if (input.action === "create_bucket") {
      const bucket = await createProjectBucket(project.id, {
        suffix: input.suffix,
        accessMode: input.accessMode,
      });
      await getCredentialsForProjectBucket(project, bucket, { makeActive: input.makeActive });
      return Response.json({ bucket }, { headers: noStore });
    }

    const buckets = await listProjectBuckets(project.id);
    const targetBucket = buckets.find((b) => b.name === input.bucket);
    if (!targetBucket) {
      return Response.json({ error: `Bucket "${input.bucket}" was not found in this project.` }, { status: 404, headers: noStore });
    }

    if (input.action === "use_bucket") {
      await getCredentialsForProjectBucket(project, targetBucket, { makeActive: true });
      return Response.json({ activeBucket: targetBucket.name, bucket: targetBucket }, { headers: noStore });
    }

    if (input.action === "rotate_credentials") {
      const secrets = await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>));
      const isCurrentActive = !secrets.S3_BUCKET || secrets.S3_BUCKET === targetBucket.name;
      await getCredentialsForProjectBucket(project, targetBucket, {
        forceRotate: true,
        makeActive: isCurrentActive,
      });
      return Response.json({ rotated: true, bucket: targetBucket.name }, { headers: noStore });
    }

    if (input.action === "delete_bucket") {
      const deleted = await deleteProjectBucket(project.id, targetBucket.name, { force: input.force });
      const remaining = buckets.filter((b) => b.name !== targetBucket.name);
      if (remaining[0]) {
        await getCredentialsForProjectBucket(project, remaining[0], { makeActive: true }).catch(() => undefined);
      }
      return Response.json(deleted, { headers: noStore });
    }

    const creds = await getCredentialsForProjectBucket(project, targetBucket, { makeActive: false });

    if (input.action === "create_folder") {
      const cleanFolder = normalizeObjectKey(input.folderPath).replace(/\/+$/, "");
      const placeholderKey = `${cleanFolder}/.keep`;
      await putBucketObject(creds, {
        key: placeholderKey,
        body: Buffer.from(""),
        contentType: "text/plain",
      });
      return Response.json({ folder: `${cleanFolder}/` }, { headers: noStore });
    }

    if (input.action === "delete_object") {
      const result = await deleteBucketObject(creds, input.key);
      return Response.json(result, { headers: noStore });
    }

    if (input.action === "copy_object") {
      const result = await copyBucketObject(creds, input.sourceKey, input.destinationKey);
      return Response.json(result, { headers: noStore });
    }

    const presigned = createPresignedStorageUrl(creds, {
      method: input.method,
      key: input.key,
      expiresInSeconds: input.expiresInSeconds,
    });
    const publicUrl =
      input.method === "GET" && targetBucket.accessMode === "public"
        ? buildPublicCdnUrl(targetBucket.cdnEndpoint, input.key)
        : null;

    return Response.json(
      {
        url: publicUrl ?? presigned.url,
        presignedUrl: presigned.url,
        publicCdnUrl: publicUrl,
        expiresInSeconds: presigned.expiresInSeconds,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
