import { createHash, createHmac } from "node:crypto";
import { syncProjectEnv } from "@/lib/daytona";
import { getDecryptedSecrets, upsertSecret } from "@/lib/store";
import type { Project } from "@/lib/types";

const DEFAULT_BUCKETLINE_BASE_URL = "https://cloudnest-cdn-vault.lovable.app";
const MAX_OBJECT_BYTES = 50 * 1024 * 1024; // Hard 50 MB Bucketline limit
const RETRY_DELAYS_MS = [350, 1_000, 2_200] as const;

export type BucketAccessMode = "private" | "public";

export type BucketlineBucket = {
  id: string;
  name: string;
  namespace: string;
  accessMode: BucketAccessMode;
  createdAt: string;
  objectCount: number;
  truncatedCount: boolean;
  cdnEndpoint: string;
  s3Endpoint: string;
};

export type BucketlineCredentials = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  s3Endpoint: string;
  s3Region: string;
  cdnUrl?: string;
  accessMode?: BucketAccessMode;
};

export type StorageObjectItem = {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  etag: string;
  cdnUrl: string | null;
};

export type ListObjectsResult = {
  prefix: string;
  folders: string[];
  objects: StorageObjectItem[];
  truncated: boolean;
  nextContinuationToken: string | null;
};

const provisioningLocks = new Map<string, Promise<{ bucket: BucketlineBucket; created: boolean }>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getBucketlineBaseUrl(): string {
  return (process.env.BUCKETLINE_BASE_URL?.trim() || DEFAULT_BUCKETLINE_BASE_URL).replace(/\/+$/, "");
}

export function getBucketlineS3GatewayEndpoint(): string {
  return `${getBucketlineBaseUrl()}/api/public/s3`;
}

export function isBucketlineConfigured(): boolean {
  return Boolean(process.env.BUCKETLINE_API_KEY?.trim());
}

function getBucketlineApiKey(): string {
  const key = process.env.BUCKETLINE_API_KEY?.trim();
  if (!key) {
    throw new Error("Cognix Cloud Storage provisioning is not configured on this server.");
  }
  return key;
}

export function scrubStorageSecrets(text: string): string {
  const apiKey = process.env.BUCKETLINE_API_KEY?.trim();
  let scrubbed = text.replace(/\bbk_[A-Za-z0-9_-]{12,}\b/g, "bk_[REDACTED]");
  if (apiKey) scrubbed = scrubbed.replaceAll(apiKey, "bk_[REDACTED]");
  return scrubbed;
}

/** Deterministic per-project prefix (`cx-<id8>-`) so one Cognix project can never access another's buckets. */
export function projectBucketPrefix(projectId: string): string {
  const hex8 = projectId.replace(/-/g, "").toLowerCase().slice(0, 8);
  if (!/^[a-f0-9]{8}$/.test(hex8)) {
    throw new Error("Invalid project identifier for storage bucket isolation.");
  }
  return `cx-${hex8}-`;
}

export function projectOwnsBucket(projectId: string, bucketName: string): boolean {
  return bucketName.toLowerCase().startsWith(projectBucketPrefix(projectId));
}

export function assertProjectOwnsBucket(projectId: string, bucketName: string): void {
  if (!projectOwnsBucket(projectId, bucketName)) {
    throw new Error(`Bucket "${bucketName}" does not belong to this project.`);
  }
}

