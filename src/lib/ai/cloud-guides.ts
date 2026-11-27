import { CLOUD_FEATURES, type CloudFeature } from "../cloud-features";

/**
 * Internal instructions the build agent reads with the read_cloud_guide tool.
 * They are never listed with the user's skills or shown in the product UI. Import only from server code.
 */

const env = (feature: CloudFeature) => CLOUD_FEATURES[feature].env.map((name) => `\`${name}\``).join(", ");

const SHARED_RULES = `
## Rules for every Cognix Cloud feature

- Read configuration only from \`process.env\` on the server. Never import server secrets into client components, never prefix them with \`NEXT_PUBLIC_\`, and never print, log, or read \`.env*\` files.
- Cognix syncs the project's secrets into \`.env.local\` in the sandbox. The system prompt lists which secret names are set. If a required variable is missing, still write the integration against it, make the app fail with a clear message that names the missing variable (not a crash with a stack trace), and tell the user in your final response to add it in **Cloud → Secrets**.
- Keep each integration behind one server module (for example \`lib/db.ts\`, \`lib/storage.ts\`, \`lib/email.ts\`, \`lib/auth.ts\`) so routes and actions do not construct clients themselves.
- Validate every input at the server boundary with zod before it reaches the database, a bucket, or an email.
- Run the production build after integrating and fix every error before finishing.
`;

const DATABASE_GUIDE = `# Cognix Cloud: Managed Neon PostgreSQL Database

Use the project's Cognix-managed Neon serverless PostgreSQL database through ${env("database")} (pooled) and \`DIRECT_URL\` (unpooled, for migrations).

## Managed Neon Tool (\`neon_database\`)

Cognix manages this project's Neon database on the server via \`NEON_API_KEY\`. Never ask the user for a Neon API key or database URL when Cognix Cloud is on:
- If \`DATABASE_URL\` is not listed in project secrets yet, call \`neon_database\` with \`{ "action": "provision" }\` first. Cognix creates an isolated Neon PostgreSQL project and syncs \`DATABASE_URL\` and \`DIRECT_URL\` into \`.env.local\` automatically.
- Use \`neon_database\` whenever you need Neon platform features:
  - \`status\` / \`inspect_schema\` / \`compare_schema\`: inspect live tables, columns, DDL, or diff two branches.
  - \`run_sql\`: run DDL/DML/SELECT queries directly against Neon.
  - \`create_branch\`, \`restore_branch\`, \`set_default_branch\`, \`delete_branch\`: create instant copy-on-write branches (for risky migrations or testing) or point-in-time restores.
  - \`create_database\`, \`create_role\`, \`reset_role_password\`: manage databases and roles.
  - \`create_endpoint\`, \`update_endpoint\`, \`start_endpoint\`, \`suspend_endpoint\`, \`restart_endpoint\`: manage compute autoscaling or read-only replicas.
  - \`create_snapshot\`, \`restore_snapshot\`, \`use_connection\`: create/restore snapshots or point \`.env.local\` at a specific branch/database.

## Application Code Setup

1. Install \`drizzle-orm\`, \`pg\`, and dev dependencies \`drizzle-kit\` and \`@types/pg\` (or \`@neondatabase/serverless\` if appropriate). Cognix Cloud exclusively uses Drizzle ORM and PostgreSQL — never install Prisma, SQLite, Supabase, Firebase, MongoDB, or another database/ORM.
2. Create \`lib/db.ts\`:
   \`\`\`ts
   import "server-only";
   import { drizzle } from "drizzle-orm/node-postgres";
   import { Pool } from "pg";
   import * as schema from "./schema";

   const connectionString = process.env.DATABASE_URL;
   if (!connectionString) throw new Error("DATABASE_URL is not set. Provision Neon in Cloud → Database.");

   const globalForDb = globalThis as unknown as { pool?: Pool };
   export const pool = globalForDb.pool ?? new Pool({ connectionString, max: 5 });
   if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;
   export const db = drizzle(pool, { schema });
   \`\`\`
   Import \`server-only\` (install it) so the module can never reach the browser. Reuse the pool across hot reloads as shown.
3. Define tables in \`lib/schema.ts\` with \`pgTable\`. Use \`uuid("id").defaultRandom().primaryKey()\`, \`timestamp(..., { withTimezone: true }).defaultNow().notNull()\`, foreign keys with \`onDelete\`, and indexes for columns you filter or sort by.
4. Add \`drizzle.config.ts\` (\`dialect: "postgresql"\`, \`schema: "./lib/schema.ts"\`, \`dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL! }\`) and apply changes with \`npx drizzle-kit push\` (or \`neon_database\` \`run_sql\`). Report the result.

## Using it

- Query from server components, route handlers, or server actions only. Use the query builder or parameterized \`sql\` template; never concatenate user input into SQL.
- Scope every read and write to the signed-in user when the data is personal (\`where(eq(table.userId, session.user.id))\`).
- Paginate lists and return only the columns the UI needs.
- Design loading, empty, and error states for data views.
${SHARED_RULES}`;

