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

`queued` → `claimed` → `completed` | `dispatch_failed` | `canceled`.
Failures write a `dispatch_failed` event and a plain-English comment on the
issue thread.

## Running a local session

`docketry work` is the local runner: it polls `claimed` dispatches for your
agent identity, seeds `.docketry-context.md` with the issue (key, title,
description, thread, board rules), and spawns the harness binary in an
isolated git worktree on branch `<KEY>-slug` — falling back to the current
directory outside a repo. On exit it reports back via
`POST /v1/:ws/dispatches/:id/report`, which marks the dispatch, writes a
`dispatch_completed`/`dispatch_failed` event, and posts the branch/PR link
as a thread comment.

```sh
docketry work --dry-run            # show what would be spawned
docketry work                      # process all claimed dispatches once
docketry work --follow             # poll continuously (default 15s)
docketry work --cmd <binary>       # override the harness binary
DOCKETRY_WORK_CMD=<binary>         # env override
```

Harness binaries are invoked as `<binary> <context-file>` with the issue
context file as argv[1]; `claude`/`codex`/`opencode` are auto-detected from
the agent's `harness` field. Agent keys may only report their own dispatches.
The spawned process gets `DOCKETRY_DISPATCH_ID` and `DOCKETRY_ISSUE_KEY`.

## Session timeline

Inside a session the harness posts structured progress events:

```sh
docketry session implementing "refactoring dispatch router"   # DOCKETRY_DISPATCH_ID set by `docketry work`
docketry session testing "api suite green" --dispatch <uuid>
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

Payload signing, endpoint management UI, and retry/backoff land with the
external-harness work in milestone v0.4 (#25). Third-party harnesses that need
a first-class adapter can implement `DispatchAdapter` in
`apps/api/src/services/dispatch.ts` and register it in `ADAPTERS`.
