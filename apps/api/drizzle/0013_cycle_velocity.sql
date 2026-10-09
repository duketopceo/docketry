CREATE TABLE "cycle_velocity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issue_count" integer NOT NULL,
	"done_count" integer NOT NULL,
	"estimate_done" integer DEFAULT 0 NOT NULL,
	"estimate_total" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_velocity" ADD CONSTRAINT "cycle_velocity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_velocity" ADD CONSTRAINT "cycle_velocity_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_velocity" ADD CONSTRAINT "cycle_velocity_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_velocity_workspace_id_team_id_index" ON "cycle_velocity" USING btree ("workspace_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_velocity_cycle_unique" ON "cycle_velocity" USING btree ("cycle_id");