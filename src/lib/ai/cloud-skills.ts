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
  description: "Automatically map plain-English product ideas to Cognix Cloud services and request consent before coding.",
  instructions: [
    "Users describe products in plain language without naming databases, auth libraries, or storage SDKs. Infer which Cognix Cloud capabilities the product genuinely needs:",
    "  • Persistent records, dashboards, CRUD lists, notes, tasks, orders, comments, share links, or settings → `database` (Managed Neon PostgreSQL + Drizzle ORM).",
    "  • Sign-up, sign-in, user accounts, personal workspaces, teams, roles, or private user-owned data → `auth` + `database` (Better Auth on Neon PostgreSQL; add `email` too only if the app sends verification, password-reset, or transactional emails).",
    "  • Avatars, image galleries, document/PDF attachments, deliverables, audio/video, or user file uploads → `storage` (Cognix Cloud Bucketline S3 Storage & CDN).",
    "  • Invites, client email updates, receipts, alerts, digests, or email verification/password reset → `email` (Resend).",
    "While Cognix Cloud is **off**, if the prompt needs ANY of those capabilities, call `request_cognix_cloud` on your very first turn with a concise one-sentence `reason` and the complete `features` array needed by the prompt, then immediately stop calling tools and end your turn. Never build a fake `localStorage` or in-memory substitute first, and never ask one feature at a time.",
    "Purely client-side utilities (calculators, timers, unit converters, static marketing pages, client-only arcade games) do not need Cognix Cloud—build them directly without asking.",
  ],
};

