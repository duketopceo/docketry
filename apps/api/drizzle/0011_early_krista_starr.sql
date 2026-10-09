ALTER TABLE "webhook_deliveries" ALTER COLUMN "endpoint_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "endpoint_secret" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "dispatch_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;