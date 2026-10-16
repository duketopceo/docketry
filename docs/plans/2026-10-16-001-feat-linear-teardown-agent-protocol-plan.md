---
title: Linear teardown and tallyline plan (agent sessions, triage suggestions, loops, delta sync)
type: feat
date: 2026-10-16
depends_on: plans/2026-10-10-program-roadmap-plan.md, docs/plans/2026-10-13-1535-feat-next-tier-plan.md
---

# Linear teardown → tallyline plan

## Summary

Linear's public GraphQL schema exposes how it models agents, triage, and
automation. Tallyline already has the tracker core, dispatch records, an
events log, MCP and CLI. The gaps that matter are: a typed agent-session
protocol, delegate separate from assignee, elicitation (agent asks, human
answers, session resumes), AI triage suggestions, issue relations, trigger
driven loops, and a delta-sync read path for the web client. This plan
adds those. It does not attempt Linear's full sync engine.

Unit IDs are `L1`–`L8`. They never renumber. Roadmap IDs stay `U1`–`U15`;
overlaps are called out.

## Provenance

- **source-assisted**: `linear/linear` SDK repository, file
  `packages/sdk/src/schema.graphql` (53k lines, 739 types), read 2026-10-16.
  This is Linear's published API schema, not client internals.
  https://github.com/linear/linear
- **documentation-based**: Linear developer docs for agents and the sync
  engine talk. https://linear.app/developers/agents,
  https://linear.app/now/scaling-the-linear-sync-engine
- **third-party** (lower weight): write-ups of the sync talk.
  https://www.fujimon.com/blog/linear-sync-engine,
  https://queryplane.com/blog/local-first-databases/
- Not done: no inspection of Linear's web client bundle. Sync-engine
  claims come from Linear's own talk and are marked moderate.

## Research Findings

### A. Agent model (source-assisted, high)

- `AgentSession` has `status` ∈ {pending, active, awaitingInput, complete,
  error, stale, stopping}, a `plan` JSON, `pullRequests`, `codingHarness`,
  `externalLinks`, and links to the issue and comment thread.
- `AgentActivity` carries typed `content`: `thought`, `action`,
  `elicitation`, `response`, `error`, `prompt`. Activities can be
  `ephemeral` (replaced by the next one), `queued`, or carry a `signal`
  (for example stop).
- `AgentSkill` is a shared, workspace-level skill definition agents can
  advertise.
- Agent docs (documentation-based, high): an agent is a **delegate**, not
  the assignee; humans keep ownership. The agent must emit a `thought`
  within 10 seconds of a session start or it is marked unresponsive. OAuth
  uses `actor=app` with `app:mentionable` and `app:assignable` scopes.

### B. Triage and automation (source-assisted, high)

- `IssueSuggestion` kinds: suggested label, project, team, user
  (assignee), and duplicate. Suggestions are accepted or dismissed and
  carry provenance.
- `TriageResponsibility` with a `TimeSchedule` assigns who owns triage per
  team and when. `SlaConfiguration` exists; out of scope here.
- `IssueRelationType` ∈ {blocks, duplicate, related, similar}.
- `WorkflowDefinition` (Loops) triggers: chat, cycle, document,
  initiative, issue, project, pullRequest, release, schedule, team,
  webhook. Actions run agents or mutate fields.
- Initiatives, Customers, CustomerNeeds, Releases, cycle progress history
  exist. Out of scope here.

### C. Sync engine (documentation-based, moderate)

- Client holds the workspace in IndexedDB and hydrates a MobX object pool;
  UI reads local data only.
- Writes are optimistic; a persisted transaction queue replays after
  offline; the server orders transactions with a sync id and sends deltas
  over WebSocket; last-write-wins; CRDT only for rich text.
- Heavy tables (Issue, Comment) lazy-hydrate.

### D. Tallyline today (in-tree, high)

| Linear concept | tallyline | Gap |
|---|---|---|
| AgentSession status | `dispatches.status` queued/claimed/completed/dispatch_failed/canceled | no awaitingInput, stale, stopping; no plan, PR links |
| AgentActivity typed content | `dispatch_events(kind, message)` | untyped; no ephemeral/queued/signal |
| delegate ≠ assignee | `assigneeType` human/agent | agent is the assignee; owner is lost |
| 10 s acknowledgement | none | roadmap U8 planned it; L1 implements it |
| elicitation | none | whole loop |
| IssueSuggestion | `services/assist.ts` exists | no table, no accept/dismiss, no duplicate detection |
| relations | `duplicate` state only | no relation table |
| Loops | dispatch on assign/mention only | roadmap U9 transition dispatch; L6 generalizes |
| delta sync | poller per connection; next-tier U2 shared poller | no client cache, no sync cursor |
| AgentSkill | none | L8 |

### E. Verdicts