export const CLOUD_ARCHITECTURE_SKILLS: readonly InternalCloudSkill[] = [
  {
    name: "cognix-cloud-orchestration",
    description: "Fast, reliable incremental execution order when Cognix Cloud is enabled.",
    instructions: [
      "Automatically map plain-English product requirements to the Cognix Cloud stack without waiting for the user to mention Neon, Drizzle, Better Auth, S3, or Resend.",
      "Call `read_cloud_guide` ONLY for the Cloud features this app actually uses (skip `email` and `resend` when the user did not ask for email sending or email verification).",
      "Check the configured secret names listed in the system prompt: if `DATABASE_URL` is missing and the app uses Database or Auth, call `neon_database({ action: \"provision\" })`; if `S3_BUCKET` is missing and the app uses Storage, call `cloud_storage({ action: \"provision\" })` (or `create_bucket` with `accessMode: \"public\"` when public CDN media URLs are helpful).",
      "On a brand-new project with no `package.json`, never run `npx create-next-app .` in the project root because `.env.local` and `public/__cognix_visual_edit.js` already exist there. Instead, write `package.json`, `tsconfig.json`, `next.config.ts`, and `postcss.config.mjs` directly, preserving `.env.local` and `public/__cognix_visual_edit.js`.",
      "Keep every turn fast and reliable: write **at most 3–4 files per turn**! Never attempt to output 8–12 files in a single completion (large completions risk gateway timeouts and token-limit truncation). Progress steadily across quick turns:",
      "  1. Config & single install: write `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, then run ONE `npm install --no-audit --no-fund` installing all needed packages together.",
      "  2. Data layer: write `src/lib/schema.ts`, `src/lib/db.ts`, and `drizzle.config.ts`, then run `npx drizzle-kit push --force` and verify with `neon_database({ action: \"inspect_schema\" })`.",
      "  3. Cloud server modules (3–4 files): write `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, and `src/lib/storage.ts` (+ `src/lib/email.ts` only if email is used).",
      "  4. API routes / server actions (3–4 files per turn) with `zod` validation and `auth.api.getSession` ownership checks.",
      "  5. UI layout, auth screens, and product pages (3–4 files per turn) with empty, loading, dense, and recoverable error states.",
      "  6. Verification: run `npm run build` until exit code 0, start/verify the background dev server on `0.0.0.0:3000`, and call `inspect_preview` + `get_preview_url`.",
    ],
  },
  {
    name: "neon-postgres-and-drizzle",
    description: "Serverless Neon PostgreSQL schema design, Drizzle ORM pooling, and non-interactive migrations.",
    instructions: [
      "Keep all database access behind `src/lib/db.ts` (or `lib/db.ts` matching `tsconfig.json`) with `import \"server-only\"` and a hot-reload-safe `pg.Pool` singleton (`max: 5`) reading `process.env.DATABASE_URL`.",
      "In `drizzle.config.ts`, load `.env.local` explicitly at the top (`import { existsSync } from \"node:fs\"; if (existsSync(\".env.local\")) process.loadEnvFile(\".env.local\");`) because `drizzle-kit` only loads `.env` by default while Cognix syncs secrets into `.env.local`. Point `dbCredentials.url` at `process.env.DIRECT_URL || process.env.DATABASE_URL!`.",
      "Always run `npx drizzle-kit push --force` so schema pushes never hang on interactive TTY prompts. Before destructive schema changes on an app that already has live user data, create a copy-on-write safety branch first via `neon_database({ action: \"create_branch\", name: \"pre-migration\" })`.",
      "Model relational tables with explicit foreign keys (`onDelete: \"cascade\"` or `\"set null\"`), `timestamp(..., { withTimezone: true }).defaultNow().notNull()`, and indexes on `user_id`, foreign keys, status, and sort columns. Never concatenate user input into raw SQL.",
    ],
  },
  {
    name: "better-auth-fullstack",
    description: "Zero-conflict Better Auth + Drizzle schema, preview-iframe cookies, and complete auth flows.",
    instructions: [
      "Whenever an app uses Better Auth, define Better Auth's four core tables (`user`, `session`, `account`, `verification`) inside the exact same `schema.ts` file as your application tables and pass `drizzleAdapter(db, { provider: \"pg\", schema })` from `better-auth/adapters/drizzle`. Never mix Kysely `npx auth migrate` with `drizzle-kit push`.",
      "If the app does not use email (or `RESEND_API_KEY` is not set), configure `emailAndPassword: { enabled: true, autoSignIn: true, requireEmailVerification: false }` directly—no `resend` package needed! If email IS part of the app, gate `requireEmailVerification` on `Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` so sign-up still works immediately before Resend is connected.",
      "Configure dynamic `trustedOrigins` from `request.headers` (`origin`, `x-forwarded-host`, `x-forwarded-proto`) and set `advanced.defaultCookieAttributes` to `{ sameSite: \"none\", secure: true, partitioned: true }` when `process.env.NODE_ENV === \"production\" || process.env.CI === \"1\"` so Better Auth session cookies work inside Cognix's cross-origin preview iframe and on published custom domains.",
      "Enforce `const session = await auth.api.getSession({ headers: await headers() })` inside protected server pages/layouts AND inside every mutating server action or API route, scoping queries to `session.user.id`.",
    ],
  },
  {
    name: "bucketline-s3-storage-and-cdn",
    description: "CORS-safe Bucketline S3 uploads, 50 MB validation, CDN URLs, and presigned access.",
    instructions: [
      "Configure `S3Client` in `src/lib/storage.ts` (`import \"server-only\"`) with `endpoint: process.env.S3_ENDPOINT`, `region: process.env.S3_REGION || \"auto\"`, and `forcePathStyle: true`.",
      "Route browser file uploads through an authenticated same-origin Next.js Route Handler (`POST /api/storage/upload` reading `request.formData()`) that checks `auth.api.getSession`, validates MIME type and `file.size <= 50 * 1024 * 1024` (Bucketline's hard 50 MB limit), generates a sanitized server key (`users/${session.user.id}/${crypto.randomUUID()}-${safeName}`), and uploads via `PutObjectCommand`. Never `PUT` directly from browser `fetch` to the external S3 endpoint, which avoids cross-origin preview CORS failures.",
      "Persist the stable `objectKey` (plus filename, contentType, and byte size) in Neon PostgreSQL—never store expiring presigned URLs in database columns. Resolve display/download URLs on read using `S3_CDN_URL` when `S3_ACCESS_MODE === \"public\"` or a SigV4 presigned `GetObjectCommand` URL for private buckets, and delete S3 objects when their owning Postgres row is deleted.",
    ],
  },
  {
    name: "resend-transactional-email",
    description: "Resend transactional email module, graceful dev fallback, and non-blocking auth hooks.",
    instructions: [
      "Only install `resend` and create `src/lib/email.ts` when the app actually sends emails (invites, updates, receipts, or email verification/password reset). Export `isEmailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)` and make `sendEmail` return `{ skipped: true }` cleanly when unconfigured.",
      "When `RESEND_API_KEY` is listed in project secret names, call `resend_email({ action: \"status\" })` or `list_domains` to inspect verified domains and ensure `EMAIL_FROM` matches a verified sender.",
      "Always include both `text` and HTML-escaped `html` bodies, never log reset/verification URLs containing secret tokens, and invoke `void sendEmail(...).catch(() => undefined)` non-blockingly inside Better Auth callbacks.",
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
