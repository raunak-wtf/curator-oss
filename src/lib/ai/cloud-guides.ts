import { CLOUD_FEATURES, type CloudFeature } from "../cloud-features";

/**
 * Internal instructions the build agent reads with the read_cloud_guide tool.
 * They are never listed with the user's skills or shown in the product UI. Import only from server code.
 */

const env = (feature: CloudFeature) => CLOUD_FEATURES[feature].env.map((name) => `\`${name}\``).join(", ");

const SHARED_RULES = `
## Rules for every Cognix Cloud feature

- Read configuration only from \`process.env\` on the server. Never import server secrets into client components, never prefix them with \`NEXT_PUBLIC_\`, and never print, log, or read \`.env*\` files.
- Cognix syncs the project's secrets into \`.env.local\` in the workspace root automatically. The system prompt lists which secret names are set and shows a live summary of PostgreSQL tables and Storage buckets. If a required variable is missing, provision it immediately with \`neon_database({ action: "provision" })\` or \`cloud_storage({ action: "provision" })\` (for managed resources), or write a clean fallback naming **Cloud → Emails** / **Cloud → Secrets** (for user-supplied keys like \`RESEND_API_KEY\`).
- Keep each integration behind one server module (for example \`src/lib/db.ts\`, \`src/lib/storage.ts\`, \`src/lib/email.ts\`, \`src/lib/auth.ts\` — or \`lib/*\` if the project does not use \`src/\`, matching \`tsconfig.json\`'s \`@/*\` alias) so routes and actions do not construct clients ad hoc.
- Validate every input at the server boundary with \`zod\` before it reaches the database, a bucket, or an email.
- In every Route Handler and Server Action \`catch\` block, log \`console.error("[route-name]", error)\` so the Cognix Preview Console captures server stack traces, and return a clear JSON \`{ error: message }\` response that client forms display directly with recovery guidance.
- Never display third-party infrastructure brand names (Daytona, Neon, Better Auth, Bucketline, Resend, or Drizzle) in generated app UI copy, footers, badges, or chat responses—use the app's own brand in its UI and **Cognix Cloud** in chat explanations.
- Run \`npm run build\` after integrating, verify the running app with \`read_preview_console\` + \`inspect_preview\`, and fix every build or runtime error before finishing.
`;

