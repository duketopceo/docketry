# Dispatch adapters — the harness contract

Tallyline routes work to agents through **adapters**. When a human assigns an
issue to an agent or `@mentions` one in a comment, the dispatch bus creates a
durable `dispatches` record, posts an ack on the issue thread, and invokes the
adapter registered for that agent's `harness`. Outcomes post back to the
thread — dispatching is never silent.

## Adapter contract

An adapter is a plain object:

```ts
interface DispatchAdapter {
  name: string;
  launch(ctx: DispatchContext): Promise<DispatchResult>;
}
```

`launch` must return promptly — long-running work belongs in the harness,
which reports progress back over the REST API (comments, state transitions,
`tly_agt_*` scoped keys).

```ts
interface DispatchContext {
  dispatchId: string;
  workspaceId: string;
  issue: { id: string; key: string; title: string; description: string | null };
  agent: { id: string; name: string; harness: string; endpointUrl: string | null };
  trigger: "assign" | "mention";
  commentBody?: string; // the comment that mentioned the agent, if any
}

interface DispatchResult {
  sessionId?: string;
}
```

## Built-in harnesses

| Harness name | Behavior |
|---|---|
| `local`, `claude-code`, `codex`, `opencode` | Local adapter — marks the dispatch `claimed` immediately; a human or daemon runs `tallyline claim` / MCP locally |
| `webhook` | POSTs the dispatch payload to the agent's `endpointUrl` (8s timeout); non-2xx → `dispatch_failed` |

## Dispatch lifecycle

`queued` → `claimed` → `completed` | `dispatch_failed` | `canceled`.
Failures write a `dispatch_failed` event and a plain-English comment on the
issue thread.

## Running a local session

`tallyline work` is the local runner: it polls `claimed` dispatches for your
agent identity, seeds `.tallyline-context.md` with the issue (key, title,
description, thread, board rules), and spawns the harness binary in an
isolated git worktree on branch `<KEY>-slug` — falling back to the current
directory outside a repo. On exit it reports back via
`POST /v1/:ws/dispatches/:id/report`, which marks the dispatch, writes a
`dispatch_completed`/`dispatch_failed` event, and posts the branch/PR link
as a thread comment.

```sh
tallyline work --dry-run            # show what would be spawned
tallyline work                      # process all claimed dispatches once
tallyline work --follow             # poll continuously (default 15s)
tallyline work --cmd <binary>       # override the harness binary
TALLYLINE_WORK_CMD=<binary>         # env override
```

Harness binaries are invoked as `<binary> <context-file>` with the issue
context file as argv[1]; `claude`/`codex`/`opencode` are auto-detected from
the agent's `harness` field. Agent keys may only report their own dispatches.
The spawned process gets `TALLYLINE_DISPATCH_ID` and `TALLYLINE_ISSUE_KEY`.

## Event-driven dispatch (n8n / webhook automations)

There is deliberately no in-app rule engine: transition-triggered dispatch is
an external automation over two seams that already exist — **outbound
webhooks** (docs/webhooks.md) notify your automation, and **assign / @mention**
trigger the dispatch. Works with n8n, a tiny HTTP function, or anything that
can receive a POST and make one.

The rule shape is *"when an issue lands in state S (optionally with label L),
dispatch agent A"*:

1. **Subscribe an endpoint** (owner/admin):
   `POST /v1/:ws/webhook-endpoints {"url": "https://…", "events": ["issue.state_changed"]}`
   — add `issue.created` if new issues should qualify, `issue.commented` only
   for comment-driven rules (see loop notes below).
2. **Filter in the consumer.** The payload carries `action`, `issueKey`,
   `before.state`, `after.state`, `actorType`. Keep a delivery only when
   `before.state !== after.state` and `after.state` matches your trigger
   (e.g. `"todo"`). Event payloads don't embed labels, assignees, or comment
   bodies — `issue.commented` carries only `after.commentId`. If the rule
   filters on those, `GET /v1/:ws/issues/:key` (and `…/comments`) and inspect
   the live objects.
3. **Trigger the dispatch** with a `write`-scoped PAT minted by the human the
   automation should act as:
   ```sh
   # assign trigger — the dispatch record says "assign"
   curl -X PATCH $API/v1/$WS/issues/$KEY -H "Authorization: Bearer tly_pat_…" \
     -H "content-type: application/json" \
     -d '{"assigneeType":"agent","assigneeId":"<agent-uuid>"}'

   # or mention trigger — thread shows the reason in plain text
   curl -X POST $API/v1/$WS/issues/$KEY/comments -H "Authorization: Bearer tly_pat_…" \
     -H "content-type: application/json" \
     -d '{"body":"@triage-bot rule: state→todo + label backend"}'
   ```
   Agent ids come from `GET /v1/:ws/agents`. Both routes return 2xx and the
   dispatch lifecycle (`queued → claimed/dispatch_failed`) reports back on the
   issue thread — there is no `POST /dispatches` route and none is needed.

### Loop prevention — required reading

Assign-to-agent PATCHes emit **no** `issue.state_changed`, and the dispatch
ack comment posts as `actorType: "system"` — which emits nothing — so a
state rule can't retrigger itself. The sharp edges are elsewhere:

- **Your own trigger comments.** A mention-trigger POST made with a PAT fires
  `issue.commented` with `actorType: "human"`. A comment-driven rule
  subscribed to `issue.commented` will see its own triggers — drop payloads
  whose `actorId` is the automation's PAT user, or never subscribe to
  `issue.commented` for state rules.
- **Duplicate deliveries.** Webhooks retry; dedupe on `X-Tallyline-Delivery`
  or the payload's `id` before acting.
- **Re-assignment re-dispatches.** `PATCH` with an agent assignee creates a
  dispatch *every call*, even re-assigning the same agent — gate your consumer
  on "not already assigned to this agent" if that isn't what you want.
- **Fan-out subscriptions.** A catch-all `["*"]` endpoint receives
  `issue.dispatched` for your own triggers too — a dispatch rule must ignore
  `issue.dispatch_*` actions explicitly.

Built-in escape hatch: `send_back` in review already re-dispatches to the
issue's last agent automatically — don't recreate that with a
`in_review → in_progress` rule.

## Session timeline

Inside a session the harness posts structured progress events:

```sh
tallyline session implementing "refactoring dispatch router"   # TALLYLINE_DISPATCH_ID set by `tallyline work`
tallyline session testing "api suite green" --dispatch <uuid>
```

`POST /v1/:ws/dispatches/:id/events` accepts batches of
`{kind, message}` — kinds: `reading|planning|implementing|testing|reviewing|pr|note|error`.
Events persist in `dispatch_events` (replayable forever), roll up into one
`session_update` feed event per append (SSE consumers refetch the log), and
render as the "Agent sessions" timeline on the issue page. Agent keys can
only append to and read their own session logs.

## Webhook payload

```json
{
  "dispatchId": "uuid",
  "issue": { "id": "uuid", "key": "GH-1", "title": "…", "description": "…" },
  "agent": { "id": "uuid", "name": "reviewer-bot" },
  "trigger": "assign",
  "comment": "@reviewer-bot take a look"
}
```

Dispatch deliveries ride the outbound pipeline: HMAC-SHA256 signing, 30s ×
2^attempt retry, 5-attempt cap — see docs/webhooks.md for the wire details.
Third-party harnesses that need a first-class adapter can implement
`DispatchAdapter` in `apps/api/src/services/dispatch.ts` and register it in
`ADAPTERS`.
