import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { webhookDeliveries, webhookEndpoints } from "../db/schema.js";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

export interface OutboundEvent {
  workspaceId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: string;
  actorId: string | null;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  issueKey?: string | undefined;
}

export function generateEndpointSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

// X-Docketry-Signature verification for consumers (documented in docs/webhooks.md)
export function signDelivery(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

export function verifyDeliverySignature(
  body: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signDelivery(body, secret);
  const received = signatureHeader;
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// fan-out: every recorded event queues a pending delivery per matching endpoint
export async function queueDeliveries(ev: OutboundEvent): Promise<void> {
  // catalog action: 'issue.created', 'dispatch.*' etc = entityType.action
  const action = `${ev.entityType}.${ev.action}`;
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.workspaceId, ev.workspaceId),
        eq(webhookEndpoints.enabled, true),
      ),
    );
  const matching = endpoints.filter(
    (e) => e.events.includes("*") || e.events.includes(action),
  );
  for (const endpoint of matching) {
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        workspaceId: ev.workspaceId,
        endpointId: endpoint.id,
        action,
        payload: { ...ev, action } as Record<string, unknown>,
      })
      .returning();
    await deliver(row!, endpoint);
  }
}

async function deliver(
  row: typeof webhookDeliveries.$inferSelect,
  endpoint: typeof webhookEndpoints.$inferSelect,
): Promise<void> {
  const body = JSON.stringify({
    id: row.id,
    action: row.action,
    ...(row.payload as Record<string, unknown>),
  });
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docketry-event": row.action,
        "x-docketry-delivery": row.id,
        "x-docketry-signature": signDelivery(body, endpoint.secret),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`endpoint returned ${res.status}`);
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts: row.attempts + 1,
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, row.id));
  } catch (err) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await db
      .update(webhookDeliveries)
      .set({
        status: exhausted ? "failed" : "pending",
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
        nextAttemptAt: new Date(
          Date.now() + BASE_BACKOFF_MS * 2 ** (attempts - 1),
        ),
      })
      .where(eq(webhookDeliveries.id, row.id));
  }
}

// sweeper: retries due pending deliveries — runs on an interval at boot
export async function sweepDeliveries(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(100);
  let attempted = 0;
  for (const row of due) {
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, row.endpointId))
      .limit(1);
    if (!endpoint?.enabled) continue;
    await deliver(row, endpoint);
    attempted++;
  }
  return attempted;
}
