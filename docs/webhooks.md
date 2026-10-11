# Outbound webhooks

Workspace endpoints that receive signed JSON POSTs when tallyline events occur.
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

### Allowed destinations (SSRF guard)

Endpoint URLs (and agent dispatch `endpointUrl`s) must be `http`/`https` with no
embedded credentials and must not point at private, loopback, link-local,
CGNAT, ULA, multicast or cloud-metadata addresses (`10/8`, `127/8`,
`169.254/16`, `100.64/10`, `172.16/12`, `192.168/16`, `::1`, `fc00::/7`,
`fe80::/10`, `localhost`, `*.internal`, `*.local`, …). A rejected URL returns
`422 UNSAFE_URL`. The check runs at create/update **and again at delivery**:
the resolved address is validated at connect time (DNS rebinding cannot swap
it) and redirects are not followed — a 3xx counts as a failed attempt.
Self-hosters delivering to LAN services set `TALLYLINE_WEBHOOK_ALLOW_PRIVATE=1`.

## Event catalog

| Action | Fires when |
|---|---|
| `issue.created` | an issue is created (any source) |
| `issue.state_changed` | a lifecycle transition commits |
| `issue.commented` | a comment posts on an issue |
| `issue.github_review` | a linked PR review verdict mirrors in |
| `issue.dispatched` | an agent dispatch intent is created |
| `issue.dispatch_delivered` | a webhook-harness dispatch reached its endpoint |
| `issue.dispatch_failed` | a dispatch fails with a reason |
| `issue.session_update` | an agent posts session timeline events (batched) |

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
X-Tallyline-Event: issue.state_changed
X-Tallyline-Delivery: <delivery-uuid>
X-Tallyline-Signature: sha256=<hex>
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

## Agent dispatch deliveries

Agents with `harness: "webhook"` and an `endpointUrl` receive dispatches
through the **same durable pipeline** — the first POST is synchronous, retries
ride the sweeper with the same backoff and 5-attempt cap. Each agent carries
its own `endpointSecret` (auto-minted `whsec_…` on first dispatch); verify
`X-Tallyline-Signature` exactly as above. The delivery payload adds
`dispatchId`, `issue`, `agent`, `trigger`, `comment` to the envelope.

A delivery that exhausts retries writes `dispatch_failed` back to the
dispatch record and the issue thread. The harness then reports progress and
completion via `POST /v1/:ws/dispatches/:id/events` and `/report` (see
docs/adapters.md).
