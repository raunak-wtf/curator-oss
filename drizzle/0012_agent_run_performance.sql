CREATE TABLE IF NOT EXISTS "agent_run_metrics" (
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
);

CREATE INDEX IF NOT EXISTS "agent_run_metrics_user_created_idx"
  ON "agent_run_metrics" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_run_metrics_project_idx"
  ON "agent_run_metrics" ("project_id");
CREATE INDEX IF NOT EXISTS "agent_run_metrics_created_idx"
  ON "agent_run_metrics" ("created_at");
