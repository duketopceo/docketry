CREATE TYPE "public"."dispatch_status" AS ENUM('queued', 'claimed', 'dispatch_failed', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."dispatch_trigger" AS ENUM('assign', 'mention');--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"trigger" "dispatch_trigger" NOT NULL,
	"status" "dispatch_status" DEFAULT 'queued' NOT NULL,
	"adapter" text,
	"reason" text,
	"comment_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "endpoint_url" text;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatches_workspace_id_issue_id_index" ON "dispatches" USING btree ("workspace_id","issue_id");