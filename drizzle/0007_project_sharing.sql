ALTER TABLE "projects" ADD COLUMN "show_badge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "public_remix" boolean DEFAULT false NOT NULL;
