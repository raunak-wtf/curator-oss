export type InternalCloudSkill = {
  name: string;
  description: string;
  instructions: readonly string[];
};

/**
 * First-party internal Cognix Cloud skills (modeled after FRONTEND_TASTE_SKILLS).
 * They are NEVER shown in the `/` skills menu and NEVER require the user to invoke a skill or
 * name backend libraries. They run automatically inside the agent's system prompt on every build.
 */
export const CLOUD_DETECTION_SKILL: InternalCloudSkill = {
  name: "cognix-cloud-auto-detection",
  description: "Automatically map plain-English product ideas to Cognix Cloud services before coding.",
  instructions: [
    "Users describe products in plain language without naming databases, auth libraries, or storage SDKs. Infer which Cognix Cloud capabilities the product genuinely needs:",
    "  • Persistent records, dashboards, CRUD lists, notes, tasks, orders, comments, share links, analytics, or settings → `database`.",
    "  • Sign-up, sign-in, user accounts, personal workspaces, teams, roles, or private user-owned data → `auth` + `database` (add `email` too only if the app sends verification, password-reset, or transactional emails).",
    "  • Avatars, image galleries, document/PDF attachments, deliverables, audio/video, or user file uploads → `storage`.",
    "  • Invites, client email updates, receipts, alerts, digests, or email verification/password reset → `email`.",
    "While Cognix Cloud is **off**, if the prompt needs ANY of those capabilities, call `request_cognix_cloud` on your very first turn with a concise one-sentence `reason` and the complete `features` array needed by the prompt. When automatic Cloud provisioning is active on the server, `request_cognix_cloud` unlocks and provisions Cognix Cloud immediately so you can keep building in the very next step; otherwise wait for user approval. Never build a fake `localStorage` or in-memory substitute first.",
    "Purely client-side utilities (calculators, timers, unit converters, static marketing pages, client-only arcade games) do not need Cognix Cloud—build them directly without calling `request_cognix_cloud`.",
  ],
};