const STORAGE_GUIDE = `# Cognix Cloud: Storage buckets

Use S3-compatible object storage through ${env("storage")}.

## Setup

1. Install \`@aws-sdk/client-s3\` and \`@aws-sdk/s3-request-presigner\`.
2. Create \`lib/storage.ts\` (import \`server-only\`) that builds one \`S3Client\` with \`endpoint\`, \`region\`, \`forcePathStyle: true\`, and the access key pair, and exports small helpers: \`createUploadUrl(key, contentType)\`, \`createDownloadUrl(key)\`, and \`deleteObject(key)\`.
3. Treat buckets as private. Serve files with short-lived signed GET URLs (5-15 minutes) instead of public URLs, unless the user explicitly wants public assets.

## Uploads

- Upload directly from the browser with a signed PUT URL created by a server action or route after checking the user is allowed to upload.
- Validate content type and maximum size on the server before signing, and generate the object key server-side, for example \`users/{userId}/{uuid}-{safeFileName}\`. Never trust a client-provided key or path.
- Store the object key (not the signed URL) in the database next to the record that owns it.
- Show upload progress, a clear error with a retry action, and an image preview when relevant.
${SHARED_RULES}`;

const EMAIL_GUIDE = `# Cognix Cloud: Emails with Resend

Send transactional and broadcast email through Resend using ${env("email")}.

## Resend Management Tool (\`resend_email\`)

Users connect their own Resend account in **Cloud → Emails**. When \`RESEND_API_KEY\` is set, you can use \`resend_email\` to:
- Check verified sending domains, add/verify domains, or configure open/click tracking (\`status\`, \`list_domains\`, \`create_domain\`, \`verify_domain\`, \`update_domain\`, \`set_default_from\`).
- Send test/transactional/batch emails, inspect delivery status, or cancel scheduled emails (\`send_email\`, \`send_batch_emails\`, \`list_emails\`, \`get_email\`, \`cancel_email\`).
- Manage audiences, contacts, broadcasts, and webhooks (\`create_audience\`, \`create_contact\`, \`create_broadcast\`, \`create_webhook\`, etc.).
If \`RESEND_API_KEY\` is not set yet, still write the full \`lib/email.ts\` integration with the safe fallback below and tell the user they can connect their Resend API key in **Cloud → Emails**.

## Setup

1. Install \`resend\`.
2. Create \`lib/email.ts\` (import \`server-only\`):
   \`\`\`ts
   import "server-only";
   import { Resend } from "resend";

   const apiKey = process.env.RESEND_API_KEY;
   const from = process.env.EMAIL_FROM;
   const resend = apiKey ? new Resend(apiKey) : null;

   export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }) {
     if (!resend || !from) {
       // Development fallback so flows keep working before Resend is connected in Cloud → Emails.
       console.info(\`[email disabled] to=\${input.to} subject=\${input.subject}\`);
       return { skipped: true as const };
     }
     const { error } = await resend.emails.send({ from, ...input });
     if (error) throw new Error(\`Email could not be sent: \${error.message}\`);
     return { skipped: false as const };
   }
   \`\`\`
   Never log the email body when it contains links with tokens.
3. Keep templates as small functions that return \`{ subject, text, html }\`. Always include a plain-text version, and escape any user-provided values placed in HTML.

## Rules

- Send email only from server code, after validating the recipient and rate-limiting endpoints that trigger email (sign-up, password reset, invites).
- Do not await email delivery inside latency-sensitive auth callbacks; start it and handle errors without exposing whether an address exists.
${SHARED_RULES}`;

