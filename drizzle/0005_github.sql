CREATE TABLE "github_connections" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"scopes" text DEFAULT '' NOT NULL,
	"token_ciphertext" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