const DATABASE_GUIDE = `# Cognix Cloud: Managed PostgreSQL Database

Use the project's Cognix Cloud serverless PostgreSQL database through ${env("database")} (pooled) and \`DIRECT_URL\` (unpooled, for schema push and SQL migrations).

## 1. Managed Database Tool (\`neon_database\`)

Cognix manages this project's PostgreSQL database on the server. Never ask the user for a database API key or connection URL when Cognix Cloud is on:
- If \`DATABASE_URL\` is not listed in project secrets yet, call \`neon_database\` with \`{ "action": "provision" }\` first. Cognix creates an isolated PostgreSQL project and syncs \`DATABASE_URL\` and \`DIRECT_URL\` into \`.env.local\` automatically.
- Use \`neon_database\` whenever you need database platform operations:
  - \`status\` / \`inspect_schema\` / \`compare_schema\`: inspect live tables, columns, DDL, or diff two branches.
  - \`run_sql\`: execute parameterized DDL/DML/SELECT queries or seed starter data directly.
  - \`create_branch\`, \`restore_branch\`, \`set_default_branch\`, \`delete_branch\`: create instant copy-on-write branches (before destructive migrations on live user tables) or point-in-time restores.
  - \`create_database\`, \`create_role\`, \`reset_role_password\`, \`create_snapshot\`, \`restore_snapshot\`, \`use_connection\`.

## 2. Application Code & Migration Setup (v0 Dual-Track Pattern)

1. Install \`drizzle-orm\`, \`pg\`, \`server-only\`, \`zod\`, and dev dependencies \`drizzle-kit\` and \`@types/pg\` in a single \`npm install --no-audit --no-fund\`. Add scripts \`"db:generate": "drizzle-kit generate"\` and \`"db:push": "drizzle-kit push --force"\` to \`package.json\`.
2. Create \`src/lib/db.ts\` (or \`lib/db.ts\` matching \`@/*\` in \`tsconfig.json\`) with serverless-safe pool timeouts so suspended PostgreSQL compute wakes cleanly AND interactive transactions (required by \`better-auth\`) work reliably:
   \`\`\`ts
   import "server-only";
   import { drizzle } from "drizzle-orm/node-postgres";
   import { Pool } from "pg";
   import * as schema from "./schema";

   const connectionString = process.env.DATABASE_URL;
   if (!connectionString) {
     throw new Error("DATABASE_URL is not set. Provision Cloud Database in Cloud → Database.");
   }

   const globalForDb = globalThis as unknown as { __cognixPool?: Pool };
   export const pool =
     globalForDb.__cognixPool ??
     new Pool({
       connectionString,
       max: 5,
       idleTimeoutMillis: 20_000,
       connectionTimeoutMillis: 15_000,
       allowExitOnIdle: true,
     });

   pool.on("error", (err) => {
     console.error("[db] Unexpected PostgreSQL pool error:", err.message);
   });

   if (process.env.NODE_ENV !== "production") globalForDb.__cognixPool = pool;

   export const db = drizzle(pool, { schema });
   \`\`\`
   *(Never use \`drizzle-orm/neon-http\` when \`better-auth\` is enabled, because \`better-auth\` requires interactive SQL transactions that \`neon-http\` does not support.)*
3. Define tables in \`src/lib/schema.ts\` with \`pgTable\`.
   - **Critical rule for \`schema.ts\`**: Keep \`schema.ts\` strictly pure Drizzle table definitions — **never** add \`import "server-only"\` or \`@/\` path aliases inside \`schema.ts\`, because \`drizzle-kit\` loads \`schema.ts\` directly in Node outside Next.js!
   - **Important**: If the app also uses authentication, include the 4 authentication tables (\`user\`, \`session\`, \`account\`, \`verification\`) in this exact same \`schema.ts\` file (see the \`auth\` guide) so \`drizzle-kit push --force\` manages all tables together without dropping auth tables!
   - Use \`uuid("id").defaultRandom().primaryKey()\` (or \`text("id")\`), \`timestamp("created_at", { withTimezone: true }).defaultNow().notNull()\`, foreign keys with \`onDelete: "cascade"\`, and \`index(...)\` on \`userId\`, status, token, and sort columns.
4. Create \`drizzle.config.ts\` at the project root — **always load \`.env.local\` explicitly** because \`drizzle-kit\` only loads \`.env\` by default while Cognix writes secrets to \`.env.local\`:
   \`\`\`ts
   import { existsSync } from "node:fs";
   import { defineConfig } from "drizzle-kit";

   if (existsSync(".env.local")) process.loadEnvFile(".env.local");

   export default defineConfig({
     dialect: "postgresql",
     schema: "./src/lib/schema.ts", // adjust to "./lib/schema.ts" if project has no src/ directory
     out: "./drizzle",
     dbCredentials: {
       url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
     },
   });
   \`\`\`
5. Every time you create or update \`schema.ts\`, push the schema non-interactively:
   \`npx drizzle-kit generate && npx drizzle-kit push --force\`
   - **Direct SQL fallback & seeding**: \`neon_database({ action: "run_sql", sql: "..." })\` supports multi-statement SQL scripts (\`CREATE TABLE IF NOT EXISTS ...\`, \`ALTER TABLE ...\`, \`CREATE INDEX IF NOT EXISTS ...\`, \`INSERT INTO ...\`). If \`drizzle-kit push\` ever hits an interactive rename/enum prompt or CLI issue, immediately apply idempotent DDL directly via \`neon_database({ action: "run_sql" })\` so tables are guaranteed live!
   - Always call \`neon_database({ action: "inspect_schema" })\` afterward to confirm every table and column exists in PostgreSQL.

## 3. Query & Mutation Rules

- Query from Server Components, Route Handlers, or \`"use server"\` Server Actions only. Mark dynamic database-backed pages with \`export const dynamic = "force-dynamic";\` when they read request headers/cookies or live mutable data so \`npm run build\` never fails trying to statically prerender authenticated or live-DB routes.
- Scope every personal/workspace query and mutation to \`session.user.id\` (\`and(eq(items.id, id), eq(items.userId, session.user.id))\`). For public share-token routes (e.g. \`/review/[shareToken]\`), query strictly by \`and(eq(projects.shareToken, shareToken), eq(projects.isPublicShareEnabled, true))\`.
- Call \`revalidatePath(...)\` after mutations and design clear loading, empty, dense, and recoverable error states.
${SHARED_RULES}`;

