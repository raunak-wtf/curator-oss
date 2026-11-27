ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "cached_sync" jsonb;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "cached_commits" jsonb;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "commits_fetched_at" timestamp with time zone;
