CREATE TABLE "dispatch_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_events" ADD CONSTRAINT "dispatch_events_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_events" ADD CONSTRAINT "dispatch_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_events_dispatch_id_index" ON "dispatch_events" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatch_events_workspace_id_index" ON "dispatch_events" USING btree ("workspace_id");