export const CLOUD_ARCHITECTURE_SKILLS: readonly InternalCloudSkill[] = [
  {
    name: "cognix-cloud-orchestration",
    description: "Fast, reliable incremental execution order when Cognix Cloud is enabled.",
    instructions: [
      "Automatically map plain-English product requirements to the Cognix Cloud stack without waiting for the user to mention backend libraries.",
      "Review the **Live Cognix Cloud resource state** in the system prompt to see which secrets, PostgreSQL tables/columns, and Storage buckets already exist right now.",
      "Call `read_cloud_guide` ONLY for the Cloud features this app actually uses (skip `email` and `resend` when the user did not ask for email sending or email verification).",
      "Check the configured secret names listed in the system prompt: if `DATABASE_URL` is missing and the app uses Database or Auth, call `neon_database({ action: \"provision\" })`; if `S3_BUCKET` is missing and the app uses Storage, call `cloud_storage({ action: \"provision\" })` (or `create_bucket` with `accessMode: \"public\"` when inline image thumbnails or public share links need direct CDN URLs).",
      "On a brand-new project with no `package.json`, never run `npx create-next-app .` in the project root because `.env.local` and `public/__cognix_visual_edit.js` already exist there. Instead, write `package.json`, `tsconfig.json`, `next.config.ts` (including `serverExternalPackages: [\"pg\", \"better-auth\", \"drizzle-orm\", \"@aws-sdk/client-s3\", \"@aws-sdk/s3-request-presigner\", \"resend\"]` and `images: { remotePatterns: [{ protocol: \"https\", hostname: \"**\" }] }`), and `postcss.config.mjs` directly, preserving `.env.local` and `public/__cognix_visual_edit.js`.",
      "Keep every turn fast and reliable: write **at most 3–4 files per turn**! Never attempt to output 8–12 files in a single completion (large completions risk gateway timeouts and token-limit truncation). Execute a clean, single-prompt full-stack sequence:",
      "  1. Turn 1 — Guides, config & single install: batch `list_files`, `read_cloud_guide` (only for needed features), and `read_design_guide`, then write `package.json`, `tsconfig.json`, `next.config.ts`, and `postcss.config.mjs`, followed by ONE `npm install --no-audit --no-fund` installing all frontend + Cloud packages together.",
      "  2. Turn 2 — Schema, database client & guaranteed migration: write pure `src/lib/schema.ts` (NO `import \"server-only\"` or `@/` aliases inside `schema.ts`; include Better Auth's 4 tables when auth is used), `src/lib/db.ts` (using `pg.Pool` + `drizzle-orm/node-postgres`, never `neon-http` when Better Auth is used), and `drizzle.config.ts` (`process.loadEnvFile(\".env.local\")`). Run `npx drizzle-kit generate && npx drizzle-kit push --force` (using multi-statement `neon_database({ action: \"run_sql\" })` as an immediate fallback or for seed data) and confirm live tables with `neon_database({ action: \"inspect_schema\" })`.",
      "  3. Turn 3 — Auth & Storage plumbing (3–4 files): write `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, and (when Storage is used) `src/lib/storage.ts`, `src/app/api/storage/upload/route.ts`, and `src/app/api/storage/file/[...key]/route.ts`.",
      "  4. Turn 4 — API routes / Server Actions (3–4 files per turn) with `zod` validation, `auth.api.getSession` ownership checks, `revalidatePath`, and `console.error` logging in `catch` blocks.",
      "  5. Turn 5+ — Design-system UI, auth screens (`/sign-in`, `/sign-up`), and core product workflows (3–4 files per turn) with empty, loading, dense, and recoverable error states.",
      "  6. Final verification & self-healing: run `npm run build` until exit code 0, then start the production server in background (`npm run start -- --hostname 0.0.0.0 --port 3000`, which keeps sandbox memory low and serves SSR/auth/storage routes at production speed), probe `/`, `/sign-in`, `/sign-up`, and `/api/auth/get-session` via `inspect_preview` + `read_preview_console` to confirm HTTP 200/3xx and zero runtime errors, and call `get_preview_url`.",
    ],
  },
  {
    name: "neon-postgres-and-drizzle",
    description: "PostgreSQL schema design, connection pooling, and non-interactive Drizzle migrations.",
    instructions: [
      "Keep all database access behind `src/lib/db.ts` (or `lib/db.ts` matching `tsconfig.json`) with `import \"server-only\"` and a hot-reload-safe `pg.Pool` singleton (`max: 5`, `idleTimeoutMillis: 20_000`, `connectionTimeoutMillis: 15_000`, `allowExitOnIdle: true`) reading `process.env.DATABASE_URL`. Never use `drizzle-orm/neon-http` with Better Auth because Better Auth requires interactive transactions.",
      "Keep `src/lib/schema.ts` strictly pure Drizzle table definitions (no `import \"server-only\"` or `@/` imports) so `drizzle-kit` loads it cleanly in Node.",
      "In `drizzle.config.ts`, load `.env.local` explicitly at the top (`import { existsSync } from \"node:fs\"; if (existsSync(\".env.local\")) process.loadEnvFile(\".env.local\");`) because `drizzle-kit` only loads `.env` by default while Cognix syncs secrets into `.env.local`. Point `dbCredentials.url` at `process.env.DIRECT_URL || process.env.DATABASE_URL!`.",
      "Always run `npx drizzle-kit generate && npx drizzle-kit push --force` whenever `schema.ts` changes so SQL migrations are tracked in `./drizzle` and schema pushes never hang on interactive prompts. Before destructive schema changes on an app with live user data, create a copy-on-write safety branch via `neon_database({ action: \"create_branch\", name: \"pre-migration\" })`.",
      "Add `export const dynamic = \"force-dynamic\";` on Server Component pages that read `headers()`/`cookies()` or live database rows so `npm run build` never fails attempting static generation.",
      "Model relational tables with explicit foreign keys (`onDelete: \"cascade\"` or `\"set null\"`), `timestamp(..., { withTimezone: true }).defaultNow().notNull()`, and indexes on `user_id`, foreign keys, share tokens, status, and sort columns. Never concatenate user input into raw SQL.",
    ],
  },
  {
    name: "better-auth-fullstack",
    description: "Zero-conflict Better Auth + Drizzle schema, cross-origin preview-iframe cookies, and complete auth flows.",
    instructions: [
      "Whenever an app uses Better Auth, define Better Auth's four core tables (`user`, `session`, `account`, `verification`) inside the exact same `schema.ts` file as your application tables and pass `drizzleAdapter(db, { provider: \"pg\", schema })` from `better-auth/adapters/drizzle`. Never mix Kysely `npx auth migrate` with `drizzle-kit push`.",
      "If the app does not use email (or `RESEND_API_KEY` is not set), configure `emailAndPassword: { enabled: true, autoSignIn: true, requireEmailVerification: false }` directly—no `resend` package needed! If email IS part of the app, gate `requireEmailVerification` on `Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` so sign-up works immediately before email credentials are connected.",
      "In `src/lib/auth.ts`, set `baseURL: process.env.BETTER_AUTH_URL || \"http://localhost:3000\"`, check `const isHostedHttps = process.env.NODE_ENV === \"production\" || process.env.COGNIX_HOSTED_PREVIEW === \"1\" || process.env.CI === \"1\";`, and set `advanced: isHostedHttps ? { useSecureCookies: true, defaultCookieAttributes: { sameSite: \"none\", secure: true, partitioned: true } } : undefined` plus wildcard/dynamic `trustedOrigins` (`https://*.daytona.work`, `https://*.daytona.works`, `https://*.daytonaproxy01.net`, `https://*.curatorsite.in`, `https://*.curator.codes`, `process.env.BETTER_AUTH_URL`, and `request.headers` `origin`/`x-forwarded-host`) so session cookies and CSRF checks work inside Cognix's cross-origin HTTPS preview iframe!",
      "In `src/lib/auth-client.ts`, ALWAYS pass `baseURL: typeof window !== \"undefined\" ? window.location.origin : (process.env.BETTER_AUTH_URL || \"http://localhost:3000\")` — NEVER use `process.env.NEXT_PUBLIC_APP_URL || \"http://localhost:3000\"`, which breaks hosted previews by calling `localhost:3000` from the visitor's browser!",
      "Enforce `const session = await auth.api.getSession({ headers: await headers() })` inside protected server pages/layouts AND inside every mutating server action or API route, scoping queries to `session.user.id`.",
    ],
  },
  {
    name: "bucketline-s3-storage-and-cdn",
    description: "CORS-safe Cloud S3 uploads, AWS SDK v3 checksum compatibility, 50 MB validation, CDN URLs, and same-origin streaming.",
    instructions: [
      "Configure `S3Client` in `src/lib/storage.ts` (`import \"server-only\"`) with `endpoint: process.env.S3_ENDPOINT`, `region: process.env.S3_REGION || \"auto\"`, `forcePathStyle: true`, `requestChecksumCalculation: \"WHEN_REQUIRED\"`, and `responseChecksumValidation: \"WHEN_REQUIRED\"`. The two checksum flags are mandatory on `@aws-sdk/client-s3` v3.729+ because default `WHEN_SUPPORTED` checksums append `x-amz-checksum-mode=ENABLED` and cause `HTTP 403 SignatureDoesNotMatch` on Cloud Storage.",
      "Route browser file uploads through an authenticated same-origin Next.js Route Handler (`POST /api/storage/upload` reading `request.formData()`) that checks `auth.api.getSession`, validates MIME type and `file.size <= 50 * 1024 * 1024` (50 MB hard limit), generates a sanitized server key (`users/${session.user.id}/${crypto.randomUUID()}-${safeName}`), and uploads via `PutObjectCommand`. Never `PUT` directly from browser `fetch` to the external S3 endpoint.",
      "Persist the stable `objectKey` (plus filename, contentType, and byte size) in PostgreSQL—never store expiring presigned URLs in database columns. Serve uploaded files and downloads reliably through a same-origin `GET /api/storage/file/[...key]` Route Handler (supporting `?download=1` for `Content-Disposition: attachment`) instead of `@aws-sdk/s3-request-presigner` `getSignedUrl` (never pass `ResponseContentDisposition` into S3 presigned URLs), and delete S3 objects when their owning PostgreSQL row is deleted.",
    ],
  },
  {
    name: "resend-transactional-email",
    description: "Transactional email module, graceful dev fallback, and non-blocking auth hooks.",
    instructions: [
      "Only install `resend` and create `src/lib/email.ts` when the app actually sends emails (invites, updates, receipts, or email verification/password reset). Export `isEmailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` and make `sendEmail` return `{ skipped: true }` cleanly when unconfigured.",
      "When `RESEND_API_KEY` is listed in project secret names, call `resend_email({ action: \"status\" })` or `list_domains` to inspect verified domains and ensure `EMAIL_FROM` matches a verified sender.",
      "Always include both `text` and HTML-escaped `html` bodies, never log reset/verification URLs containing secret tokens, and invoke `void sendEmail(...).catch(() => undefined)` non-blockingly inside auth callbacks.",
    ],
  },
];

function renderInternalSkill(skill: InternalCloudSkill): string {
  return `<cloud-skill name="${skill.name}">\nDescription: ${skill.description}\n\n${skill.instructions.map((line) => `- ${line}`).join("\n")}\n</cloud-skill>`;
}

export function cloudSkillsContext(cloudEnabled: boolean): string {
  if (!cloudEnabled) {
    return `## Built-in Cognix Cloud intelligence

This internal Cognix skill is always active in Build mode so you automatically recognize when a plain-English app request needs Cognix Cloud without the user naming any backend packages or skills.

${renderInternalSkill(CLOUD_DETECTION_SKILL)}

`;
  }

  const blocks = CLOUD_ARCHITECTURE_SKILLS.map(renderInternalSkill).join("\n\n");
  return `## Built-in Cognix Cloud architecture skills

These internal Cognix engineering skills are always active when Cognix Cloud is **on**. Apply them automatically—without waiting for the user to mention skills, libraries, or infrastructure details—so every database, authentication, storage, and email flow works end to end on the first run.

${blocks}

`;
}
