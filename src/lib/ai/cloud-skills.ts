import type { Skill } from "../types";

export type CloudArchitectureSkill = {
  name: string;
  description: string;
  instructions: readonly string[];
};

export type BuiltinCloudSkill = Pick<Skill, "name" | "description" | "body">;

/**
 * First-party Cognix Cloud architecture skills. Always active in Build mode whenever
 * Cognix Cloud is enabled so the agent builds production-grade full-stack apps without
 * needing manual babysitting.
 */
export const CLOUD_ARCHITECTURE_SKILLS: readonly CloudArchitectureSkill[] = [
  {
    name: "cognix-cloud-orchestration",
    description: "End-to-end execution order and turn batching for full-stack Cognix Cloud apps.",
    instructions: [
      "Start by inspecting the existing file tree (`list_files` / `read_file`). On a brand-new project with no `package.json`, never run `npx create-next-app .` in the project root because `.env.local` and `public/__cognix_visual_edit.js` already exist there and `create-next-app` refuses non-empty directories. Instead, write `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/globals.css`, and `src/app/layout.tsx` directly, preserving `.env.local` and `public/__cognix_visual_edit.js`.",
      "Call `read_cloud_guide` in one parallel batch for every Cloud capability the app needs (`database`, `auth`, `storage`, `email`) before installing packages or writing backend modules.",
      "Verify required environment secret names from the system prompt: if `DATABASE_URL` is missing and the app uses Database or Auth, call `neon_database({ action: \"provision\" })`; if `S3_BUCKET` is missing and the app uses Storage, call `cloud_storage({ action: \"provision\" })` (or `create_bucket` with `accessMode: \"public\"` for public CDN media).",
      "Install all Next.js, UI, validation, and Cognix Cloud dependencies in a single `npm install` command (for example `npm install drizzle-orm pg better-auth resend @aws-sdk/client-s3 @aws-sdk/s3-request-presigner server-only zod lucide-react && npm install -D drizzle-kit @types/pg`) rather than running separate installs per package.",
      "Build from the data layer upward: (1) unified `src/lib/schema.ts` + `src/lib/db.ts` + `drizzle.config.ts`, (2) push schema non-interactively with `npx drizzle-kit push --force` and confirm via `neon_database({ action: \"inspect_schema\" })`, (3) `src/lib/email.ts`, `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, and `src/lib/storage.ts`, (4) Zod-validated server actions and route handlers with session ownership checks, (5) complete UI pages with loading, empty, dense, and error states.",
      "Finish by running `npm run build` until it exits with code 0, starting or restarting the background dev server on `0.0.0.0:3000`, and calling `inspect_preview` on `/` plus key auth/API routes to verify clean HTTP statuses and zero runtime crashes.",
    ],
  },
  {
    name: "neon-postgres-and-drizzle",
    description: "Serverless Neon PostgreSQL schema design, Drizzle ORM pooling, and non-interactive migrations.",
    instructions: [
      "Keep all database access behind `src/lib/db.ts` (or `lib/db.ts` matching `tsconfig.json`) with `import \"server-only\"` and a hot-reload-safe `pg.Pool` singleton (`max: 5`) reading `process.env.DATABASE_URL`.",
      "In `drizzle.config.ts`, load `.env.local` explicitly at the top (`import { existsSync } from \"node:fs\"; if (existsSync(\".env.local\")) process.loadEnvFile(\".env.local\");`) because `drizzle-kit` only loads `.env` by default while Cognix syncs secrets into `.env.local`. Point `dbCredentials.url` at `process.env.DIRECT_URL || process.env.DATABASE_URL!`.",
      "Always run `npx drizzle-kit push --force` so schema pushes never hang waiting for an interactive TTY prompt. Before destructive schema changes on an app with live data, create a safety branch first via `neon_database({ action: \"create_branch\", name: \"pre-migration\" })`.",
      "Model relational tables with explicit foreign keys (`onDelete: \"cascade\"` or `\"set null\"`), `timestamp(..., { withTimezone: true }).defaultNow().notNull()`, and indexes on `user_id`, status, and sort columns. Never concatenate user input into raw SQL.",
    ],
  },
  {
    name: "better-auth-fullstack",
    description: "Zero-conflict Better Auth + Drizzle schema, preview-iframe cookies, and complete auth flows.",
    instructions: [
      "When an app uses both Better Auth and Drizzle, define Better Auth's four core tables (`user`, `session`, `account`, `verification`) inside the same `schema.ts` file as your application tables and pass `drizzleAdapter(db, { provider: \"pg\", schema })` from `better-auth/adapters/drizzle`. Never mix a separate Kysely `npx auth migrate` with `drizzle-kit push`, which would cause Drizzle to see unmanaged tables.",
      "Gate `requireEmailVerification` on `const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` and set `autoSignIn: true` in `emailAndPassword`. That way sign-up and sign-in work immediately in live preview before Resend is connected, and email verification turns on automatically as soon as `RESEND_API_KEY` and `EMAIL_FROM` are set.",
      "Configure dynamic `trustedOrigins` from `request.headers` (`origin`, `x-forwarded-host`, `x-forwarded-proto`) and set `advanced.defaultCookieAttributes` to `{ sameSite: \"none\", secure: true, partitioned: true }` when `process.env.NODE_ENV === \"production\" || process.env.CI === \"1\"` so Better Auth session cookies work reliably inside Cognix's cross-origin preview iframe as well as on published custom domains.",
      "Enforce `const session = await auth.api.getSession({ headers: await headers() })` inside protected server layouts/pages AND inside every mutating server action or API route, scoping queries to `session.user.id`.",
    ],
  },
  {
    name: "bucketline-s3-storage-and-cdn",
    description: "CORS-safe Bucketline S3 uploads, 50 MB validation, CDN URLs, and presigned access.",
    instructions: [
      "Configure `S3Client` in `src/lib/storage.ts` (`import \"server-only\"`) with `endpoint: process.env.S3_ENDPOINT`, `region: process.env.S3_REGION || \"auto\"`, and `forcePathStyle: true`.",
      "Route browser file uploads through an authenticated same-origin Next.js Route Handler (`POST /api/storage/upload` reading `request.formData()`) that checks `auth.api.getSession`, validates MIME type and `file.size <= 50 * 1024 * 1024` (Bucketline's hard 50 MB object limit), generates a sanitized server key (`users/${session.user.id}/${crypto.randomUUID()}-${safeName}`), and uploads via `PutObjectCommand`. This avoids cross-origin S3 `PUT` preflight CORS failures in preview iframes.",
      "Persist the stable `objectKey` (plus filename, contentType, and byte size) in Neon PostgreSQL—never store expiring presigned URLs in database columns. Resolve display/download URLs on read using `S3_CDN_URL` when `S3_ACCESS_MODE === \"public\"` or a SigV4 presigned `GetObjectCommand` URL for private buckets.",
    ],
  },
  {
    name: "resend-transactional-email",
    description: "Resend transactional email module, graceful dev fallback, and non-blocking auth hooks.",
    instructions: [
      "Keep Resend behind `src/lib/email.ts` (`import \"server-only\"`). Export `isEmailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` and make `sendEmail` log `[email skipped]` and return `{ skipped: true }` when unconfigured so user flows never crash before the owner connects Resend in **Cloud → Emails**.",
      "When `RESEND_API_KEY` is already listed in project secret names, call `resend_email({ action: \"status\" })` or `list_domains` to inspect verified domains and ensure `EMAIL_FROM` matches a verified sender.",
      "Always include both `text` and escaped `html` bodies, never log reset/verification URLs containing secret tokens, and invoke `void sendEmail(...)` non-blockingly inside Better Auth callbacks.",
    ],
  },
];

