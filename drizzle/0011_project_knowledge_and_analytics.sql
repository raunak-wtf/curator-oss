ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_instructions" text DEFAULT '' NOT NULL;

CREATE TABLE IF NOT EXISTS "project_analytics_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "hostname" text NOT NULL,
  "path" text NOT NULL,
  "referrer_host" text,
  "device" text DEFAULT 'desktop' NOT NULL,
  "visitor_hash" text NOT NULL,
  "status_code" integer DEFAULT 200 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "project_analytics_project_created_idx"
  ON "project_analytics_events" ("project_id", "created_at");
