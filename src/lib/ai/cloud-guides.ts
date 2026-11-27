import { CLOUD_FEATURES, type CloudFeature } from "../cloud-features";

/**
 * Internal instructions the build agent reads with the read_cloud_guide tool.
 * They are never listed with the user's skills or shown in the product UI. Import only from server code.
 */

const env = (feature: CloudFeature) => CLOUD_FEATURES[feature].env.map((name) => `\`${name}\``).join(", ");

const SHARED_RULES = `
## Rules for every Cognix Cloud feature

- Read configuration only from \`process.env\` on the server. Never import server secrets into client components, never prefix them with \`NEXT_PUBLIC_\`, and never print, log, or read \`.env*\` files.
- Cognix syncs the project's secrets into \`.env.local\` in the sandbox. The system prompt lists which secret names are set. If a required variable is missing, first provision it with \`neon_database\` or \`cloud_storage\` (for managed resources), or write a clean fallback naming **Cloud → Emails** / **Cloud → Secrets** (for user-supplied keys like \`RESEND_API_KEY\`).
- Keep each integration behind one server module (for example \`src/lib/db.ts\`, \`src/lib/storage.ts\`, \`src/lib/email.ts\`, \`src/lib/auth.ts\` — or \`lib/*\` if the project does not use \`src/\`, matching \`tsconfig.json\`'s \`@/*\` alias) so routes and actions do not construct clients ad hoc.
- Validate every input at the server boundary with \`zod\` before it reaches the database, a bucket, or an email.
- Run \`npm run build\` after integrating and fix every TypeScript or bundler error before finishing.
`;

const DATABASE_GUIDE = `# Cognix Cloud: Managed Neon PostgreSQL Database

Use the project's Cognix-managed Neon serverless PostgreSQL database through ${env("database")} (pooled) and \`DIRECT_URL\` (unpooled, for schema push/migrations).

## 1. Managed Neon Tool (\`neon_database\`)

Cognix manages this project's Neon database on the server via \`NEON_API_KEY\`. Never ask the user for a Neon API key or database URL when Cognix Cloud is on:
- If \`DATABASE_URL\` is not listed in project secrets yet, call \`neon_database\` with \`{ "action": "provision" }\` first. Cognix creates an isolated Neon PostgreSQL project and syncs \`DATABASE_URL\` and \`DIRECT_URL\` into \`.env.local\` automatically.
- Use \`neon_database\` whenever you need Neon platform capabilities:
  - \`status\` / \`inspect_schema\` / \`compare_schema\`: inspect live tables, columns, DDL, or diff two branches.
  - \`run_sql\`: execute parameterized DDL/DML/SELECT queries directly against Neon.
  - \`create_branch\`, \`restore_branch\`, \`set_default_branch\`, \`delete_branch\`: create instant copy-on-write branches (for risky migrations or testing) or point-in-time restores.
  - \`create_database\`, \`create_role\`, \`reset_role_password\`: manage databases and roles.
  - \`create_endpoint\`, \`update_endpoint\`, \`start_endpoint\`, \`suspend_endpoint\`, \`restart_endpoint\`: manage compute autoscaling or read-only replicas.
  - \`create_snapshot\`, \`restore_snapshot\`, \`use_connection\`: create/restore snapshots or point \`.env.local\` at a specific branch/database.

## 2. Application Code Setup

1. Install \`drizzle-orm\`, \`pg\`, \`server-only\`, \`zod\`, and dev dependencies \`drizzle-kit\` and \`@types/pg\` in a single \`npm install\`. Cognix Cloud exclusively uses Drizzle ORM and PostgreSQL — never install Prisma, SQLite, Supabase, Firebase, MongoDB, or any other database/ORM.
2. Create \`src/lib/db.ts\` (or \`lib/db.ts\` matching \`@/*\` in \`tsconfig.json\`):
   \`\`\`ts
   import "server-only";
   import { drizzle } from "drizzle-orm/node-postgres";
   import { Pool } from "pg";
   import * as schema from "./schema";

   const connectionString = process.env.DATABASE_URL;
   if (!connectionString) {
     throw new Error("DATABASE_URL is not set. Provision Managed Neon in Cloud → Database.");
   }

   const globalForDb = globalThis as unknown as { __cognixPool?: Pool };
   export const pool = globalForDb.__cognixPool ?? new Pool({ connectionString, max: 5 });
   if (process.env.NODE_ENV !== "production") globalForDb.__cognixPool = pool;

   export const db = drizzle(pool, { schema });
   \`\`\`
3. Define tables in \`src/lib/schema.ts\` with \`pgTable\`.
   - **Important**: If the app also uses Better Auth, include Better Auth's 4 tables (\`user\`, \`session\`, \`account\`, \`verification\`) in this exact same \`schema.ts\` file (see the \`auth\` guide) so \`drizzle-kit push\` manages all tables together without conflicts!
   - Use \`uuid("id").defaultRandom().primaryKey()\` (or \`text("id")\`), \`timestamp("created_at", { withTimezone: true }).defaultNow().notNull()\`, foreign keys with \`onDelete: "cascade"\`, and \`index(...)\` on \`userId\`, status, and sort columns.
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
5. Push the schema non-interactively with \`npx drizzle-kit push --force\`, then call \`neon_database({ action: "inspect_schema" })\` to verify every expected table is live in Neon.

## 3. Query & Mutation Rules

- Query from Server Components, Route Handlers, or \`"use server"\` Server Actions only. Use Drizzle's query builder or parameterized \`sql\` templates; never concatenate strings into SQL.
- Scope every personal/workspace query and mutation to \`session.user.id\` (\`and(eq(items.id, id), eq(items.userId, session.user.id))\`).
- Call \`revalidatePath(...)\` after mutations and design clear loading, empty, dense, and recoverable error states.
${SHARED_RULES}`;