const AUTH_GUIDE = `# Cognix Cloud: Authentication with Better Auth

Authentication must use **Better Auth** with email and password, stored in the Cognix Cloud database. Required: ${env("auth")}. Verification and reset emails use the Emails guide (\`lib/email.ts\`); read it too if that module does not exist yet.

## 1. Install

- \`npm install better-auth pg\` and \`npm install -D @types/pg\`. Read \`node_modules/better-auth/package.json\` to confirm the installed version before writing code.

## 2. Server config: \`lib/auth.ts\`

\`\`\`ts
import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { sendEmail } from "./email";

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      void sendEmail({ to: user.email, subject: "Reset your password", text: \`Reset your password: \${url}\` });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      void sendEmail({ to: user.email, subject: "Verify your email", text: \`Verify your email: \${url}\` });
    },
  },
  plugins: [nextCookies()], // keep nextCookies last
});
\`\`\`

- If the app already has a Drizzle \`db\`, you may use the Drizzle adapter instead of a separate Pool. In Better Auth 1.7+ it is \`drizzleAdapter\` from \`@better-auth/drizzle-adapter\` (install it); older versions export it from \`better-auth/adapters/drizzle\`. Use \`provider: "pg"\`.
- Do not hard-code \`baseURL\`. The preview and published app are served from different hosts, and Better Auth derives the URL from the incoming request. If sign-in fails with an untrusted-origin error, add the host to \`trustedOrigins\`.
- Do not send email synchronously inside these callbacks (\`void\` the promise), so response timing does not reveal whether an account exists.

## 3. Database tables

- With the built-in Pool connection, create the tables with \`npx auth@latest migrate --yes\` (Better Auth 1.5+; older versions use \`npx @better-auth/cli@latest migrate\`).
- With the Drizzle adapter, run \`npx auth@latest generate\` to write the schema, add it to the app schema, then \`npx drizzle-kit push\`.
- These need DATABASE_URL. If it is missing, write the code, skip the migration, and tell the user to add DATABASE_URL in Cloud → Secrets and ask you to finish setup.

## 4. Route handler: \`app/api/auth/[...all]/route.ts\`

\`\`\`ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
\`\`\`

## 5. Client: \`lib/auth-client.ts\`

\`\`\`ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
\`\`\`

- Sign up: \`authClient.signUp.email({ name, email, password })\`. Sign in: \`authClient.signIn.email({ email, password })\`. Sign out: \`authClient.signOut()\`. Session in client components: \`authClient.useSession()\`.
- Password reset: \`authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })\`, then on that page \`authClient.resetPassword({ newPassword, token })\` with the \`token\` query param. Check the installed version's method names if TypeScript reports them missing.

## 6. Protecting pages and data

- Server components and actions: \`const session = await auth.api.getSession({ headers: await headers() })\`; \`redirect("/sign-in")\` when it is null.
- Check the session again inside every server action and route handler that reads or changes user data. A hidden button is not access control.
- Use \`session.user.id\` as the owner key in app tables (\`user_id text not null references "user"(id) on delete cascade\`).

## 7. Screens to build

- \`/sign-up\`, \`/sign-in\`, \`/verify-email\` (check-your-inbox state with resend), \`/forgot-password\`, \`/reset-password\`, and a signed-in account menu with sign out.
- Use native form controls with labels, \`autocomplete\` attributes (\`email\`, \`current-password\`, \`new-password\`), visible focus rings, pending states, and inline errors that say how to recover. Do not reveal whether an email is registered.
${SHARED_RULES}`;

export const CLOUD_GUIDES: Record<CloudFeature, string> = {
  database: DATABASE_GUIDE,
  storage: STORAGE_GUIDE,
  email: EMAIL_GUIDE,
  auth: AUTH_GUIDE,
};
