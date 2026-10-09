# Outbound webhooks

Workspace endpoints that receive signed JSON POSTs when docketry events occur.
This is the substrate n8n nodes, Slack mirroring, and arbitrary consumers build
on.

## Managing endpoints

```
POST   /v1/:ws/webhook-endpoints        { url, events?, secret? }
GET    /v1/:ws/webhook-endpoints        (secret masked to last4)
PATCH  /v1/:ws/webhook-endpoints/:id    { url?, events?, enabled? }
DELETE /v1/:ws/webhook-endpoints/:id
GET    /v1/:ws/webhook-endpoints/:id/deliveries   (last 50 attempts)
```

`secret` is returned in full **once** at creation (auto-generated `whsec_*`
if omitted). `events` is an action filter — `["*"]` or a subset of the catalog.

## Event catalog

| Action | Fires when |
|---|---|
| `issue.created` | an issue is created (any source) |
| `issue.state_changed` | a lifecycle transition commits |
| `issue.commented` | a comment posts on an issue |
| `issue.github_review` | a linked PR review verdict mirrors in |
| `issue.dispatched` | an agent dispatch intent is created |
| `issue.dispatch_failed` | a dispatch fails with a reason |

(`cycle.*` events join the catalog when the cycles engine emits them.)

Payload shape:

```json
{
  "id": "delivery-uuid",
  "action": "issue.state_changed",
  "workspaceId": "…",
  "entityType": "issue",
  "entityId": "…",
  "issueKey": "GH-1",
  "actorType": "human",
  "actorId": "…",
  "before": { "state": "in_progress" },
  "after": { "state": "in_review" }
}
```

## Verifying signatures

Every delivery signs the **raw JSON body** with HMAC-SHA256:

```
X-Docketry-Event: issue.state_changed
X-Docketry-Delivery: <delivery-uuid>
X-Docketry-Signature: sha256=<hex>
```

Node verify example:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const expected =
  "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
if (!timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
  return res.status(401).end();
}
```

## Retries

Non-2xx or unreachable endpoints retry with exponential backoff (30s × 2^attempt,
max 5 attempts) via the API's 30-second sweeper. Rows land in
`webhook_deliveries` with `status`, `attempts`, `lastError`, `nextAttemptAt` —
inspectable at `GET /:ws/webhook-endpoints/:id/deliveries`. Deliveries that
exhaust retries stay `failed` in the log.
