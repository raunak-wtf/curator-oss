import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { ensureProjectStorageBucket, isBucketlineConfigured } from "@/lib/cloud/bucketline";
import { ensureProjectNeonDatabase, isNeonApiConfigured } from "@/lib/cloud/neon";
import { syncProjectEnv } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { isSecretsEncryptionConfigured } from "@/lib/secrets-crypto";
import { getProject, getProjectCloud, listSecretNames, updateProjectCloud, upsertSecret } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const [cloud, secrets] = await Promise.all([
      getProjectCloud(project.id),
      listSecretNames(project.id),
    ]);
    const secretNames = secrets.map((s) => s.name);
    return Response.json(
      {
        enabled: cloud?.status === "ready",
        enabledAt: cloud?.status === "ready" ? cloud.updatedAt : null,
        neonApiConfigured: isNeonApiConfigured(),
        storageApiConfigured: isBucketlineConfigured(),
        neonProjectId: cloud?.neonProjectId ?? null,
        neonRegion: cloud?.neonRegion ?? null,
        lastError: cloud?.lastError ?? null,
        secretNames,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());

    let cloud = await updateProjectCloud(project.id, {
      status: enabled ? "ready" : "disabled",
      storageEnabled: enabled,
      authEnabled: enabled,
      lastError: null,
    });

    let warning: string | null = null;
    const provisioned: string[] = [];

    if (enabled) {
      if (!isSecretsEncryptionConfigured) {
        warning =
          "Cognix Cloud is on, but the server cannot store encrypted secrets yet. Add COGNIX_SECRETS_KEY to the Cognix server environment.";
      } else {
        const names = new Set((await listSecretNames(project.id)).map((secret) => secret.name));
        if (!names.has("BETTER_AUTH_SECRET")) {
          await upsertSecret(project.id, "BETTER_AUTH_SECRET", randomBytes(32).toString("base64url"), "cloud");
          provisioned.push("BETTER_AUTH_SECRET");
        }

        if (isNeonApiConfigured()) {
          try {
            const neonResult = await ensureProjectNeonDatabase(project);
            if (neonResult.created) provisioned.push("DATABASE_URL", "DIRECT_URL");
            cloud = (await getProjectCloud(project.id)) ?? cloud;
          } catch (error) {
            const detail = error instanceof Error ? error.message : "Could not provision Cloud Database.";
            cloud = await updateProjectCloud(project.id, { lastError: detail });
            warning = `Cognix Cloud is on, but automatic database provisioning failed: ${detail}`;
          }
        } else if (!names.has("DATABASE_URL")) {
          warning =
            "Cognix Cloud is on, but automatic database provisioning is not configured on this server yet.";
        }

        if (isBucketlineConfigured()) {
          try {
            const storageResult = await ensureProjectStorageBucket(project);
            if (storageResult.created) {
              provisioned.push(
                "S3_ENDPOINT",
                "S3_REGION",
                "S3_BUCKET",
                "S3_ACCESS_KEY_ID",
                "S3_SECRET_ACCESS_KEY",
                "S3_CDN_URL",
              );
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : "Could not provision Cloud Storage bucket.";
            warning = warning ? `${warning} ${detail}` : `Cognix Cloud is on, but automatic Storage provisioning failed: ${detail}`;
          }
        }

        if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);
      }
    }

    return Response.json(
      {
        enabled: cloud.status === "ready",
        enabledAt: cloud.status === "ready" ? cloud.updatedAt : null,
        neonApiConfigured: isNeonApiConfigured(),
        storageApiConfigured: isBucketlineConfigured(),
        neonProjectId: cloud.neonProjectId,
        neonRegion: cloud.neonRegion,
        provisioned,
        warning,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
