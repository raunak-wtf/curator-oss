import type { CloudFeature } from "../cloud-features";

type DisallowedRule = {
  /** Exact package name or `@scope/` prefix (all lowercase). */
  pattern: string;
  prefix?: boolean;
  label: string;
  feature: CloudFeature;
};

type CloudPackageRule = {
  pattern: string;
  prefix?: boolean;
  label: string;
  feature: CloudFeature;
};

const FEATURE_REPLACEMENTS: Record<CloudFeature, string> = {
  database:
    "Cognix Cloud Managed Neon PostgreSQL (`DATABASE_URL` / `DIRECT_URL` with `drizzle-orm`, `drizzle-kit`, and `pg` or `@neondatabase/serverless`, managed via `neon_database`)",
  auth:
    "Cognix Cloud Authentication (`better-auth` backed by Managed Neon PostgreSQL via `DATABASE_URL` and `BETTER_AUTH_SECRET`)",
  email:
    "Cognix Cloud Emails (`resend` with `RESEND_API_KEY` and `EMAIL_FROM`, managed via `resend_email`)",
  storage:
    "Cognix Cloud Storage (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with `S3_*` project secrets)",
};

const DISALLOWED_PACKAGE_RULES: readonly DisallowedRule[] = [
  // Competing ORMs & non-Neon / local databases
  { pattern: "prisma", label: "Prisma", feature: "database" },
  { pattern: "@prisma/", prefix: true, label: "Prisma", feature: "database" },
  { pattern: "better-sqlite3", label: "SQLite (better-sqlite3)", feature: "database" },
  { pattern: "@types/better-sqlite3", label: "SQLite (better-sqlite3)", feature: "database" },
  { pattern: "sqlite3", label: "SQLite (sqlite3)", feature: "database" },
  { pattern: "sqlite", label: "SQLite", feature: "database" },
  { pattern: "sql.js", label: "SQLite (sql.js)", feature: "database" },
  { pattern: "@libsql/", prefix: true, label: "LibSQL / Turso", feature: "database" },
  { pattern: "libsql", label: "LibSQL / Turso", feature: "database" },
  { pattern: "@tursodatabase/", prefix: true, label: "Turso", feature: "database" },
  { pattern: "supabase", label: "Supabase", feature: "database" },
  { pattern: "@supabase/", prefix: true, label: "Supabase", feature: "database" },
  { pattern: "firebase", label: "Firebase", feature: "database" },
  { pattern: "firebase-admin", label: "Firebase Admin", feature: "database" },
  { pattern: "firebase-tools", label: "Firebase CLI", feature: "database" },
  { pattern: "@firebase/", prefix: true, label: "Firebase", feature: "database" },
  { pattern: "convex", label: "Convex", feature: "database" },
  { pattern: "pocketbase", label: "PocketBase", feature: "database" },
  { pattern: "appwrite", label: "Appwrite", feature: "database" },
  { pattern: "node-appwrite", label: "Appwrite", feature: "database" },
  { pattern: "aws-amplify", label: "AWS Amplify", feature: "database" },
  { pattern: "@aws-amplify/", prefix: true, label: "AWS Amplify", feature: "database" },
  { pattern: "mongodb", label: "MongoDB", feature: "database" },
  { pattern: "mongoose", label: "Mongoose / MongoDB", feature: "database" },
  { pattern: "mysql", label: "MySQL", feature: "database" },
  { pattern: "mysql2", label: "MySQL (mysql2)", feature: "database" },
  { pattern: "mariadb", label: "MariaDB", feature: "database" },
  { pattern: "@planetscale/", prefix: true, label: "PlanetScale", feature: "database" },
  { pattern: "typeorm", label: "TypeORM", feature: "database" },
  { pattern: "sequelize", label: "Sequelize", feature: "database" },
  { pattern: "knex", label: "Knex", feature: "database" },
  { pattern: "mikro-orm", label: "MikroORM", feature: "database" },
  { pattern: "@mikro-orm/", prefix: true, label: "MikroORM", feature: "database" },
  { pattern: "kysely", label: "Kysely", feature: "database" },
  { pattern: "lowdb", label: "Lowdb", feature: "database" },
  { pattern: "nedb", label: "NeDB", feature: "database" },
  { pattern: "level", label: "LevelDB", feature: "database" },
  { pattern: "pouchdb", label: "PouchDB", feature: "database" },
  { pattern: "lokijs", label: "LokiJS", feature: "database" },
  { pattern: "faunadb", label: "Fauna", feature: "database" },
  { pattern: "surrealdb", label: "SurrealDB", feature: "database" },
  { pattern: "edgedb", label: "EdgeDB", feature: "database" },
  { pattern: "@vercel/postgres", label: "Vercel Postgres", feature: "database" },
  { pattern: "@vercel/kv", label: "Vercel KV", feature: "database" },
  { pattern: "@upstash/", prefix: true, label: "Upstash", feature: "database" },

  // Competing or DIY authentication stacks
  { pattern: "clerk", label: "Clerk", feature: "auth" },
  { pattern: "@clerk/", prefix: true, label: "Clerk", feature: "auth" },
  { pattern: "next-auth", label: "NextAuth / Auth.js", feature: "auth" },
  { pattern: "@auth/", prefix: true, label: "Auth.js", feature: "auth" },
  { pattern: "auth0", label: "Auth0", feature: "auth" },
  { pattern: "@auth0/", prefix: true, label: "Auth0", feature: "auth" },
  { pattern: "@kinde-oss/", prefix: true, label: "Kinde Auth", feature: "auth" },
  { pattern: "lucia", label: "Lucia Auth", feature: "auth" },
  { pattern: "@lucia-auth/", prefix: true, label: "Lucia Auth", feature: "auth" },
  { pattern: "@workos-inc/", prefix: true, label: "WorkOS AuthKit", feature: "auth" },
  { pattern: "supertokens-node", label: "SuperTokens", feature: "auth" },
  { pattern: "supertokens-auth-react", label: "SuperTokens", feature: "auth" },
  { pattern: "supertokens-web-js", label: "SuperTokens", feature: "auth" },
  { pattern: "@stytch/", prefix: true, label: "Stytch", feature: "auth" },
  { pattern: "@descope/", prefix: true, label: "Descope", feature: "auth" },
  { pattern: "passport", label: "Passport.js", feature: "auth" },
  { pattern: "passport-local", label: "Passport.js", feature: "auth" },
  { pattern: "passport-jwt", label: "Passport.js", feature: "auth" },
  { pattern: "iron-session", label: "iron-session", feature: "auth" },
  { pattern: "bcrypt", label: "custom bcrypt auth", feature: "auth" },
  { pattern: "@types/bcrypt", label: "custom bcrypt auth", feature: "auth" },
  { pattern: "bcryptjs", label: "custom bcryptjs auth", feature: "auth" },
  { pattern: "@types/bcryptjs", label: "custom bcryptjs auth", feature: "auth" },
  { pattern: "argon2", label: "custom argon2 auth", feature: "auth" },
  { pattern: "jsonwebtoken", label: "custom JWT auth (jsonwebtoken)", feature: "auth" },
  { pattern: "@types/jsonwebtoken", label: "custom JWT auth (jsonwebtoken)", feature: "auth" },

  // Competing email providers
  { pattern: "nodemailer", label: "Nodemailer", feature: "email" },
  { pattern: "@types/nodemailer", label: "Nodemailer", feature: "email" },
  { pattern: "@sendgrid/", prefix: true, label: "SendGrid", feature: "email" },
  { pattern: "mailgun.js", label: "Mailgun", feature: "email" },
  { pattern: "mailgun-js", label: "Mailgun", feature: "email" },
  { pattern: "postmark", label: "Postmark", feature: "email" },
  { pattern: "@aws-sdk/client-ses", label: "AWS SES", feature: "email" },
  { pattern: "@aws-sdk/client-sesv2", label: "AWS SES", feature: "email" },
  { pattern: "@getbrevo/", prefix: true, label: "Brevo", feature: "email" },
  { pattern: "sib-api-v3-sdk", label: "Brevo", feature: "email" },
  { pattern: "@mailchimp/", prefix: true, label: "Mailchimp", feature: "email" },
  { pattern: "plunk", label: "Plunk", feature: "email" },
  { pattern: "@plunk/", prefix: true, label: "Plunk", feature: "email" },

  // Competing object/file storage providers
  { pattern: "uploadthing", label: "UploadThing", feature: "storage" },
  { pattern: "@uploadthing/", prefix: true, label: "UploadThing", feature: "storage" },
  { pattern: "cloudinary", label: "Cloudinary", feature: "storage" },
  { pattern: "next-cloudinary", label: "Cloudinary", feature: "storage" },
  { pattern: "@vercel/blob", label: "Vercel Blob", feature: "storage" },
  { pattern: "@edgestore/", prefix: true, label: "EdgeStore", feature: "storage" },
  { pattern: "@google-cloud/storage", label: "Google Cloud Storage SDK", feature: "storage" },
  { pattern: "@azure/storage-blob", label: "Azure Blob Storage", feature: "storage" },
];

