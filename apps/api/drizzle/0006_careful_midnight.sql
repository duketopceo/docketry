CREATE TABLE "github_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"gh_issue_id" bigint NOT NULL,
	"gh_issue_number" integer NOT NULL,
	"issue_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_issue_links_repo_id_gh_issue_id_unique" UNIQUE("repo_id","gh_issue_id")
);
--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "github_issue_links" ADD CONSTRAINT "github_issue_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_links" ADD CONSTRAINT "github_issue_links_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_links" ADD CONSTRAINT "github_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_issue_links_workspace_id_index" ON "github_issue_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "github_issue_links_issue_id_index" ON "github_issue_links" USING btree ("issue_id");--> statement-breakpoint
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;