/**
 * Built-in `/cloud-*` slash skills shown in the composer's `/` menu and resolved on the server
 * without consuming the user's saved skill quota.
 */
export const BUILTIN_CLOUD_SKILLS: readonly BuiltinCloudSkill[] = [
  {
    name: "cloud-fullstack",
    description: "Full-stack Cognix Cloud blueprint: Neon Postgres + Drizzle, Better Auth, S3 Storage, and Resend.",
    body: `# Full-Stack Cognix Cloud Blueprint

Apply this architecture to deliver a complete, production-grade full-stack Next.js App Router application on Cognix Cloud:

1. **Consent & Provisioning**:
   - If Cognix Cloud is off, call \`request_cognix_cloud\` once with all needed features (\`database\`, \`auth\`, \`storage\`, \`email\`) and wait for approval.
   - Once Cognix Cloud is on, call \`read_cloud_guide\` for all active features in parallel, and ensure \`DATABASE_URL\` (\`neon_database\` \`provision\`) and \`S3_BUCKET\` (\`cloud_storage\` \`provision\`) exist.
2. **Unified Data & Auth Schema (\`src/lib/schema.ts\`)**:
   - Define Better Auth's \`user\`, \`session\`, \`account\`, and \`verification\` tables alongside all domain tables with cascading foreign keys to \`user.id\` and indexes on filtered/sorted columns.
   - Configure \`drizzle.config.ts\` with \`if (existsSync(".env.local")) process.loadEnvFile(".env.local")\` and push non-interactively via \`npx drizzle-kit push --force\`.
3. **Authentication (\`src/lib/auth.ts\`, \`src/lib/auth-client.ts\`, \`src/app/api/auth/[...all]/route.ts\`)**:
   - Wire \`betterAuth\` with \`drizzleAdapter(db, { provider: "pg", schema })\`, dynamic \`trustedOrigins\`, iframe-safe HTTPS cookies, and \`requireEmailVerification\` gated on \`RESEND_API_KEY && EMAIL_FROM\`.
   - Ship polished \`/sign-in\`, \`/sign-up\`, \`/forgot-password\`, and \`/reset-password\` screens plus an authenticated user menu with sign-out.
4. **Storage & Email (\`src/lib/storage.ts\`, \`src/lib/email.ts\`)**:
   - Implement \`POST /api/storage/upload\` (\`FormData\`, \`<= 50 MB\`, \`PutObjectCommand\`, \`forcePathStyle: true\`) saving object keys in Postgres and rendering via \`S3_CDN_URL\` or presigned \`GET\` URLs.
   - Implement \`sendEmail\` with Resend and a safe no-op fallback when \`RESEND_API_KEY\` is not connected yet.
5. **Verification**:
   - Run \`npm run build\` until clean, verify the dev server on \`0.0.0.0:3000\`, and inspect routes with \`inspect_preview\`.`,
  },
  {
    name: "cloud-database",
    description: "Managed Neon PostgreSQL + Drizzle ORM schema, pooling, branching, and validated server actions.",
    body: `# Cognix Cloud Database Skill

- Read \`read_cloud_guide({ feature: "database" })\` and ensure \`DATABASE_URL\` is provisioned via \`neon_database\`.
- Use \`drizzle-orm/node-postgres\` with a singleton \`pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })\` guarded by \`import "server-only"\`.
- Load \`.env.local\` in \`drizzle.config.ts\` (\`if (existsSync(".env.local")) process.loadEnvFile(".env.local")\`) and apply schema changes with \`npx drizzle-kit push --force\`.
- Validate every mutation input with \`zod\`, revalidate affected Next.js paths, and render clear empty, loading, and recoverable error states.`,
  },
  {
    name: "cloud-auth",
    description: "Better Auth email & password accounts on Neon Postgres with session guards and password reset.",
    body: `# Cognix Cloud Authentication Skill

- Read \`read_cloud_guide\` for \`auth\`, \`database\`, and \`email\`.
- Include Better Auth's \`user\`, \`session\`, \`account\`, and \`verification\` tables in \`schema.ts\` and connect \`betterAuth\` via \`drizzleAdapter(db, { provider: "pg", schema })\`.
- Gate \`requireEmailVerification\` on \`Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)\` with \`autoSignIn: true\`, configure proxy-aware \`trustedOrigins\`, and enable cross-site HTTPS cookie attributes when \`CI === "1"\` or \`NODE_ENV === "production"\`.
- Build \`/sign-in\`, \`/sign-up\`, \`/forgot-password\`, and \`/reset-password\`, and enforce \`auth.api.getSession({ headers: await headers() })\` in every protected page, server action, and API route.`,
  },
  {
    name: "cloud-storage",
    description: "Bucketline S3 file & media uploads (<= 50 MB), public CDN or presigned URLs, and Postgres metadata.",
    body: `# Cognix Cloud Storage Skill

- Read \`read_cloud_guide({ feature: "storage" })\` and ensure a project bucket is provisioned via \`cloud_storage\`.
- Configure \`S3Client\` with \`forcePathStyle: true\`, \`endpoint: process.env.S3_ENDPOINT\`, and \`region: process.env.S3_REGION || "auto"\`.
- Handle browser uploads through an authenticated \`POST /api/storage/upload\` route handler (\`FormData\`, MIME allowlist, \`<= 50 MB\`, server-generated key \`users/\${userId}/\${crypto.randomUUID()}-\${safeName}\`, \`PutObjectCommand\`).
- Store object keys in Neon PostgreSQL and resolve read URLs via \`S3_CDN_URL\` (public buckets) or \`getSignedUrl\` \`GetObjectCommand\` (private buckets), deleting S3 objects when their database record is deleted.`,
  },
  {
    name: "cloud-email",
    description: "Resend transactional email integration, escaped HTML + text templates, and domain-safe fallback.",
    body: `# Cognix Cloud Email Skill

- Read \`read_cloud_guide({ feature: "email" })\`. When \`RESEND_API_KEY\` is present, check domain status with \`resend_email({ action: "status" })\`.
- Keep Resend in \`src/lib/email.ts\` (\`import "server-only"\`) with a clean fallback when \`RESEND_API_KEY\` or \`EMAIL_FROM\` is unset so user flows still succeed before Resend is connected in **Cloud → Emails**.
- Author reusable template helpers returning \`{ subject, text, html }\` with HTML-escaped user values, and trigger emails from validated server actions or routes.`,
  },
];

export function isBuiltinCloudSkillName(name: string): boolean {
  return BUILTIN_CLOUD_SKILLS.some((skill) => skill.name === name);
}

export function resolveBuiltinCloudSkills(names: string[]): BuiltinCloudSkill[] {
  if (!names.length) return [];
  return names.flatMap((name) => BUILTIN_CLOUD_SKILLS.filter((skill) => skill.name === name));
}

export function cloudSkillsContext(cloudEnabled: boolean): string {
  if (!cloudEnabled) return "";
  const blocks = CLOUD_ARCHITECTURE_SKILLS.map(
    (skill) =>
      `<cloud-skill name="${skill.name}">\nDescription: ${skill.description}\n\n${skill.instructions.map((line) => `- ${line}`).join("\n")}\n</cloud-skill>`,
  ).join("\n\n");

  return `## Built-in Cognix Cloud architecture skills

These first-party Cognix Cloud engineering skills are active because Cognix Cloud is **on** for this project. Follow them whenever building or updating database, authentication, file storage, or email features so the generated app works end to end on the first run.

${blocks}

`;
}