const STORAGE_GUIDE = `# Cognix Cloud: Managed S3 Object Storage & CDN

Use Cognix Cloud S3-compatible buckets and CDN delivery through ${env("storage")} (plus \`S3_CDN_URL\` and \`S3_ACCESS_MODE\`).

## 1. Managed Storage Tool (\`cloud_storage\`)

Cognix manages this project's storage buckets on the server. Never ask the user for S3 credentials when Cognix Cloud is on:
- If \`S3_BUCKET\` or \`S3_ACCESS_KEY_ID\` is not listed in project secrets yet, call \`cloud_storage\` with \`{ "action": "provision" }\` first (or \`{ "action": "create_bucket", "suffix": "media", "accessMode": "public", "makeActive": true }\` when fast public CDN URLs for inline image thumbnails, avatars, galleries, or public share links are desirable). Cognix creates an isolated \`cx-<project>-*\` bucket, mints bucket-scoped credentials, and syncs \`S3_ENDPOINT\`, \`S3_REGION\`, \`S3_BUCKET\`, \`S3_ACCESS_KEY_ID\`, \`S3_SECRET_ACCESS_KEY\`, \`S3_CDN_URL\`, and \`S3_ACCESS_MODE\` into \`.env.local\` automatically.
- Use \`cloud_storage\` to inspect/create/delete project buckets, switch the active bucket (\`use_bucket\`), rotate S3 keys (\`rotate_credentials\`), list/copy/delete objects, upload text/JSON seed assets, or mint presigned URLs.

## 2. Gateway, Next.js Images, SigV4 Checksums & CORS Contract

- **S3 Gateway (path-style + checksum flags required)**: Always initialize \`S3Client\` with:
  \`\`\`ts
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "auto",
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  \`\`\`
  **Critical (\`@aws-sdk/client-s3\` v3.729+ compatibility)**: Without \`requestChecksumCalculation: "WHEN_REQUIRED"\` and \`responseChecksumValidation: "WHEN_REQUIRED"\`, AWS SDK v3 automatically appends \`x-amz-checksum-mode=ENABLED\` / CRC32 checksum query parameters that cause **\`HTTP 403 SignatureDoesNotMatch\`** on Cognix Cloud Storage! Also **never** pass \`ResponseContentDisposition\` or \`ResponseContentType\` into S3 presigned URLs (that also triggers \`SignatureDoesNotMatch\` on the storage gateway)—instead, set \`Content-Disposition\` from your Next.js \`/api/storage/file/[...key]\` Route Handler!
- **Hard object size limit**: **50 MB** maximum per object (\`50 * 1024 * 1024\` bytes). Enforce this limit on both client and server.
- **Next.js image configuration**: In \`next.config.ts\`, always allow remote HTTPS images (\`images: { remotePatterns: [{ protocol: "https", hostname: "**" }] }\`) or render dynamic user-uploaded thumbnails with standard \`<img>\` (\`loading="lazy"\`) pointing at the same-origin \`/api/storage/file/...\` URL so Next.js never throws \`Invalid src prop\` hostname errors on storage/CDN URLs!
- **CORS-safe browser uploads**: Never \`PUT\` directly from browser \`fetch()\` to the external S3 gateway (cross-origin preview iframes will fail CORS preflight). Always post \`FormData\` to a same-origin Next.js Route Handler (\`POST /api/storage/upload\`) that validates the user session, size, and MIME type and executes \`PutObjectCommand\` on the server.

## 3. Application Code Setup

1. Install \`@aws-sdk/client-s3\` and \`server-only\` (no \`@aws-sdk/s3-request-presigner\` needed—use the clean RFC SigV4 helper below plus the same-origin \`/api/storage/file/[...key]\` streaming route!).
2. Create \`src/lib/storage.ts\`:
   \`\`\`ts
   import "server-only";
   import { createHash, createHmac } from "node:crypto";
   import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

   const bucket = process.env.S3_BUCKET;
   const endpoint = process.env.S3_ENDPOINT;
   const region = process.env.S3_REGION || "auto";
   const accessKeyId = process.env.S3_ACCESS_KEY_ID;
   const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

   export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB limit

   export const s3 =
     bucket && endpoint && accessKeyId && secretAccessKey
       ? new S3Client({
           region,
           endpoint,
           forcePathStyle: true,
           // Required for @aws-sdk/client-s3 v3.729+ so S3-compatible gateways never reject requests with SignatureDoesNotMatch
           requestChecksumCalculation: "WHEN_REQUIRED",
           responseChecksumValidation: "WHEN_REQUIRED",
           credentials: { accessKeyId, secretAccessKey },
         })
       : null;

   export function buildSafeObjectKey(ownerPrefix: string, fileName: string) {
     const safeName =
       fileName
         .replace(/[^a-zA-Z0-9._-]+/g, "-")
         .replace(/^-+|-+$/g, "")
         .slice(0, 80) || "file";
     return \`\${ownerPrefix.replace(/^\\/+|\\/+$/g, "")}/\${crypto.randomUUID()}-\${safeName}\`;
   }

   export async function uploadObject(input: {
     key: string;
     body: Buffer | Uint8Array;
     contentType: string;
   }) {
     if (!s3 || !bucket) {
       throw new Error("Cloud Storage is not configured. Provision it in Cloud → Storage.");
     }
     if (input.body.byteLength > MAX_UPLOAD_BYTES) {
       throw new Error("File exceeds the 50 MB Cloud Storage limit.");
     }
     await s3.send(
       new PutObjectCommand({
         Bucket: bucket,
         Key: input.key,
         Body: input.body,
         ContentType: input.contentType || "application/octet-stream",
       }),
     );
     return { key: input.key, size: input.body.byteLength };
   }

   /** Preferred durable URL for inline <img> previews and downloads (never expires, zero CORS/signature issues). */
   export function getAppFileUrl(key: string, options?: { download?: boolean; fileName?: string }) {
     const cleanKey = key.replace(/^\\/+/, "");
     const base = \`/api/storage/file/\${cleanKey.split("/").map(encodeURIComponent).join("/")}\`;
     if (!options?.download) return base;
     const params = new URLSearchParams({ download: "1" });
     if (options.fileName) params.set("name", options.fileName);
     return \`\${base}?\${params.toString()}\`;
   }

   function encodeRfc3986(value: string) {
     return encodeURIComponent(value).replace(/[!'()*]/g, (c) => \`%\${c.charCodeAt(0).toString(16).toUpperCase()}\`);
   }

   /**
    * Pure RFC AWS SigV4 presigned GET URL (never appends AWS SDK v3 x-amz-checksum-mode or
    * response-content-disposition query params that cause SignatureDoesNotMatch).
    */
   export function createDirectSignedUrl(key: string, expiresIn = 3600) {
     const cleanKey = key.replace(/^\\/+/, "");
     if (process.env.S3_ACCESS_MODE === "public" && process.env.S3_CDN_URL) {
       return \`\${process.env.S3_CDN_URL.replace(/\\/+$/, "")}/\${cleanKey.split("/").map(encodeRfc3986).join("/")}\`;
     }
     if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
       throw new Error("Cloud Storage is not configured. Provision it in Cloud → Storage.");
     }
     const gateway = new URL(endpoint);
     const segs = [...gateway.pathname.split("/").filter(Boolean), bucket, ...cleanKey.split("/")];
     const canonicalUri = \`/\${segs.map(encodeRfc3986).join("/")}\`;
     const amzDate = new Date().toISOString().replace(/[:-]|\\.\\d{3}/g, "");
     const dateStamp = amzDate.slice(0, 8);
     const scope = \`\${dateStamp}/\${region}/s3/aws4_request\`;
     const qp: Record<string, string> = {
       "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
       "X-Amz-Credential": \`\${accessKeyId}/\${scope}\`,
       "X-Amz-Date": amzDate,
       "X-Amz-Expires": String(Math.max(60, Math.min(604_800, Math.trunc(expiresIn)))),
       "X-Amz-SignedHeaders": "host",
     };
     const canonicalQuery = Object.keys(qp).sort().map((k) => \`\${encodeRfc3986(k)}=\${encodeRfc3986(qp[k])}\`).join("&");
     const canonicalRequest = ["GET", canonicalUri, canonicalQuery, \`host:\${gateway.host}\\n\`, "host", "UNSIGNED-PAYLOAD"].join("\\n");
     const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\\n");
     const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d, "utf8").digest();
     const signingKey = hmac(hmac(hmac(hmac(\`AWS4\${secretAccessKey}\`, dateStamp), region), "s3"), "aws4_request");
     const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
     return \`\${gateway.origin}\${canonicalUri}?\${canonicalQuery}&X-Amz-Signature=\${signature}\`;
   }

   export async function getStoredObject(key: string) {
     if (!s3 || !bucket) {
       throw new Error("Cloud Storage is not configured.");
     }
     return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key.replace(/^\\/+/, "") }));
   }

   export async function deleteStoredObject(key: string) {
     if (!s3 || !bucket || !key) return;
     await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key.replace(/^\\/+/, "") }));
   }
   \`\`\`
3. Create **two** same-origin Storage Route Handlers so uploads, inline \`<img>\` / PDF previews, AND attachment downloads work reliably across private buckets, public buckets, preview iframes, and public share pages without expiring URLs, CORS errors, or \`SignatureDoesNotMatch\`:
   - \`src/app/api/storage/upload/route.ts\`: verifies \`auth.api.getSession\` (when auth is used), checks \`file instanceof File\`, MIME type, and \`file.size <= MAX_UPLOAD_BYTES\`, calls \`uploadObject\`, and returns \`{ key, url: getAppFileUrl(key), size: file.size, contentType: file.type, name: file.name }\`.
   - \`src/app/api/storage/file/[...key]/route.ts\`: \`GET\` handler that reconstructs \`const objectKey = (await params).key.map(decodeURIComponent).join("/")\`, verifies ownership or public-share access, calls \`getStoredObject(objectKey)\`, and streams the bytes back with \`Content-Type\`, \`Cache-Control: private, max-age=3600\`, and (when \`?download=1\`) \`Content-Disposition: attachment; filename="..."\`.

## 4. Storage Rules

- Store the durable object \`key\` (never an expiring presigned URL) in PostgreSQL alongside the record that owns it.
- Always render \`getAppFileUrl(row.fileKey)\` for inline \`<img>\` / media previews and \`getAppFileUrl(row.fileKey, { download: true, fileName: row.fileName })\` for download buttons—never rely on \`@aws-sdk/s3-request-presigner\` \`getSignedUrl\` with default AWS SDK v3 checksums or \`ResponseContentDisposition\`.
- When deleting a database record that owns a stored file, verify ownership first and delete both the PostgreSQL row and the stored object (\`deleteStoredObject(row.fileKey)\`).
- Show upload progress/pending state, file size & type hints, inline image thumbnails for \`image/*\`, download links, and actionable error messages.
${SHARED_RULES}`;

