CREATE TABLE "slack_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"thread_ts" text NOT NULL,
	"reporter_slack_id" text,
	"reporter_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_links_issue_id_unique" UNIQUE("issue_id")
);
--> statement-breakpoint
ALTER TABLE "slack_links" ADD CONSTRAINT "slack_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_links" ADD CONSTRAINT "slack_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_links_workspace_id_index" ON "slack_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_links_channel_thread_ts_index" ON "slack_links" USING btree ("channel","thread_ts");