- Linear's lead over agent-native trackers is the **typed session
  protocol**, not UI. Tallyline can match it in one schema migration
  (high).
- Delegate vs assignee matters. Agent-as-assignee hides who is accountable
  when the agent fails (high). Keep `assigneeType=agent` for API
  compatibility one release, then deprecate.
- Do not build the sync engine. A sync cursor on `events` plus a client
  cache gets instant navigation for one-operator workspaces (moderate).
  Counterargument: Linear says the engine is why they ship fast. For a
  tracker whose primary clients are agents over MCP and REST, the client
  cache is the lesser need.

## Key Technical Decisions

- **D1.** New tables `agent_sessions` and `agent_activities`; `dispatches`
  stays as the intent record and gains `sessionId`. Status enum copies
  Linear's seven values verbatim so adapters map one-to-one.
- **D2.** Activity content is a discriminated JSON union
  `{type: thought|action|elicitation|response|error|prompt, ...}` with
  `ephemeral`, `queued`, `signal` columns. Validated with zod in
  `packages/types`.
- **D3.** Issues gain `delegateType` and `delegateId`. Dispatch triggers
  on delegate, not assignee. `assigneeType=agent` logs a deprecation event.
- **D4.** Elicitation is an activity plus a comment with `promptId`; the
  human reply mutates the session from `awaitingInput` to `active` and
  posts a `prompt` activity to the adapter. Timeout defaults to 24 h.
- **D5.** Suggestions are generated by `services/assist.ts` through
  OpenRouter on issue create into `triage`, stored in `issue_suggestions`,
  never auto-applied. Duplicate and similar use pgvector embeddings on
  title plus description.
- **D6.** Loops = `workflow_definitions(trigger, condition, action)` with
  triggers `issue.transition`, `schedule`, `webhook`, `pull_request`.
  Actions: dispatch, comment, set_field. Evaluated by the existing
  `services/background.ts` tick.
- **D7.** Delta sync: `events.syncId` bigserial; `GET /sync?since=` returns
  ordered deltas; web client caches entities in IndexedDB and applies
  deltas; optimistic writes via TanStack Query with rollback on 4xx.
- **D8.** No SLA, initiatives, customers, releases in this plan.

## Implementation Units

### L1. Agent session and activity tables plus ack timeout
- **Goal:** every agent run is a session with typed activities and
  Linear's status set. Subsumes roadmap U8 and next-tier U3.
- **Files:** `apps/api/src/db/schema.ts`, new drizzle migration,
  `packages/types/src/agent.ts`, `apps/api/src/services/dispatch.ts`,
  `apps/api/src/routes/dispatches.ts`, `apps/api/src/services/background.ts`
  (stale sweep), `apps/mcp-server/src/tools.ts` (`session_post_activity`,
  `session_get`), `docs/` protocol page.
- **Behavior:** session created `pending` on dispatch; first `thought`
  within 10 s moves to `active`; no activity for 10 s → `stale` and a
  dispatch event; `ephemeral` activities replace the prior ephemeral one;
  `signal=stop` moves to `stopping`.
- **Test scenarios:** status transitions table; stale sweep with the
  `clock` service; ephemeral replacement; zod rejects unknown content
  types; MCP tools round-trip.
- **Verification:** `pnpm check` green; an adapter script completes a
  session end to end against the local stack.

### L2. Delegate separate from assignee
- **Goal:** humans own issues; agents are delegates.
- **Files:** schema and migration (`delegateType`, `delegateId`),
  `apps/api/src/routes/issues.ts`, `apps/api/src/services/dispatch.ts`
  (trigger on delegate), `apps/web/src` issue panel (delegate picker),
  `apps/mcp-server/src/tools.ts` (`issue_delegate`), CLI, OpenAPI,
  CHANGELOG deprecation note.
- **Test scenarios:** delegate set dispatches; assignee set does not;
  legacy `assigneeType=agent` still dispatches and logs deprecation;
  authz: only members can delegate.
- **Verification:** web shows owner and delegate side by side.

### L3. Elicitation loop
- **Goal:** an agent can ask and resume.
- **Files:** `apps/api/src/services/dispatch.ts`, `routes/dispatches.ts`
  (`POST /sessions/:id/reply`), `routes/issues.ts` (comment with
  `promptId`), `apps/web/src` session thread (answer box),
  `apps/mcp-server/src/tools.ts` (`session_elicit`, `session_reply`),
  `services/notifications` (notify owner on elicitation).
- **Test scenarios:** elicitation sets `awaitingInput` and notifies; reply
  posts a `prompt` activity and sets `active`; second reply to a closed
  prompt is rejected; 24 h timeout → `stale`.
- **Verification:** manual run: agent asks, human answers in web, adapter
  receives the prompt.

### L4. Issue suggestions and duplicate detection
- **Goal:** triage gets label, project, team, assignee and duplicate
  suggestions with accept or dismiss.