const COGNIX_CLOUD_PACKAGE_RULES: readonly CloudPackageRule[] = [
  { pattern: "drizzle-orm", label: "Drizzle ORM", feature: "database" },
  { pattern: "drizzle-kit", label: "Drizzle Kit", feature: "database" },
  { pattern: "pg", label: "PostgreSQL client (pg)", feature: "database" },
  { pattern: "@types/pg", label: "PostgreSQL types (@types/pg)", feature: "database" },
  { pattern: "@neondatabase/serverless", label: "Neon serverless driver", feature: "database" },
  { pattern: "postgres", label: "PostgreSQL client (postgres)", feature: "database" },
  { pattern: "better-auth", label: "Better Auth", feature: "auth" },
  { pattern: "@better-auth/", prefix: true, label: "Better Auth", feature: "auth" },
  { pattern: "resend", label: "Resend", feature: "email" },
  { pattern: "@aws-sdk/client-s3", label: "Cognix Cloud Storage (S3 client)", feature: "storage" },
  { pattern: "@aws-sdk/s3-request-presigner", label: "Cognix Cloud Storage (S3 presigner)", feature: "storage" },
];

const DISALLOWED_ENV_RULES: readonly { name: string; label: string; feature: CloudFeature }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase", feature: "database" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase", feature: "database" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase", feature: "database" },
  { name: "SUPABASE_URL", label: "Supabase", feature: "database" },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", label: "Clerk", feature: "auth" },
  { name: "CLERK_SECRET_KEY", label: "Clerk", feature: "auth" },
  { name: "NEXT_PUBLIC_FIREBASE_API_KEY", label: "Firebase", feature: "database" },
  { name: "FIREBASE_PROJECT_ID", label: "Firebase", feature: "database" },
  { name: "MONGODB_URI", label: "MongoDB", feature: "database" },
  { name: "TURSO_DATABASE_URL", label: "Turso", feature: "database" },
  { name: "TURSO_AUTH_TOKEN", label: "Turso", feature: "database" },
  { name: "NEXTAUTH_SECRET", label: "NextAuth / Auth.js", feature: "auth" },
  { name: "AUTH_SECRET", label: "Auth.js", feature: "auth" },
  { name: "AUTH0_SECRET", label: "Auth0", feature: "auth" },
  { name: "SENDGRID_API_KEY", label: "SendGrid", feature: "email" },
  { name: "MAILGUN_API_KEY", label: "Mailgun", feature: "email" },
  { name: "POSTMARK_SERVER_TOKEN", label: "Postmark", feature: "email" },
  { name: "UPLOADTHING_TOKEN", label: "UploadThing", feature: "storage" },
  { name: "UPLOADTHING_SECRET", label: "UploadThing", feature: "storage" },
  { name: "CLOUDINARY_URL", label: "Cloudinary", feature: "storage" },
  { name: "BLOB_READ_WRITE_TOKEN", label: "Vercel Blob", feature: "storage" },
];

