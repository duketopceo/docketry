import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { runMigrations } from "./db/migrate.js";
import { config_ } from "./env.js";
import { checkHealth } from "./health.js";

const app = new Hono();

app.get("/health", async (c) => {
  const report = await checkHealth(config_.databaseUrl, config_.redisUrl);
  return c.json(report, report.status === "ok" ? 200 : 503);
});

app.get("/openapi.json", (c) => {
  return c.json({
    openapi: "3.1.0",
    info: { title: "docketry API", version: "0.0.0" },
    paths: { "/health": { get: { summary: "Liveness + dependency check" } } },
  });
});

await runMigrations();

serve({ fetch: app.fetch, port: config_.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
