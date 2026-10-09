import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { InvalidTransitionError } from "@docketry/types";
import { runMigrations } from "./db/migrate.js";
import { config_ } from "./env.js";
import { checkHealth } from "./health.js";
import { apiError, HttpError } from "./lib/errors.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { openApiDoc } from "./openapi.js";
import { sweepDeliveries } from "./services/outbound.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes, requireSession } from "./routes/auth.js";
import { dispatchRoutes } from "./routes/dispatches.js";
import { eventRoutes } from "./routes/events.js";
import { githubRoutes } from "./routes/github.js";
import { importRoutes } from "./routes/import.js";
import { issueRoutes } from "./routes/issues.js";
import { resourceRoutes } from "./routes/resources.js";
import { tokenRoutes } from "./routes/tokens.js";
import { webhookEndpointRoutes } from "./routes/webhook-endpoints.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { whoamiRoutes } from "./routes/whoami.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { NotFoundError } from "./services/issues.js";

const rateLimiter = createRateLimiter(config_.rateLimitPerMin);

export const app = new Hono()
  .get("/health", async (c) => {
    const report = await checkHealth(config_.databaseUrl, config_.redisUrl);
    return c.json(report, report.status === "ok" ? 200 : 503);
  })
  .get("/openapi.json", (c) => c.json(openApiDoc))
  .route("/webhooks", webhookRoutes)
  .route("/v1/auth", authRoutes)
  .use("/v1/*", requireSession)
  .use("/v1/*", rateLimiter)
  .route("/v1", workspaceRoutes)
  .route("/v1", whoamiRoutes)
  .route("/v1", eventRoutes)
  .route("/v1", issueRoutes)
  .route("/v1", agentRoutes)
  .route("/v1", resourceRoutes)
  .route("/v1", tokenRoutes)
  .route("/v1", githubRoutes)
  .route("/v1", importRoutes)
  .route("/v1", webhookEndpointRoutes)
  .route("/v1", dispatchRoutes)
  .onError((err, c) => {
    if (err instanceof HttpError) {
      return apiError(c, err.status, err.code, err.message);
    }
    if (err instanceof InvalidTransitionError) {
      return apiError(c, 409, err.code, err.message);
    }
    if (err instanceof NotFoundError) {
      return apiError(c, 404, err.code, err.message);
    }
    if (err instanceof HTTPException) {
      return apiError(c, err.status, "HTTP_ERROR", err.message);
    }
    console.error(err);
    return apiError(c, 500, "INTERNAL", "internal server error");
  });

if (process.env.NODE_ENV !== "test") {
  await runMigrations();
  setInterval(() => {
    void sweepDeliveries().catch((err) =>
      console.error("webhook sweep failed", err),
    );
  }, 30_000).unref();
  serve({ fetch: app.fetch, port: config_.port }, (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  });
}