- **Files:** schema (`issue_suggestions`, `issue_embeddings` with pgvector),
  migration, `apps/api/src/services/assist.ts` (OpenRouter call, embedding
  upsert), `routes/issues.ts` (`/suggestions`, accept, dismiss),
  `apps/web/src` triage view chips, `apps/mcp-server` (`issue_suggestions`),
  `docker-compose*.yml` (pgvector image).
- **Test scenarios:** suggestion generation is idempotent per issue
  version; accept applies exactly the field; dismiss records reason;
  duplicate candidates above cosine threshold only; OpenRouter failure
  leaves triage usable.
- **Verification:** 20 seeded issues produce sensible suggestions on
  review; cost per issue logged.

### L5. Issue relations
- **Goal:** blocks, duplicate, related, similar as first-class edges.
- **Files:** schema (`issue_relations`), migration, `routes/issues.ts`,
  `apps/web/src` relations section, MCP and CLI, OpenAPI.
- **Behavior:** `duplicate` relation sets state `duplicate` on the
  source; `blocks` shows on the board; `similar` is written by L4.
- **Test scenarios:** inverse edges maintained; cycle in `blocks`
  rejected; deleting an issue removes edges; events logged.
- **Verification:** board shows blocked badge.

### L6. Loops (workflow definitions)
- **Goal:** trigger → condition → action automation. Subsumes roadmap U9
  and next-tier U4.
- **Files:** schema (`workflow_definitions`, `workflow_runs`), migration,
  `apps/api/src/services/loops.ts` (new evaluator), `services/
  background.ts` (schedule tick), `routes/webhooks.ts` (webhook trigger),
  `routes/github.ts` (PR trigger), settings UI page, MCP tools.
- **Behavior:** triggers `issue.transition`, `schedule` (cron), `webhook`,
  `pull_request`; actions `dispatch`, `comment`, `set_field`; every run is
  logged with the matched condition; failures do not retry more than 3
  times.
- **Test scenarios:** transition into `in_review` dispatches a reviewer
  agent; cron fires once per window; webhook with bad signature ignored;
  run log complete.
- **Verification:** one loop runs on the dogfood instance for a week.

### L7. Delta sync read path and client cache
- **Goal:** instant navigation and offline reads without a sync engine.
  Extends next-tier U2.
- **Files:** schema (`events.syncId` bigserial, index), migration,
  `routes/events.ts` (`GET /sync?since=`), `services/event-hub.ts`
  (push deltas on the shared poller), `apps/web/src/lib/cache/` (new:
  IndexedDB store, hydrate, apply delta), TanStack Query mutations with
  optimistic update and rollback.
- **Behavior:** first load hydrates from server then caches; later loads
  render from cache and apply deltas since the stored cursor; mutations
  apply locally, send, roll back on 4xx.
- **Test scenarios:** delta ordering is total per workspace; cursor
  resume after disconnect; rollback restores prior state; cache cleared on
  workspace switch.
- **Verification:** cold navigation between issue and board under 50 ms
  from cache on the dogfood instance.

### L8. Agent skills registry and session plan links
- **Goal:** sessions carry a plan and PR links; agents advertise skills.
- **Files:** schema (`agent_skills`, `agent_sessions.plan`,
  `agent_sessions.pullRequests`), migration, `routes/agents.ts`,
  `services/github-sync.ts` (PR link discovery), web session header, MCP.
- **Test scenarios:** plan JSON validates; PR links dedupe; skill list
  filters agent picker.
- **Verification:** a session shows plan and PRs in web.

## Scope Boundaries

- No SLA, initiatives, customers, releases, cycle progress history.
- No MobX object pool or transaction log replay; L7 is a cache with a
  cursor.
- No OAuth `actor=app` redesign; agent keys stay. Roadmap U12 covers
  OAuth agent install.
- No change to AGPL licensing or hosting.

## Risks

- Schema churn across three apps and the MCP server. Mitigation: L1 and
  L2 ship behind one migration each with compatibility reads.
- pgvector adds an image dependency to self-host. Mitigation: suggestions
  degrade to label/project/team without embeddings.
- OpenRouter cost on every triage create. Mitigation: cheap model,
  per-workspace daily cap, logged.
- L7 cache invalidation bugs. Mitigation: cursor plus full-rehydrate on
  schema version change.

## Sources

- Linear SDK schema: https://github.com/linear/linear (packages/sdk/src/schema.graphql)
- Linear agents guide: https://linear.app/developers/agents
- Scaling the Linear Sync Engine: https://linear.app/now/scaling-the-linear-sync-engine
- Sync engine summaries: https://www.fujimon.com/blog/linear-sync-engine,
  https://queryplane.com/blog/local-first-databases/
- In-tree: `docs/research/2026-10-10-landscape.md`, `ROADMAP.md`,
  `docs/plans/2026-10-13-1535-feat-next-tier-plan.md`