const EMAIL_GUIDE = `# Cognix Cloud: Transactional & Broadcast Emails

Send transactional and broadcast email using ${env("email")}.

## 1. Email Management Tool (\`resend_email\`)

Users connect their email API key in **Cloud → Emails**.
- When \`RESEND_API_KEY\` is listed in project secrets, call \`resend_email({ action: "status" })\` (or \`list_domains\`) to inspect verified domains and ensure \`EMAIL_FROM\` uses a verified sender.
- When \`RESEND_API_KEY\` is **not** set yet, still write \`src/lib/email.ts\` with the safe fallback below so every sign-up, invite, and notification flow works cleanly without throwing errors, and mention concisely that live email delivery activates once an email key is added in **Cloud → Emails**.

## 2. Application Code Setup

1. Install \`resend\` and \`server-only\`.
2. Create \`src/lib/email.ts\`:
   \`\`\`ts
   import "server-only";
   import { Resend } from "resend";

   const apiKey = process.env.RESEND_API_KEY;
   const from = process.env.EMAIL_FROM;
   const resend = apiKey ? new Resend(apiKey) : null;

   export const isEmailConfigured = Boolean(resend && from);

   export function escapeHtml(value: string) {
     return value
       .replaceAll("&", "&amp;")
       .replaceAll("<", "&lt;")
       .replaceAll(">", "&gt;")
       .replaceAll('"', "&quot;")
       .replaceAll("'", "&#39;");
   }

   export async function sendEmail(input: {
     to: string | string[];
     subject: string;
     text: string;
     html?: string;
     replyTo?: string;
   }) {
     if (!resend || !from) {
       console.info(\`[email skipped — configure Cloud → Emails] subject="\${input.subject}"\`);
       return { skipped: true as const, id: null };
     }
     const { data, error } = await resend.emails.send({
       from,
       to: input.to,
       subject: input.subject,
       text: input.text,
       ...(input.html ? { html: input.html } : {}),
       ...(input.replyTo ? { replyTo: input.replyTo } : {}),
     });
     if (error) throw new Error(\`Email could not be sent: \${error.message}\`);
     return { skipped: false as const, id: data?.id ?? null };
   }
   \`\`\`
   Never log the email body or recipient tokens when the message contains verification, invite, or password-reset links.
3. Keep email templates as clean functions returning \`{ subject, text, html }\`. Always provide both \`text\` and \`html\`, escaping every user-supplied value with \`escapeHtml\`.

## 3. Rules

- Send email only from server code after validating inputs with \`zod\`.
- Inside authentication callbacks (\`sendVerificationEmail\`, \`sendResetPassword\`), trigger \`void sendEmail(...).catch(() => undefined)\` without awaiting so response timing does not leak account existence or slow down sign-in.
${SHARED_RULES}`;

