import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const RETRY_DELAYS_MS = [250, 750, 1_600] as const;

const IDEMPOTENT_SCHEMA_PATCHES = [
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "show_badge" boolean DEFAULT true NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "public_remix" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_instructions" text DEFAULT '' NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'build' NOT NULL`,
  `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "security_source" jsonb`,
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
] as const;

let schemaHealPromise: Promise<void> | null = null;
let schemaHealingActive = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureHostSchemaUpToDate(connectionString: string): Promise<void> {
  if (!schemaHealPromise) {
    schemaHealPromise = (async () => {
      schemaHealingActive = true;
      try {
        const rawSql = neon(connectionString, { fetchOptions: { cache: "no-store" } });
        for (const ddl of IDEMPOTENT_SCHEMA_PATCHES) {
          await rawSql.query(ddl);
        }
      } finally {
        schemaHealingActive = false;
      }
    })().catch((err) => {
      schemaHealPromise = null;
      throw err;
    });
  }
  return schemaHealPromise;
}

export function createResilientNeonFetch(
  connectionString: string,
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
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

        if (response.status === 400 && !healedSchema && !schemaHealingActive && connectionString) {
          const clonedText = await response.clone().text().catch(() => "");
          // PostgreSQL 42703 = undefined_column, 42P01 = undefined_table
          if (/"code"\s*:\s*"(?:42703|42P01)"/.test(clonedText)) {
            healedSchema = true;
            await ensureHostSchemaUpToDate(connectionString).catch(() => undefined);
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
