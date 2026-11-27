ALTER TABLE "github_connections" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "refresh_ciphertext" text;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "refresh_iv" text;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "refresh_auth_tag" text;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "refresh_expires_at" timestamp with time zone;
