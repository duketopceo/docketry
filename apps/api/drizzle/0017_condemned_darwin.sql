DROP INDEX "slack_links_channel_thread_ts_index";--> statement-breakpoint
ALTER TABLE "slack_links" ADD CONSTRAINT "slack_links_channel_thread_ts_unique" UNIQUE("channel","thread_ts");