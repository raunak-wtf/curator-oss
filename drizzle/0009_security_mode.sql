ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'build' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "security_source" jsonb;