const AUTH_GUIDE = `# Cognix Cloud: Full-Stack Authentication (PostgreSQL-Backed)

Authentication uses \`better-auth\` stored in the project's Cognix Cloud PostgreSQL database via \`drizzle-orm\`. Required secrets: ${env("auth")} (auto-provisioned when Cognix Cloud is on). Always read the \`database\` guide as well; only read the \`email\` guide if the app sends verification, password-reset, or transactional emails.

## 1. Install

Install \`better-auth\`, \`drizzle-orm\`, \`pg\`, \`server-only\`, and dev dependencies \`drizzle-kit\` and \`@types/pg\` in a single \`npm install --no-audit --no-fund\` (add \`resend\` too only when email is used).

## 2. Unified Auth Tables in \`src/lib/schema.ts\`

Always include these exact 4 core tables inside \`src/lib/schema.ts\` alongside your application tables so \`npx drizzle-kit push --force\` manages both auth and app tables together without table-drop conflicts, and so **Cloud → Authentication** displays live users and sessions:

\`\`\`ts
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
\`\`\`

Reference \`user.id\` in your domain tables (\`userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })\`), then run \`npx drizzle-kit generate && npx drizzle-kit push --force\`.

## 3. Server Config: \`src/lib/auth.ts\` (Cross-Origin Preview Iframe Safe!)

**Critical**: Cognix serves live previews and published apps over HTTPS inside a cross-origin preview iframe (\`COGNIX_HOSTED_PREVIEW="1"\` is set even during \`npm run dev\` when \`NODE_ENV="development"\`). You **must** include \`COGNIX_HOSTED_PREVIEW === "1"\` in \`isHostedHttps\` AND enable \`useSecureCookies: true\` + \`sameSite: "none", secure: true, partitioned: true\` + wildcard/dynamic \`trustedOrigins\` so session cookies and CSRF origin checks succeed inside the preview iframe and on published custom domains!

\`\`\`ts
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./schema";

const isHostedHttps =
  process.env.NODE_ENV === "production" ||
  process.env.COGNIX_HOSTED_PREVIEW === "1" ||
  process.env.CI === "1";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origins = new Set<string>([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://*.daytona.work",
      "https://*.daytona.works",
      "https://*.daytonaproxy01.net",
      "https://*.curatorsite.in",
      "https://*.curator.codes",
    ]);
    if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
    const origin = request?.headers.get("origin");
    const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
    const proto = request?.headers.get("x-forwarded-proto") ?? "https";
    if (host) {
      origins.add(\`\${proto}://\${host}\`);
      origins.add(\`https://\${host}\`);
      origins.add(\`http://\${host}\`);
    }
    if (origin) origins.add(origin);
    return [...origins];
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  advanced: isHostedHttps
    ? {
        useSecureCookies: true,
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
          partitioned: true,
        },
      }
    : undefined,
  plugins: [nextCookies()], // keep nextCookies() last
});
\`\`\`

If the app **also** requests email verification or password-reset emails, wire \`sendResetPassword\` and \`emailVerification\` using \`isEmailConfigured\` and \`sendEmail\` from \`src/lib/email.ts\` (gating \`requireEmailVerification: isEmailConfigured\` so sign-up works immediately even before email credentials are configured).

## 4. Route Handler & Browser Auth Client (Never Hardcode \`localhost:3000\` in Browser!)

- \`src/app/api/auth/[...all]/route.ts\`:
  \`\`\`ts
  import { auth } from "@/lib/auth";
  import { toNextJsHandler } from "better-auth/next-js";

  export const { GET, POST } = toNextJsHandler(auth);
  \`\`\`
- \`src/lib/auth-client.ts\` — **Never** pass \`process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"\` in browser code (that forces the visitor's browser to call \`localhost:3000\` and fails in hosted previews!). Always resolve \`window.location.origin\` on the client:
  \`\`\`ts
  "use client";
  import { createAuthClient } from "better-auth/react";

  export const authClient = createAuthClient({
    baseURL:
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.BETTER_AUTH_URL || "http://localhost:3000",
  });
  \`\`\`
  - Sign up: \`const { data, error } = await authClient.signUp.email({ name, email, password });\`
  - Sign in: \`const { data, error } = await authClient.signIn.email({ email, password });\`
  - Sign out: \`await authClient.signOut(); router.push("/sign-in"); router.refresh();\`
  - Always check \`if (error) { console.error("[auth]", error); setError(error.message || "Could not sign in. Check your credentials and try again."); return; }\` and after success call \`router.push("/dashboard"); router.refresh();\` so Server Components re-render with the new session cookie!

## 5. Protecting Pages, Server Actions & API Routes

- Server Components & Server Actions (add \`export const dynamic = "force-dynamic";\` on authenticated pages):
  \`\`\`ts
  import { headers } from "next/headers";
  import { redirect } from "next/navigation";
  import { auth } from "@/lib/auth";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  \`\`\`
- Re-verify \`session\` inside every mutating Server Action and Route Handler and scope every query with \`eq(table.userId, session.user.id)\`.

## 6. Auth UI Screens to Build

- Build \`/sign-in\` and \`/sign-up\` (plus \`/forgot-password\` and \`/reset-password\` when password-reset flows are part of the product), and include an account badge + sign-out button in the authenticated shell.
- Use native \`<form>\` + \`<label>\` controls, proper \`autocomplete\` attributes (\`name\`, \`email\`, \`current-password\`, \`new-password\`), visible focus rings, loading states, and real server error messages.
${SHARED_RULES}`;

export const CLOUD_GUIDES: Record<CloudFeature, string> = {
  database: DATABASE_GUIDE,
  storage: STORAGE_GUIDE,
  email: EMAIL_GUIDE,
  auth: AUTH_GUIDE,
};
