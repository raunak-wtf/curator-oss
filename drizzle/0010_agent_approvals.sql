CREATE TABLE IF NOT EXISTS "agent_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "items" jsonb NOT NULL,
  "decisions" jsonb,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_approvals_project_status_idx" ON "agent_approvals" ("project_id", "status");
