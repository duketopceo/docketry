import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { githubWebhookEvents } from "../db/schema.js";
import { config_ } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { verifyGitHubSignature } from "../lib/github.js";
import { processGithubEvent } from "../services/github-automation.js";

export const webhookRoutes = new Hono().post("/github", async (c) => {
  if (!config_.githubWebhookSecret) {
    throw new HttpError(503, "GITHUB_NOT_CONFIGURED", "webhook secret not set");
  }

  const rawBody = await c.req.raw.text();
  const signature = c.req.header("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBody, signature, config_.githubWebhookSecret)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "bad webhook signature");
  }

  const deliveryId = c.req.header("x-github-delivery");
  const eventType = c.req.header("x-github-event");
  if (!deliveryId || !eventType) {
    throw new HttpError(400, "MALFORMED_DELIVERY", "missing delivery headers");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "MALFORMED_PAYLOAD", "invalid JSON body");
  }

  // dedupe: replayed deliveries are dropped and logged
  const [inserted] = await db
    .insert(githubWebhookEvents)
    .values({ deliveryId, eventType, payload })
    .onConflictDoNothing({ target: githubWebhookEvents.deliveryId })
    .returning({ id: githubWebhookEvents.id });
  if (!inserted) {
    console.warn(`github webhook: duplicate delivery ${deliveryId} dropped`);
    return c.json({ ok: true, duplicate: true });
  }

  try {
    const consumed = await processGithubEvent(eventType, payload);
    if (consumed) {
      await db
        .update(githubWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(githubWebhookEvents.deliveryId, deliveryId));
    }
  } catch (err) {
    // delivery stays unprocessed for a later sweep — never fail the webhook
    console.error(`github webhook: ${eventType} ${deliveryId} failed`, err);
  }

  return c.json({ ok: true });
});