const STORAGE_GUIDE = `# Cognix Cloud: Managed S3 Storage & CDN (Bucketline)

Use Cognix-managed S3-compatible buckets and CDN delivery through ${env("storage")} (plus \`S3_CDN_URL\` and \`S3_ACCESS_MODE\`).

## 1. Managed Storage Tool (\`cloud_storage\`)

Cognix manages this project's storage buckets on the server via \`BUCKETLINE_API_KEY\`. Never ask the user for S3 credentials when Cognix Cloud is on:
- If \`S3_BUCKET\` or \`S3_ACCESS_KEY_ID\` is not listed in project secrets yet, call \`cloud_storage\` with \`{ "action": "provision" }\` first (or \`{ "action": "create_bucket", "suffix": "public-media", "accessMode": "public" }\` when public CDN assets such as avatars, cover images, or product photos are needed). Cognix creates an isolated \`cx-<project>-*\` bucket, mints bucket-scoped \`AKIA…\` credentials, and syncs \`S3_ENDPOINT\`, \`S3_REGION\`, \`S3_BUCKET\`, \`S3_ACCESS_KEY_ID\`, \`S3_SECRET_ACCESS_KEY\`, \`S3_CDN_URL\`, and \`S3_ACCESS_MODE\` into \`.env.local\` automatically.
- Use \`cloud_storage\` to inspect/create/delete project buckets, switch the active bucket (\`use_bucket\`), rotate S3 keys (\`rotate_credentials\`), list/copy/delete objects, upload text/JSON seed assets, or mint presigned URLs.

## 2. Gateway & CDN Contract

- **S3 Gateway (path-style required)**: \`endpoint: process.env.S3_ENDPOINT\` (\`https://cloudnest-cdn-vault.lovable.app/api/public/s3\`), \`region: process.env.S3_REGION || "auto"\`, \`forcePathStyle: true\`.
- **Hard object size limit**: **50 MB** maximum per object (\`50 * 1024 * 1024\` bytes). Enforce this limit on both client and server.
- **Access modes**:
  - \`private\` (default): Serve files using SigV4 presigned \`GET\` URLs (\`@aws-sdk/s3-request-presigner\`, 60s to 7 days).
  - \`public\`: Files are also served directly via \`\${process.env.S3_CDN_URL}/\${objectKey}\` with edge caching and HTTP Range (\`206 Partial Content\`) streaming for video/audio. Raster images (PNG, JPEG, WebP, GIF, AVIF) render inline in \`<img>\`; HTML/SVG/XML/JS are served with \`nosniff\` as \`application/octet-stream\` for XSS protection.
- **CORS-safe browser uploads**: Do **not** \`PUT\` directly from browser \`fetch()\` to the external S3 gateway (cross-origin preview iframes will hit CORS preflight blocks). Instead, post \`FormData\` to an authenticated same-origin Next.js Route Handler (\`POST /api/storage/upload\`) that validates the user session, size, and MIME type and sends \`PutObjectCommand\` from Node.js!

## 3. Application Code Setup

1. Install \`@aws-sdk/client-s3\`, \`@aws-sdk/s3-request-presigner\`, and \`server-only\`.
2. Create \`src/lib/storage.ts\`:
   \`\`\`ts
   import "server-only";
   import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
   import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

   const bucket = process.env.S3_BUCKET;
   const endpoint = process.env.S3_ENDPOINT;
   const accessKeyId = process.env.S3_ACCESS_KEY_ID;
   const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

   export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB Bucketline limit

   export const s3 =
     bucket && endpoint && accessKeyId && secretAccessKey
       ? new S3Client({
           region: process.env.S3_REGION || "auto",
           endpoint,
           forcePathStyle: true,
           credentials: { accessKeyId, secretAccessKey },
         })
       : null;

   export function buildSafeObjectKey(ownerPrefix: string, fileName: string) {
     const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
     return \`\${ownerPrefix.replace(/^\\/+|\\/+$/g, "")}/\${crypto.randomUUID()}-\${safeName}\`;
   }

   export async function uploadObject(input: {
     key: string;
     body: Buffer | Uint8Array;
     contentType: string;
   }) {
     if (!s3 || !bucket) throw new Error("Cloud Storage is not configured. Provision it in Cloud → Storage.");
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

   export async function resolveObjectUrl(key: string, expiresIn = 3600) {
     const cleanKey = key.replace(/^\\/+/, "");
     if (process.env.S3_ACCESS_MODE === "public" && process.env.S3_CDN_URL) {
       return \`\${process.env.S3_CDN_URL.replace(/\\/+$/, "")}/\${cleanKey}\`;
     }
     if (!s3 || !bucket) throw new Error("Cloud Storage is not configured. Provision it in Cloud → Storage.");
     return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: cleanKey }), { expiresIn });
   }

   export async function deleteStoredObject(key: string) {
     if (!s3 || !bucket) return;
     await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key.replace(/^\\/+/, "") }));
   }
   \`\`\`
3. Create \`src/app/api/storage/upload/route.ts\` (checking \`auth.api.getSession\` if the app has auth, validating \`file instanceof File\`, MIME type, and \`file.size <= MAX_UPLOAD_BYTES\`, calling \`uploadObject\`, persisting metadata + \`key\` in Neon PostgreSQL, and returning \`{ key, url: await resolveObjectUrl(key) }\`).

## 4. Storage Rules

- Store the durable object \`key\` (never an expiring presigned URL) in Neon PostgreSQL alongside the record that owns it, and resolve \`url\` via \`resolveObjectUrl(key)\` when loading records on the server.
- When deleting a database record that owns a stored file, verify ownership first and delete both the Postgres row and the S3 object (\`deleteStoredObject(row.fileKey)\`).
- Show upload progress/pending state, file size & type hints, previews for images, and actionable error messages.
${SHARED_RULES}`;

