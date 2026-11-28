import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const RETRY_DELAYS_MS = [250, 750, 1_600] as const;
const healingContext = new AsyncLocalStorage<boolean>();

export const IDEMPOTENT_SCHEMA_PATCHES = [
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "show_badge" boolean DEFAULT true NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "public_remix" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_instructions" text DEFAULT '' NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'build' NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "security_source" jsonb`,
  `CREATE TABLE IF NOT EXISTS "project_cloud" (
    "project_id" uuid PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "status" text DEFAULT 'disabled' NOT NULL,
    "neon_project_id" text,
    "neon_region" text,
    "storage_enabled" boolean DEFAULT false NOT NULL,
    "app_token_hash" text,
    "auth_enabled" boolean DEFAULT false NOT NULL,
    "last_error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "project_cloud" ADD COLUMN IF NOT EXISTS "storage_enabled" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "project_cloud" ADD COLUMN IF NOT EXISTS "app_token_hash" text`,
  `ALTER TABLE "project_cloud" ADD COLUMN IF NOT EXISTS "auth_enabled" boolean DEFAULT false NOT NULL`,
  `CREATE TABLE IF NOT EXISTS "skills" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text NOT NULL,
    "body" text NOT NULL,
    "source" text DEFAULT 'manual' NOT NULL,
    "source_url" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "skills_owner_name_unique" UNIQUE("owner_id", "name")
  )`,
  `CREATE TABLE IF NOT EXISTS "github_connections" (
    "owner_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "github_user_id" text NOT NULL,
    "login" text NOT NULL,
    "avatar_url" text,
    "scopes" text DEFAULT '' NOT NULL,
    "token_ciphertext" text NOT NULL,
    "token_iv" text NOT NULL,
    "token_auth_tag" text NOT NULL,
    "token_expires_at" timestamp with time zone,
    "refresh_ciphertext" text,
    "refresh_iv" text,
    "refresh_auth_tag" text,
    "refresh_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "github_connections" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp with time zone`,
  `ALTER TABLE "github_connections" ADD COLUMN IF NOT EXISTS "refresh_ciphertext" text`,
  `ALTER TABLE "github_connections" ADD COLUMN IF NOT EXISTS "refresh_iv" text`,
  `ALTER TABLE "github_connections" ADD COLUMN IF NOT EXISTS "refresh_auth_tag" text`,
  `ALTER TABLE "github_connections" ADD COLUMN IF NOT EXISTS "refresh_expires_at" timestamp with time zone`,
  `CREATE TABLE IF NOT EXISTS "project_repositories" (
    "project_id" uuid PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "repo_id" text NOT NULL,
    "full_name" text NOT NULL,
    "html_url" text NOT NULL,
    "default_branch" text NOT NULL,
    "private" boolean DEFAULT true NOT NULL,
    "auto_commit" boolean DEFAULT true NOT NULL,
    "sync_base_sha" text,
    "synced_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "last_commit_sha" text,
    "last_commit_url" text,
    "last_pushed_at" timestamp with time zone,
    "last_error" text,
    "cached_sync" jsonb,
    "cached_commits" jsonb,
    "commits_fetched_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "cached_sync" jsonb`,
  `ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "cached_commits" jsonb`,
  `ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "commits_fetched_at" timestamp with time zone`,
  `CREATE TABLE IF NOT EXISTS "agent_approvals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "items" jsonb NOT NULL,
    "decisions" jsonb,
    "status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "resolved_at" timestamp with time zone
  )`,
  `CREATE INDEX IF NOT EXISTS "agent_approvals_project_status_idx" ON "agent_approvals" ("project_id", "status")`,
  `CREATE TABLE IF NOT EXISTS "project_analytics_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "hostname" text NOT NULL,
    "path" text NOT NULL,
    "referrer_host" text,
    "device" text DEFAULT 'desktop' NOT NULL,
    "visitor_hash" text NOT NULL,
    "status_code" integer DEFAULT 200 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "project_analytics_project_created_idx" ON "project_analytics_events" ("project_id", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "project_console_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "source" text DEFAULT 'browser' NOT NULL,
    "level" text DEFAULT 'log' NOT NULL,
    "message" text NOT NULL,
    "stack" text,
    "route" text,
    "status_code" integer,
    "fingerprint" text NOT NULL,
    "repeat_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "project_console_logs_project_created_idx" ON "project_console_logs" ("project_id", "created_at")`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider" text DEFAULT 'unknown' NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider_label" text DEFAULT 'Unknown' NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_method" text DEFAULT 'oauth' NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_subject" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "users_lower_email_idx" ON "users" (lower("email"))`,
  `CREATE TABLE IF NOT EXISTS "user_subscriptions" (
    "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "plan_code" text DEFAULT 'pro_monthly' NOT NULL,
    "status" text DEFAULT 'inactive' NOT NULL,
    "price_cents" integer DEFAULT 1000 NOT NULL,
    "currency" text DEFAULT 'USD' NOT NULL,
    "dodo_customer_id" text,
    "dodo_subscription_id" text,
    "dodo_product_id" text,
    "monthly_credits_hundredths" integer DEFAULT 9000 NOT NULL,
    "credits_balance_hundredths" integer DEFAULT 0 NOT NULL,
    "credits_used_this_period_hundredths" integer DEFAULT 0 NOT NULL,
    "lifetime_credits_used_hundredths" integer DEFAULT 0 NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "last_payment_id" text,
    "last_payment_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_dodo_sub_unique" ON "user_subscriptions" ("dodo_subscription_id")`,
  `CREATE INDEX IF NOT EXISTS "user_subscriptions_status_idx" ON "user_subscriptions" ("status")`,
  `CREATE TABLE IF NOT EXISTS "credit_usage_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
    "message_id" uuid,
    "mode" text DEFAULT 'build' NOT NULL,
    "complexity_tier" text DEFAULT 'standard' NOT NULL,
    "prompt_tokens" integer DEFAULT 0 NOT NULL,
    "completion_tokens" integer DEFAULT 0 NOT NULL,
    "total_tokens" integer DEFAULT 0 NOT NULL,
    "turns" integer DEFAULT 1 NOT NULL,
    "tool_calls" integer DEFAULT 0 NOT NULL,
    "files_changed" integer DEFAULT 0 NOT NULL,
    "commands_run" integer DEFAULT 0 NOT NULL,
    "cloud_actions" integer DEFAULT 0 NOT NULL,
    "duration_ms" integer DEFAULT 0 NOT NULL,
    "credits_hundredths" integer DEFAULT 0 NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "credit_usage_events_user_created_idx" ON "credit_usage_events" ("user_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "credit_usage_events_project_idx" ON "credit_usage_events" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "credit_usage_events_created_idx" ON "credit_usage_events" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "agent_run_metrics" (
    "id" uuid PRIMARY KEY NOT NULL,
    "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "message_id" uuid,
    "mode" text DEFAULT 'build' NOT NULL,
    "status" text DEFAULT 'completed' NOT NULL,
    "error_category" text,
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone NOT NULL,
    "total_duration_ms" integer DEFAULT 0 NOT NULL,
    "performance" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "agent_run_metrics_user_created_idx" ON "agent_run_metrics" ("user_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "agent_run_metrics_project_idx" ON "agent_run_metrics" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "agent_run_metrics_created_idx" ON "agent_run_metrics" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
    "event_id" text PRIMARY KEY NOT NULL,
    "event_type" text NOT NULL,
    "processed_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_access_mode" text DEFAULT 'owner' NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_public_expires_at" timestamp with time zone`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_passcode_hash" text`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_access_version" integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_active_until" timestamp with time zone`,
  `CREATE TABLE IF NOT EXISTS "project_preview_shares" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "share_key" text NOT NULL,
    "note" text,
    "expires_at" timestamp with time zone,
    "last_accessed_at" timestamp with time zone,
    "access_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "project_preview_shares_project_email_unique" UNIQUE("project_id", "email")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "project_preview_shares_key_unique" ON "project_preview_shares" ("share_key")`,
  `CREATE INDEX IF NOT EXISTS "project_preview_shares_project_idx" ON "project_preview_shares" ("project_id", "created_at")`,
] as const;

let schemaHealPromise: Promise<void> | null = null;
let schemaHealCompleted = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === target) return v;
    }
    return null;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === "string") return v;
  }
  return null;
}