const COGNIX_CLOUD_ENV_RULES: readonly { name: string; label: string; feature: CloudFeature }[] = [
  { name: "DATABASE_URL", label: "DATABASE_URL", feature: "database" },
  { name: "DIRECT_URL", label: "DIRECT_URL", feature: "database" },
  { name: "BETTER_AUTH_SECRET", label: "BETTER_AUTH_SECRET", feature: "auth" },
  { name: "RESEND_API_KEY", label: "RESEND_API_KEY", feature: "email" },
  { name: "EMAIL_FROM", label: "EMAIL_FROM", feature: "email" },
  { name: "S3_ENDPOINT", label: "S3_ENDPOINT", feature: "storage" },
  { name: "S3_BUCKET", label: "S3_BUCKET", feature: "storage" },
  { name: "S3_ACCESS_KEY_ID", label: "S3_ACCESS_KEY_ID", feature: "storage" },
  { name: "S3_SECRET_ACCESS_KEY", label: "S3_SECRET_ACCESS_KEY", feature: "storage" },
  { name: "S3_CDN_URL", label: "S3_CDN_URL", feature: "storage" },
  { name: "S3_ACCESS_MODE", label: "S3_ACCESS_MODE", feature: "storage" },
];

function matchRule<T extends { pattern: string; prefix?: boolean }>(pkg: string, rules: readonly T[]): T | null {
  const normalized = pkg.toLowerCase();
  for (const rule of rules) {
    if (rule.prefix ? normalized.startsWith(rule.pattern) : normalized === rule.pattern) {
      return rule;
    }
  }
  return null;
}