const EMAIL_GUIDE = `# Cognix Cloud: Emails with Resend

Send transactional and broadcast email through Resend using ${env("email")}.

## 1. Resend Management Tool (\`resend_email\`)

Users connect their own Resend account in **Cloud → Emails**.
- When \`RESEND_API_KEY\` is listed in project secrets, call \`resend_email({ action: "status" })\` (or \`list_domains\`) to inspect verified domains and ensure \`EMAIL_FROM\` uses a verified sender. You can also use \`resend_email\` to verify domains, send emails/batches, or manage audiences, contacts, broadcasts, and webhooks.
- When \`RESEND_API_KEY\` is **not** set yet, still write the full \`src/lib/email.ts\` integration with the safe fallback below so every sign-up, invite, and notification flow works cleanly without throwing errors, and mention in your summary that live email delivery activates once the user connects Resend in **Cloud → Emails**.

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
       console.info(\`[email skipped — connect Resend in Cloud → Emails] subject="\${input.subject}"\`);
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
- Inside Better Auth callbacks (\`sendVerificationEmail\`, \`sendResetPassword\`), trigger \`void sendEmail(...).catch(() => undefined)\` without awaiting so response timing does not leak account existence or block auth latency.
${SHARED_RULES}`;

const AUTH_GUIDE = `# Cognix Cloud: Authentication with Better Auth (on Neon PostgreSQL)

Authentication must use **Better Auth** (\`better-auth\`) stored in the project's Managed Neon PostgreSQL database via **Drizzle ORM**. Required secrets: ${env("auth")} (auto-provisioned when Cognix Cloud is on). Always read the \`database\` guide as well; only read the \`email\` guide if the app sends verification, password-reset, or transactional emails.

## 1. Install

Install \`better-auth\`, \`drizzle-orm\`, \`pg\`, \`server-only\`, and dev dependencies \`drizzle-kit\` and \`@types/pg\` in a single \`npm install --no-audit --no-fund\` (add \`resend\` too only when email is used).

## 2. Unified Drizzle Auth Tables in \`src/lib/schema.ts\`

Always include these exact 4 Better Auth core tables inside \`src/lib/schema.ts\` alongside your application tables so \`npx drizzle-kit push --force\` manages both auth and app tables together without table-drop conflicts, and so **Cloud → Authentication** can display live users and sessions:

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

Reference \`user.id\` in your domain tables (\`userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })\`), then run \`npx drizzle-kit push --force\`.

## 3. Server Config: \`src/lib/auth.ts\`

### Default (no email verification required — instant sign-up & sign-in):
\`\`\`ts
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./schema";

const isHostedHttps = process.env.NODE_ENV === "production" || process.env.CI === "1";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origins = new Set<string>(["http://localhost:3000"]);
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

If the app **also** requests email verification or password-reset emails, wire \`sendResetPassword\` and \`emailVerification\` using \`isEmailConfigured\` and \`sendEmail\` from \`src/lib/email.ts\` (gating \`requireEmailVerification: isEmailConfigured\` so sign-up still works immediately before Resend is connected in **Cloud → Emails**).

## 4. Route Handler & Client

- \`src/app/api/auth/[...all]/route.ts\`:
  \`\`\`ts
  import { auth } from "@/lib/auth";
  import { toNextJsHandler } from "better-auth/next-js";

  export const { GET, POST } = toNextJsHandler(auth);
  \`\`\`
- \`src/lib/auth-client.ts\`:
  \`\`\`ts
  import { createAuthClient } from "better-auth/react";

  export const authClient = createAuthClient();
  \`\`\`
  - Sign up: \`await authClient.signUp.email({ name, email, password })\`
  - Sign in: \`await authClient.signIn.email({ email, password })\`
  - Sign out: \`await authClient.signOut()\`
  - Client session hook: \`authClient.useSession()\`
  - Request password reset: \`await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })\` (check installed \`better-auth\` client types if using \`forgetPassword\`), then \`await authClient.resetPassword({ newPassword, token })\`.

## 5. Protecting Pages, Server Actions & API Routes

- Server Components & Server Actions:
  \`\`\`ts
  import { headers } from "next/headers";
  import { redirect } from "next/navigation";
  import { auth } from "@/lib/auth";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  \`\`\`
- Re-verify \`session\` inside every mutating Server Action and Route Handler and scope every query with \`eq(table.userId, session.user.id)\`.

## 6. Auth UI Screens to Build

- Build \`/sign-in\`, \`/sign-up\`, \`/forgot-password\`, and \`/reset-password\` (plus \`/verify-email\` notice when \`isEmailConfigured\` is true), and include an account badge + sign-out button in the authenticated shell.
- Use native \`<form>\` + \`<label>\` controls, proper \`autocomplete\` attributes (\`name\`, \`email\`, \`current-password\`, \`new-password\`), visible focus rings, loading states, and actionable error messages.
${SHARED_RULES}`;

export const CLOUD_GUIDES: Record<CloudFeature, string> = {
  database: DATABASE_GUIDE,
  storage: STORAGE_GUIDE,
  email: EMAIL_GUIDE,
  auth: AUTH_GUIDE,
};