function extractHostname(value: string | URL | Request): string {
  try {
    if (typeof value === "string") return new URL(value).hostname.toLowerCase();
    if (value instanceof URL) return value.hostname.toLowerCase();
    return new URL(value.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function ensureHostSchemaUpToDate(
  connectionString: string,
  options?: { force?: boolean },
): Promise<void> {
  if (options?.force && schemaHealCompleted) {
    schemaHealPromise = null;
    schemaHealCompleted = false;
  }
  if (!schemaHealPromise) {
    schemaHealPromise = healingContext
      .run(true, async () => {
        const rawSql = neon(connectionString, { fetchOptions: { cache: "no-store" } });
        try {
          await rawSql.transaction(IDEMPOTENT_SCHEMA_PATCHES.map((ddl) => rawSql.query(ddl)));
        } catch {
          for (const ddl of IDEMPOTENT_SCHEMA_PATCHES) {
            try {
              await rawSql.query(ddl);
            } catch (err) {
              console.error("[db] Failed applying idempotent schema patch:", err);
            }
          }
        }
        schemaHealCompleted = true;
      })
      .catch((err) => {
        schemaHealPromise = null;
        schemaHealCompleted = false;
        throw err;
      });
  }
  return schemaHealPromise;
}

export function createResilientNeonFetch(
  connectionString: string,
  baseFetch: typeof fetch = globalThis.fetch,
  healFn: (conn: string, opts?: { force?: boolean }) => Promise<void> = ensureHostSchemaUpToDate,
): typeof fetch {
  const normalizedHostConn = connectionString.trim();
  const hostDbHostname = (() => {
    try {
      if (!normalizedHostConn) return "";
      const protoEnd = normalizedHostConn.indexOf(":");
      const httpLike = protoEnd > 0 ? `http:${normalizedHostConn.slice(protoEnd + 1)}` : normalizedHostConn;
      return new URL(httpLike).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  return async (input, init) => {
    const isInternalHeal = Boolean(healingContext.getStore());
    // `@neondatabase/serverless` rewrites `ep-*.<region>.aws.neon.tech` to `https://api.<region>.aws.neon.tech/sql`
    // and passes the exact DSN in `Neon-Connection-String`. Matching that header isolates the host DB from
    // customer Neon databases even when both live in the exact same AWS region.
    const neonConnHeader = readHeader(init?.headers, "neon-connection-string")?.trim();
    const reqHost = extractHostname(input);
    const isHostDbRequest = neonConnHeader
      ? neonConnHeader === normalizedHostConn
      : !hostDbHostname || !reqHost || reqHost === hostDbHostname;

    let healedSchema = false;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await baseFetch(input, {
          ...init,
          cache: "no-store",
        });

        if ([429, 502, 503, 504].includes(response.status) && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }

        if (isHostDbRequest && !isInternalHeal && response.status === 400 && !healedSchema && normalizedHostConn) {
          const clonedText = await response.clone().text().catch(() => "");
          // PostgreSQL 42703 = undefined_column, 42P01 = undefined_table
          if (/"code"\s*:\s*"(?:42703|42P01)"/.test(clonedText)) {
            healedSchema = true;
            await healFn(normalizedHostConn, { force: schemaHealCompleted }).catch((err) => {
              console.error("[db] Host schema auto-heal error:", err);
            });
            continue;
          }
        }

        return response;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    return baseFetch(input, { ...init, cache: "no-store" });
  };
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (databaseUrl) {
  neonConfig.fetchFunction = createResilientNeonFetch(databaseUrl);
}

export const db = databaseUrl
  ? drizzle(neon(databaseUrl, { fetchOptions: { cache: "no-store" } }), { schema })
  : null;
export const isDatabaseConfigured = Boolean(databaseUrl);