export function formatProjectBucketName(projectId: string, rawSuffix = "storage"): string {
  const prefix = projectBucketPrefix(projectId);
  const cleanedSuffix = rawSuffix
    .toLowerCase()
    .trim()
    .replace(/^cx-[a-f0-9]{8}-/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = (cleanedSuffix || "storage").slice(0, 63 - prefix.length).replace(/-+$/g, "") || "storage";
  const full = `${prefix}${suffix}`;
  if (full.length < 3 || full.length > 63 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(full)) {
    throw new Error("Bucket suffix must contain lowercase letters, numbers, or hyphens.");
  }
  return full;
}

function parseBucketlineError(rawText: string, status: number): string {
  const trimmed = rawText.trim();
  if (!trimmed) return `Storage API returned HTTP ${status}.`;
  try {
    const parsed = JSON.parse(trimmed) as { error?: string; message?: string };
    if (parsed.error) return scrubStorageSecrets(parsed.error);
    if (parsed.message) return scrubStorageSecrets(parsed.message);
  } catch {
    // May be an S3 XML envelope (<Error><Code>...</Code><Message>...</Message></Error>)
  }
  const code = trimmed.match(/<Code>([^<]+)<\/Code>/i)?.[1];
  const msg = trimmed.match(/<Message>([^<]+)<\/Message>/i)?.[1];
  if (code || msg) {
    return scrubStorageSecrets([code, msg].filter(Boolean).join(": "));
  }
  return scrubStorageSecrets(trimmed.slice(0, 300));
}

function normalizeBucket(raw: Record<string, unknown>): BucketlineBucket {
  const baseUrl = getBucketlineBaseUrl();
  const name = String(raw.name ?? "");
  const namespace = String(raw.namespace ?? "");
  const rawCdn = typeof raw.cdnEndpoint === "string" && raw.cdnEndpoint
    ? raw.cdnEndpoint.startsWith("http")
      ? raw.cdnEndpoint
      : `${baseUrl}${raw.cdnEndpoint.startsWith("/") ? "" : "/"}${raw.cdnEndpoint}`
    : `${baseUrl}/api/public/cdn/${namespace}/${name}/`;

  return {
    id: String(raw.id ?? name),
    name,
    namespace,
    accessMode: raw.access_mode === "public" || raw.accessMode === "public" ? "public" : "private",
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    objectCount: Number(raw.objectCount ?? 0),
    truncatedCount: Boolean(raw.truncatedCount),
    cdnEndpoint: rawCdn.replace(/\/+$/, ""),
    s3Endpoint: getBucketlineS3GatewayEndpoint(),
  };
}

async function operationsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getBucketlineApiKey();
  const url = `${getBucketlineBaseUrl()}/api/public/v1${path}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(25_000),
    });

    if ([429, 502, 503, 504].includes(response.status) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(parseBucketlineError(rawText, response.status));
    }
    return (rawText ? JSON.parse(rawText) : {}) as T;
  }

  throw new Error("Storage Operations API did not respond in time.");
}

export async function listProjectBuckets(projectId: string): Promise<BucketlineBucket[]> {
  const data = await operationsRequest<{ buckets?: Record<string, unknown>[] }>("/list-buckets", {
    method: "GET",
  });
  return (data.buckets ?? [])
    .map(normalizeBucket)
    .filter((bucket) => projectOwnsBucket(projectId, bucket.name))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createProjectBucket(
  projectId: string,
  options: { suffix?: string; accessMode?: BucketAccessMode } = {},
): Promise<BucketlineBucket> {
  const name = formatProjectBucketName(projectId, options.suffix || "storage");
  const accessMode: BucketAccessMode = options.accessMode === "public" ? "public" : "private";
  const raw = await operationsRequest<Record<string, unknown>>("/create-bucket", {
    method: "POST",
    body: JSON.stringify({ name, accessMode }),
  });
  return normalizeBucket(raw);
}

export async function deleteProjectBucket(
  projectId: string,
  bucketName: string,
  options: { force?: boolean } = {},
): Promise<{ deleted: boolean; bucket: string }> {
  assertProjectOwnsBucket(projectId, bucketName);
  return operationsRequest<{ deleted: boolean; bucket: string }>("/delete-bucket", {
    method: "DELETE",
    body: JSON.stringify({ bucket: bucketName, force: Boolean(options.force) }),
  });
}

export async function mintBucketS3Credentials(
  projectId: string,
  bucketName: string,
  label = "cognix-cloud",
): Promise<BucketlineCredentials> {
  assertProjectOwnsBucket(projectId, bucketName);
  const raw = await operationsRequest<{
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    s3Endpoint?: string;
    s3Region?: string;
  }>("/fetch-credentials", {
    method: "POST",
    body: JSON.stringify({ bucket: bucketName, label: label.slice(0, 64) }),
  });

  return {
    bucket: raw.bucket || bucketName,
    accessKeyId: raw.accessKeyId,
    secretAccessKey: raw.secretAccessKey,
    // Always store the path-style S3 gateway root (without `/<bucket>`) so `@aws-sdk/client-s3`
    // with `forcePathStyle: true` constructs `/api/public/s3/<bucket>/<key>` accurately.
    s3Endpoint: getBucketlineS3GatewayEndpoint(),
    s3Region: raw.s3Region || "auto",
  };
}

function perBucketSecretKeyPrefix(bucketName: string): string {
  const suffix = bucketName.replace(/^cx-[a-f0-9]{8}-/, "").replace(/[^a-z0-9]/gi, "_").toUpperCase();
  return `COGNIX_BUCKET_${suffix || "DEFAULT"}`;
}

async function saveActiveBucketSecrets(
  project: Project,
  bucket: BucketlineBucket,
  creds: { accessKeyId: string; secretAccessKey: string; s3Endpoint: string; s3Region: string },
) {
  const prefix = perBucketSecretKeyPrefix(bucket.name);
  await Promise.all([
    upsertSecret(project.id, "S3_ENDPOINT", creds.s3Endpoint, "cloud"),
    upsertSecret(project.id, "S3_REGION", creds.s3Region, "cloud"),
    upsertSecret(project.id, "S3_BUCKET", bucket.name, "cloud"),
    upsertSecret(project.id, "S3_ACCESS_KEY_ID", creds.accessKeyId, "cloud"),
    upsertSecret(project.id, "S3_SECRET_ACCESS_KEY", creds.secretAccessKey, "cloud"),
    upsertSecret(project.id, "S3_CDN_URL", bucket.cdnEndpoint, "cloud"),
    upsertSecret(project.id, "S3_ACCESS_MODE", bucket.accessMode, "cloud"),
    // Also cache per-bucket credentials so switching between multiple buckets in a project doesn't mint unnecessary keys.
    upsertSecret(project.id, `${prefix}_KEY_ID`, creds.accessKeyId, "cloud"),
    upsertSecret(project.id, `${prefix}_SECRET`, creds.secretAccessKey, "cloud"),
  ]);
  if (project.sandboxId) {
    await syncProjectEnv(project).catch(() => undefined);
  }
}

export async function getCredentialsForProjectBucket(
  project: Project,
  bucket: BucketlineBucket,
  options: { forceRotate?: boolean; makeActive?: boolean } = {},
): Promise<BucketlineCredentials> {
  assertProjectOwnsBucket(project.id, bucket.name);
  const secrets = await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>));
  const prefix = perBucketSecretKeyPrefix(bucket.name);

  if (!options.forceRotate) {
    if (
      secrets.S3_BUCKET === bucket.name &&
      secrets.S3_ACCESS_KEY_ID &&
      secrets.S3_SECRET_ACCESS_KEY
    ) {
      return {
        bucket: bucket.name,
        accessKeyId: secrets.S3_ACCESS_KEY_ID,
        secretAccessKey: secrets.S3_SECRET_ACCESS_KEY,
        s3Endpoint: getBucketlineS3GatewayEndpoint(),
        s3Region: secrets.S3_REGION || "auto",
        cdnUrl: bucket.cdnEndpoint,
        accessMode: bucket.accessMode,
      };
    }
    const savedId = secrets[`${prefix}_KEY_ID`];
    const savedSecret = secrets[`${prefix}_SECRET`];
    if (savedId && savedSecret) {
      const creds = {
        bucket: bucket.name,
        accessKeyId: savedId,
        secretAccessKey: savedSecret,
        s3Endpoint: getBucketlineS3GatewayEndpoint(),
        s3Region: "auto",
        cdnUrl: bucket.cdnEndpoint,
        accessMode: bucket.accessMode,
      };
      if (options.makeActive) {
        await saveActiveBucketSecrets(project, bucket, creds);
      }
      return creds;
    }
  }

  const minted = await mintBucketS3Credentials(project.id, bucket.name, `cognix-${project.id.slice(0, 8)}`);
  if (options.makeActive !== false) {
    await saveActiveBucketSecrets(project, bucket, minted);
  } else {
    await Promise.all([
      upsertSecret(project.id, `${prefix}_KEY_ID`, minted.accessKeyId, "cloud"),
      upsertSecret(project.id, `${prefix}_SECRET`, minted.secretAccessKey, "cloud"),
    ]);
  }
  return {
    ...minted,
    cdnUrl: bucket.cdnEndpoint,
    accessMode: bucket.accessMode,
  };
}

/**
 * Idempotently provisions the project's primary Bucketline storage bucket and syncs `S3_*` secrets.
 * Deduplicates concurrent calls for the same project.
 */
export async function ensureProjectStorageBucket(
  project: Project,
  options: { accessMode?: BucketAccessMode } = {},
): Promise<{ bucket: BucketlineBucket; created: boolean }> {
  const existingLock = provisioningLocks.get(project.id);
  if (existingLock) return existingLock;

  const task = (async () => {
    const [buckets, secrets] = await Promise.all([
      listProjectBuckets(project.id),
      getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
    ]);

    const configuredActive = secrets.S3_BUCKET
      ? buckets.find((b) => b.name === secrets.S3_BUCKET)
      : undefined;
    const targetBucket = configuredActive ?? buckets[0];

    if (targetBucket) {
      if (
        secrets.S3_BUCKET !== targetBucket.name ||
        !secrets.S3_ACCESS_KEY_ID ||
        !secrets.S3_SECRET_ACCESS_KEY ||
        secrets.S3_ENDPOINT !== getBucketlineS3GatewayEndpoint()
      ) {
        await getCredentialsForProjectBucket(project, targetBucket, { makeActive: true });
      }
      return { bucket: targetBucket, created: false };
    }

    const createdBucket = await createProjectBucket(project.id, {
      suffix: "storage",
      accessMode: options.accessMode ?? "private",
    });
    await getCredentialsForProjectBucket(project, createdBucket, { makeActive: true });
    return { bucket: createdBucket, created: true };
  })().finally(() => {
    provisioningLocks.delete(project.id);
  });

  provisioningLocks.set(project.id, task);
  return task;
}

export async function deleteAllProjectBuckets(projectId: string): Promise<void> {
  if (!isBucketlineConfigured()) return;
  const buckets = await listProjectBuckets(projectId).catch(() => []);
  await Promise.allSettled(
    buckets.map((bucket) => deleteProjectBucket(projectId, bucket.name, { force: true })),
  );
}

// ---------------------------------------------------------------------------
// Minimal RFC-compliant AWS Signature v4 S3 client (zero external dependencies)
// ---------------------------------------------------------------------------

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function amzTimestamps(now = new Date()): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function normalizeObjectKey(rawKey: string): string {
  const key = rawKey.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!key || key.length > 800 || key.includes("\0") || key.split("/").includes("..")) {
    throw new Error("Invalid object key path.");
  }
  return key;
}

function encodeS3Path(segments: string[]): string {
  return `/${segments.map((seg) => seg.split("/").map(encodeRfc3986).join("/")).join("/")}`;
}

function canonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join("&");
}

async function signedS3Fetch(
  creds: BucketlineCredentials,
  input: {
    method: "GET" | "PUT" | "HEAD" | "DELETE" | "POST";
    objectKey?: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: Uint8Array | Buffer;
  },
): Promise<Response> {
  const gatewayUrl = new URL(creds.s3Endpoint || getBucketlineS3GatewayEndpoint());
  const baseSegments = gatewayUrl.pathname.split("/").filter(Boolean);
  const pathSegments = input.objectKey
    ? [...baseSegments, creds.bucket, normalizeObjectKey(input.objectKey)]
    : [...baseSegments, creds.bucket];
  const canonicalUri = encodeS3Path(pathSegments);
  const query = input.query ?? {};
  const canonicalQuery = canonicalQueryString(query);

  const { amzDate, dateStamp } = amzTimestamps();
  const region = creds.s3Region || "auto";
  const payloadHash = input.body ? sha256Hex(input.body) : sha256Hex("");

  const signHeaders: Record<string, string> = {
    host: gatewayUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-amz-") || lower === "content-type") {
      signHeaders[lower] = value.trim();
    }
  }

  const sortedHeaderKeys = Object.keys(signHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${signHeaders[k]}\n`).join("");
  const signedHeadersList = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(creds.secretAccessKey, dateStamp, region);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  const targetUrl = `${gatewayUrl.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  const outHeaders: Record<string, string> = {
    ...(input.headers ?? {}),
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorization,
  };

  const response = await fetch(targetUrl, {
    method: input.method,
    headers: outHeaders,
    body: input.body ? new Uint8Array(input.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok && !(input.method === "DELETE" && response.status === 204)) {
    const errBody = await response.text().catch(() => "");
    throw new Error(parseBucketlineError(errBody, response.status));
  }

  return response;
}

/**
 * Generates an AWS SigV4 query-string presigned GET or PUT URL (valid 1 second up to 7 days).
 */
export function createPresignedStorageUrl(
  creds: BucketlineCredentials,
  input: {
    method: "GET" | "PUT";
    key: string;
    expiresInSeconds?: number;
  },
): { url: string; expiresInSeconds: number } {
  const gatewayUrl = new URL(creds.s3Endpoint || getBucketlineS3GatewayEndpoint());
  const baseSegments = gatewayUrl.pathname.split("/").filter(Boolean);
  const canonicalUri = encodeS3Path([...baseSegments, creds.bucket, normalizeObjectKey(input.key)]);
  const expiresInSeconds = Math.max(1, Math.min(604_800, Math.trunc(input.expiresInSeconds ?? 3600)));

  const { amzDate, dateStamp } = amzTimestamps();
  const region = creds.s3Region || "auto";
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${creds.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = canonicalQueryString(queryParams);
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    `host:${gatewayUrl.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(creds.secretAccessKey, dateStamp, region);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const url = `${gatewayUrl.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, expiresInSeconds };
}

export function buildPublicCdnUrl(cdnEndpoint: string | undefined, key: string): string | null {
  if (!cdnEndpoint) return null;
  const cleanKey = normalizeObjectKey(key)
    .split("/")
    .map(encodeRfc3986)
    .join("/");
  return `${cdnEndpoint.replace(/\/+$/, "")}/${cleanKey}`;
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlTagValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

export async function listBucketObjects(
  creds: BucketlineCredentials,
  options: { prefix?: string; delimiter?: string; continuationToken?: string } = {},
): Promise<ListObjectsResult> {
  const prefix = options.prefix ? options.prefix.replace(/^\/+/, "") : "";
  const query: Record<string, string> = { "list-type": "2" };
  if (prefix) query.prefix = prefix;
  if (options.delimiter !== "") query.delimiter = options.delimiter ?? "/";
  if (options.continuationToken) query["continuation-token"] = options.continuationToken;

  const response = await signedS3Fetch(creds, { method: "GET", query });
  const xml = await response.text();

  const folders: string[] = [];
  for (const cpMatch of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/gi)) {
    const folderPrefix = xmlTagValue(cpMatch[1], "Prefix");
    if (folderPrefix) folders.push(folderPrefix);
  }

  const objects: StorageObjectItem[] = [];
  for (const contentMatch of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gi)) {
    const block = contentMatch[1];
    const key = xmlTagValue(block, "Key");
    if (!key || key === prefix) continue;
    const size = Number(xmlTagValue(block, "Size") ?? 0);
    const lastModified = xmlTagValue(block, "LastModified") ?? "";
    const etag = (xmlTagValue(block, "ETag") ?? "").replace(/^"+|"+$/g, "");
    const name = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
    objects.push({
      key,
      name: name || key,
      size,
      lastModified,
      etag,
      cdnUrl: creds.accessMode === "public" ? buildPublicCdnUrl(creds.cdnUrl, key) : null,
    });
  }

  const truncated = xmlTagValue(xml, "IsTruncated") === "true";
  const nextContinuationToken = xmlTagValue(xml, "NextContinuationToken");

  return { prefix, folders, objects, truncated, nextContinuationToken };
}

export async function putBucketObject(
  creds: BucketlineCredentials,
  input: { key: string; body: Buffer | Uint8Array; contentType?: string },
): Promise<{ key: string; size: number; etag: string | null; cdnUrl: string | null }> {
  const key = normalizeObjectKey(input.key);
  if (input.body.byteLength > MAX_OBJECT_BYTES) {
    throw new Error("File exceeds the 50 MB Cognix Cloud Storage object limit.");
  }
  const response = await signedS3Fetch(creds, {
    method: "PUT",
    objectKey: key,
    headers: { "content-type": input.contentType || "application/octet-stream" },
    body: input.body,
  });
  const etag = response.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? null;
  return {
    key,
    size: input.body.byteLength,
    etag,
    cdnUrl: creds.accessMode === "public" ? buildPublicCdnUrl(creds.cdnUrl, key) : null,
  };
}

export async function headBucketObject(
  creds: BucketlineCredentials,
  key: string,
): Promise<{ key: string; contentType: string; size: number; etag: string | null; lastModified: string | null }> {
  const normalized = normalizeObjectKey(key);
  const response = await signedS3Fetch(creds, { method: "HEAD", objectKey: normalized });
  return {
    key: normalized,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    size: Number(response.headers.get("content-length") ?? 0),
    etag: response.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? null,
    lastModified: response.headers.get("last-modified"),
  };
}

export async function deleteBucketObject(creds: BucketlineCredentials, key: string): Promise<{ deleted: true; key: string }> {
  const normalized = normalizeObjectKey(key);
  await signedS3Fetch(creds, { method: "DELETE", objectKey: normalized });
  return { deleted: true, key: normalized };
}

export async function copyBucketObject(
  creds: BucketlineCredentials,
  sourceKey: string,
  destinationKey: string,
): Promise<{ sourceKey: string; destinationKey: string }> {
  const src = normalizeObjectKey(sourceKey);
  const dest = normalizeObjectKey(destinationKey);
  const encodedCopySource = encodeS3Path([creds.bucket, src]);
  await signedS3Fetch(creds, {
    method: "PUT",
    objectKey: dest,
    headers: { "x-amz-copy-source": encodedCopySource },
  });
  return { sourceKey: src, destinationKey: dest };
}