export function matchDisallowedPackage(pkg: string): DisallowedRule | null {
  return matchRule(pkg, DISALLOWED_PACKAGE_RULES);
}

export function matchCognixCloudPackage(pkg: string): CloudPackageRule | null {
  return matchRule(pkg, COGNIX_CLOUD_PACKAGE_RULES);
}

export function packageNameFromInstallSpec(rawToken: string): string | null {
  const token = rawToken.trim().replace(/^['"]+|['"]+$/g, "");
  if (
    !token ||
    token.startsWith("-") ||
    token.startsWith(".") ||
    token.startsWith("/") ||
    token.startsWith("$") ||
    /^(?:https?|git|file|workspace|npm):/i.test(token) ||
    /[=<>|;&()`]/.test(token)
  ) {
    return null;
  }
  if (token.startsWith("@")) {
    const match = token.match(/^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)(?:@.+)?$/i);
    return match ? match[1].toLowerCase() : null;
  }
  const match = token.match(/^([a-z0-9-~][a-z0-9-._~]*)(?:@.+)?$/i);
  return match ? match[1].toLowerCase() : null;
}

export function packageNameFromImportSpec(rawSpecifier: string): string | null {
  const spec = rawSpecifier.trim();
  if (
    !spec ||
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("@/") ||
    spec.startsWith("~/") ||
    spec.startsWith("#") ||
    /^(?:node|https?|data|bun|deno):/i.test(spec)
  ) {
    return null;
  }
  if (spec.startsWith("@")) {
    const match = spec.match(/^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)(?:\/.*)?$/i);
    return match ? match[1].toLowerCase() : null;
  }
  const match = spec.match(/^([a-z0-9-~][a-z0-9-._~]*)(?:\/.*)?$/i);
  return match ? match[1].toLowerCase() : null;
}

function formatDisallowedStackError(detectedLabel: string, feature: CloudFeature, cloudEnabled: boolean): Error {
  const replacement = FEATURE_REPLACEMENTS[feature];
  const nextStep = cloudEnabled
    ? `Cognix Cloud is already on: call read_cloud_guide({ "feature": "${feature}" }) and implement this with ${replacement}.`
    : `Cognix Cloud is currently off: call request_cognix_cloud first (including "${feature}" in features) to ask for the user's consent, then implement this with ${replacement}.`;
  return new Error(
    `Stack policy: ${detectedLabel} is not allowed in Cognix Build mode. Cognix apps exclusively use the Cognix Cloud tech stack — even if the prompt names another provider or database. Use ${replacement} instead. ${nextStep}`,
  );
}

function formatCloudConsentRequiredError(detectedLabel: string, features: CloudFeature[]): Error {
  const unique = [...new Set(features)];
  const featureList = unique.map((item) => `"${item}"`).join(", ");
  return new Error(
    `Consent required: Cognix Cloud is currently off for this project, so ${detectedLabel} cannot be installed or configured yet. Stop backend changes now, call request_cognix_cloud with features [${featureList}] and a clear one-sentence reason, and wait for the user to approve turning on Cognix Cloud.`,
  );
}

/** Strips JS/TS line and block comments while preserving string/template literals intact. */
function stripCodeComments(source: string): string {
  let out = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < len) {
        const cur = source[i];
        out += cur;
        i += 1;
        if (cur === "\\") {
          if (i < len) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (cur === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function extractImportedPackages(source: string): string[] {
  const clean = stripCodeComments(source);
  const found = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"'\r\n]+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"'\r\n]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const pkg = packageNameFromImportSpec(match[1]);
      if (pkg) found.add(pkg);
    }
  }
  return [...found];
}

function extractReferencedEnvNames(source: string): Set<string> {
  const clean = stripCodeComments(source);
  const found = new Set<string>();
  for (const match of clean.matchAll(/\bprocess\.env\.([A-Z0-9_]+)\b/g)) {
    found.add(match[1]);
  }
  for (const match of clean.matchAll(/\bprocess\.env\[\s*["']([A-Z0-9_]+)["']\s*\]/g)) {
    found.add(match[1]);
  }
  return found;
}

function extractPackageJsonDeps(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
    const names = new Set<string>();
    for (const section of sections) {
      const group = parsed[section];
      if (group && typeof group === "object" && !Array.isArray(group)) {
        for (const key of Object.keys(group as Record<string, unknown>)) {
          names.add(key.toLowerCase());
        }
      }
    }
    return [...names];
  } catch {
    return [];
  }
}

function stripLeadingEnvAndCd(segment: string): string {
  let rest = segment.trim();
  while (/^(?:cd\s+[^\s;&|]+\s*|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+|sudo\s+)/.test(rest)) {
    rest = rest.replace(/^(?:cd\s+[^\s;&|]+\s*|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+|sudo\s+)/, "").trim();
  }
  return rest;
}

/**
 * Enforces Build-mode ("code" mode) Cognix Cloud stack & consent rules on terminal commands.
 * Never call this in Security mode (`project.mode === "security"`).
 */
export function assertBuildModeCommandAllowed(command: string, cloudEnabled: boolean): void {
  const segments = command.split(/(?:&&|\|\||;|\||\r?\n)+/);

  for (const rawSegment of segments) {
    const segment = stripLeadingEnvAndCd(rawSegment);
    if (!segment) continue;

    // Always permit cleanup / package removal commands so legacy disallowed packages or files can be removed.
    if (/^(?:(?:npm|pnpm|yarn|bun)\s+(?:uninstall|remove|rm|un)\b|rm\b)/i.test(segment)) {
      continue;
    }

    // 1. Package install commands (npm, pnpm, yarn, bun)
    const installMatch = segment.match(
      /^(?:npm\s+(?:install|i|add)|pnpm\s+(?:add|install|i)|yarn\s+add|bun\s+(?:add|install|i))\b([\s\S]*)$/i,
    );
    if (installMatch) {
      const tokens = installMatch[1].trim().split(/\s+/).filter(Boolean);
      const cloudFeatures: CloudFeature[] = [];
      const cloudLabels: string[] = [];
      for (const token of tokens) {
        const pkg = packageNameFromInstallSpec(token);
        if (!pkg) continue;
        const disallowed = matchDisallowedPackage(pkg);
        if (disallowed) {
          throw formatDisallowedStackError(`${disallowed.label} (\`${pkg}\`)`, disallowed.feature, cloudEnabled);
        }
        if (!cloudEnabled) {
          const cloudPkg = matchCognixCloudPackage(pkg);
          if (cloudPkg) {
            cloudFeatures.push(cloudPkg.feature);
            cloudLabels.push(`\`${pkg}\``);
          }
        }
      }
      if (!cloudEnabled && cloudLabels.length > 0) {
        throw formatCloudConsentRequiredError(cloudLabels.join(", "), cloudFeatures);
      }
    }

    // 2. Package runner CLIs (npx, pnpm dlx, yarn dlx, bunx)
    const dlxMatch = segment.match(/^(?:npx|pnpm\s+dlx|yarn\s+dlx|bunx)\s+([\s\S]*)$/i);
    if (dlxMatch) {
      const tokens = dlxMatch[1].trim().split(/\s+/).filter(Boolean);
      const execPkgToken = tokens.find((token) => !token.startsWith("-"));
      const pkg = execPkgToken ? packageNameFromInstallSpec(execPkgToken) : null;
      if (pkg) {
        const disallowed = matchDisallowedPackage(pkg);
        if (disallowed) {
          throw formatDisallowedStackError(`${disallowed.label} (\`${pkg}\`)`, disallowed.feature, cloudEnabled);
        }
        if (pkg === "pscale" || pkg === "turso") {
          throw formatDisallowedStackError(`\`${pkg}\``, "database", cloudEnabled);
        }
        if (!cloudEnabled) {
          const cloudPkg = matchCognixCloudPackage(pkg);
          if (cloudPkg) {
            throw formatCloudConsentRequiredError(`\`${pkg}\``, [cloudPkg.feature]);
          }
          if (pkg === "auth") {
            throw formatCloudConsentRequiredError("Better Auth CLI (`npx auth`)", ["auth", "database"]);
          }
        }
      }
    }

    // 3. Direct CLI invocations
    const directDisallowedCli = segment.match(
      /^(prisma|supabase|convex|firebase|pocketbase|turso|pscale|sqlite3|mongod|mongosh|mysql)\b/i,
    );
    if (directDisallowedCli) {
      const binary = directDisallowedCli[1].toLowerCase();
      throw formatDisallowedStackError(`\`${binary}\` CLI`, "database", cloudEnabled);
    }

    if (!cloudEnabled) {
      const directCloudCli = segment.match(/^(drizzle-kit|psql)\b/i);
      if (directCloudCli) {
        throw formatCloudConsentRequiredError(`\`${directCloudCli[1].toLowerCase()}\``, ["database"]);
      }
    }

    // 4. Shell file-write bypasses (heredocs, redirection, or node -e writing schema/config files)
    if (/(?:>|tee\s|writeFileSync|writeFile)/.test(segment)) {
      if (/\b(?:schema\.prisma|prisma\.config\.|\S+\.sqlite3?)\b/i.test(segment)) {
        throw formatDisallowedStackError("Prisma / SQLite files", "database", cloudEnabled);
      }
      if (!cloudEnabled && /\bdrizzle\.config\./i.test(segment)) {
        throw formatCloudConsentRequiredError("`drizzle.config`", ["database"]);
      }
    }
  }
}

/**
 * Enforces Build-mode ("code" mode) Cognix Cloud stack & consent rules on file writes, edits, and moves.
 * Never call this in Security mode (`project.mode === "security"`).
 */
export function assertBuildModeFileChangeAllowed(input: {
  path: string;
  before: string | null;
  after: string;
  cloudEnabled: boolean;
}): void {
  const normalizedPath = input.path.replaceAll("\\", "/").replace(/^\/+/, "");
  const { before, after, cloudEnabled } = input;

  // 1. Disallowed provider/ORM config and database files
  if (/(?:^|\/)schema\.prisma$/i.test(normalizedPath) || /(?:^|\/)prisma\.config\.[cm]?[jt]s$/i.test(normalizedPath) || /^prisma\//i.test(normalizedPath)) {
    throw formatDisallowedStackError(`Prisma (\`${normalizedPath}\`)`, "database", cloudEnabled);
  }
  if (/^supabase\/config\.toml$/i.test(normalizedPath)) {
    throw formatDisallowedStackError(`Supabase (\`${normalizedPath}\`)`, "database", cloudEnabled);
  }
  if (/^(?:firebase\.json|\.firebaserc|firestore\.rules|storage\.rules)$/i.test(normalizedPath)) {
    throw formatDisallowedStackError(`Firebase (\`${normalizedPath}\`)`, "database", cloudEnabled);
  }
  if (/^(?:convex\.json|convex\/)/i.test(normalizedPath)) {
    throw formatDisallowedStackError(`Convex (\`${normalizedPath}\`)`, "database", cloudEnabled);
  }
  if (/\.(?:sqlite|sqlite3|db)$/i.test(normalizedPath)) {
    throw formatDisallowedStackError(`Local SQLite/file database (\`${normalizedPath}\`)`, "database", cloudEnabled);
  }

  // 2. Cognix Cloud migration/config files when Cloud is off
  if (!cloudEnabled && (/(?:^|\/)drizzle\.config\.[cm]?[jt]s$/i.test(normalizedPath) || /^drizzle\//i.test(normalizedPath))) {
    throw formatCloudConsentRequiredError(`\`${normalizedPath}\``, ["database"]);
  }

  // 3. package.json dependency guard
  if (/(?:^|\/)package\.json$/i.test(normalizedPath)) {
    const afterDeps = extractPackageJsonDeps(after);
    const beforeDeps = before !== null ? extractPackageJsonDeps(before) : [];
    const beforeSet = new Set(beforeDeps);

    const disallowedAfter = afterDeps
      .map((pkg) => ({ pkg, rule: matchDisallowedPackage(pkg) }))
      .filter((item): item is { pkg: string; rule: DisallowedRule } => item.rule !== null);
    const disallowedBeforeCount = beforeDeps.filter((pkg) => matchDisallowedPackage(pkg) !== null).length;

    if (disallowedAfter.length > 0) {
      const newlyAdded = disallowedAfter.find((item) => !beforeSet.has(item.pkg));
      if (newlyAdded) {
        throw formatDisallowedStackError(`${newlyAdded.rule.label} (\`${newlyAdded.pkg}\`)`, newlyAdded.rule.feature, cloudEnabled);
      }
      if (before === null || disallowedAfter.length >= disallowedBeforeCount) {
        const first = disallowedAfter[0];
        throw formatDisallowedStackError(`${first.rule.label} (\`${first.pkg}\`)`, first.rule.feature, cloudEnabled);
      }
    }

    if (!cloudEnabled) {
      const addedCloudDeps = afterDeps
        .filter((pkg) => before === null || !beforeSet.has(pkg))
        .map((pkg) => ({ pkg, rule: matchCognixCloudPackage(pkg) }))
        .filter((item): item is { pkg: string; rule: CloudPackageRule } => item.rule !== null);
      if (addedCloudDeps.length > 0) {
        throw formatCloudConsentRequiredError(
          addedCloudDeps.map((item) => `\`${item.pkg}\``).join(", "),
          addedCloudDeps.map((item) => item.rule.feature),
        );
      }
    }
    return;
  }

  // 4. Source code imports, provider env vars, and local-file DB workarounds
  if (!/\.[cm]?[jt]sx?$/i.test(normalizedPath)) return;

  const afterImports = extractImportedPackages(after);
  const beforeImports = before !== null ? extractImportedPackages(before) : [];
  const beforeImportSet = new Set(beforeImports);

  const disallowedImportsAfter = afterImports
    .map((pkg) => ({ pkg, rule: matchDisallowedPackage(pkg) }))
    .filter((item): item is { pkg: string; rule: DisallowedRule } => item.rule !== null);
  const disallowedImportsBeforeCount = beforeImports.filter((pkg) => matchDisallowedPackage(pkg) !== null).length;

  if (disallowedImportsAfter.length > 0) {
    const newlyAdded = disallowedImportsAfter.find((item) => !beforeImportSet.has(item.pkg));
    if (newlyAdded) {
      throw formatDisallowedStackError(`${newlyAdded.rule.label} (\`${newlyAdded.pkg}\`)`, newlyAdded.rule.feature, cloudEnabled);
    }
    if (before === null || disallowedImportsAfter.length >= disallowedImportsBeforeCount) {
      const first = disallowedImportsAfter[0];
      throw formatDisallowedStackError(`${first.rule.label} (\`${first.pkg}\`)`, first.rule.feature, cloudEnabled);
    }
  }

  const afterEnv = extractReferencedEnvNames(after);
  const beforeEnv = before !== null ? extractReferencedEnvNames(before) : new Set<string>();

  for (const envRule of DISALLOWED_ENV_RULES) {
    if (afterEnv.has(envRule.name) && (before === null || !beforeEnv.has(envRule.name))) {
      throw formatDisallowedStackError(`${envRule.label} (\`process.env.${envRule.name}\`)`, envRule.feature, cloudEnabled);
    }
  }

  if (!cloudEnabled) {
    const addedCloudImports = afterImports
      .filter((pkg) => before === null || !beforeImportSet.has(pkg))
      .map((pkg) => ({ pkg, rule: matchCognixCloudPackage(pkg) }))
      .filter((item): item is { pkg: string; rule: CloudPackageRule } => item.rule !== null);
    if (addedCloudImports.length > 0) {
      throw formatCloudConsentRequiredError(
        addedCloudImports.map((item) => `${item.rule.label} (\`${item.pkg}\`)`).join(", "),
        addedCloudImports.map((item) => item.rule.feature),
      );
    }

    const addedCloudEnv = COGNIX_CLOUD_ENV_RULES.filter(
      (rule) => afterEnv.has(rule.name) && (before === null || !beforeEnv.has(rule.name)),
    );
    if (addedCloudEnv.length > 0) {
      throw formatCloudConsentRequiredError(
        addedCloudEnv.map((rule) => `\`process.env.${rule.name}\``).join(", "),
        addedCloudEnv.map((rule) => rule.feature),
      );
    }

    // Prevent faking a persistent database with server-side local JSON/file writes instead of asking for Cognix Cloud.
    const cleanAfter = stripCodeComments(after);
    const isServerDataFile =
      /(?:^|\/)(?:app\/api\/|lib\/|server\/|actions\/)/i.test(normalizedPath) ||
      /["']use server["']/.test(cleanAfter);
    const importsNodeFs = /\b(?:from\s+|require\s*\(\s*)["'](?:node:)?fs(?:\/promises)?["']/.test(cleanAfter);
    const writesLocalDataFile = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\(/.test(cleanAfter);
    if (isServerDataFile && importsNodeFs && writesLocalDataFile && before === null) {
      throw formatCloudConsentRequiredError("local filesystem persistence (`fs.writeFile`)", ["database"]);
    }
  }
}
