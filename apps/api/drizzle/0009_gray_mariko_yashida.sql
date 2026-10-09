CREATE TABLE "issue_external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_external_refs_workspace_id_system_external_id_unique" UNIQUE("workspace_id","system","external_id")
);
--> statement-breakpoint
ALTER TABLE "issue_external_refs" ADD CONSTRAINT "issue_external_refs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_external_refs" ADD CONSTRAINT "issue_external_refs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_external_refs_issue_id_index" ON "issue_external_refs" USING btree ("issue_id");