# Dispatch adapters — the harness contract

Docketry routes work to agents through **adapters**. When a human assigns an
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
`dok_agt_*` scoped keys).

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
| `local`, `claude-code`, `codex`, `opencode` | Local adapter — marks the dispatch `claimed` immediately; a human or daemon runs `docketry claim` / MCP locally |
| `webhook` | POSTs the dispatch payload to the agent's `endpointUrl` (8s timeout); non-2xx → `dispatch_failed` |

## Dispatch lifecycle

`queued` → `claimed` | `dispatch_failed` (`completed`/`canceled` reserved for
later session management). Failures write a `dispatch_failed` event and a
plain-English comment on the issue thread.

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

Payload signing, endpoint management UI, and retry/backoff land with the
external-harness work in milestone v0.4 (#25). Third-party harnesses that need
a first-class adapter can implement `DispatchAdapter` in
`apps/api/src/services/dispatch.ts` and register it in `ADAPTERS`.
