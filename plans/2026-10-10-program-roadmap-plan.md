---
title: docketry - Program roadmap
type: program
date: 2026-10-10
topic: docketry
artifact_contract: ce-unified-plan/v1
origin: plans/2026-10-08-1647-feat-docketry-plan.md
execution: code
---

# docketry - Program roadmap (2026-10-10)

Generated in `mode:pipeline confirm:auto`. The skill's full research and review phases were
condensed: evidence comes from a direct code read at `b605b47`, the landscape research in
`docs/research/2026-10-10-landscape.md`, and the check run recorded below. No application code is
changed by this pass.

## Goal Capsule

- **Objective:** move docketry from "v1.0.0 feature-complete on paper" to "running as the system of
  record for its own roadmap" (issue #88), with the repo claims matching the code.
- **Product authority:** `plans/2026-10-08-1647-feat-docketry-plan.md` (R1-R25) stays the product
  contract. This plan sequences work against it and does not add product behaviour.
- **Baseline (2026-10-10):** `pnpm check` against an isolated Postgres/Redis: typecheck, lint and all
  unit and integration tests pass (api 123, types 23, n8n 10, composio 4, cli, mcp). The e2e
  package failed only because its script runs `docker compose up` and ports 5432/6380 were already bound
  on the machine (exit 1). It was not re-run in isolation, so e2e status is unknown, not green.

## Status key

`done` = in `main` with test or doc evidence. `partial` = part exists. `todo` = not started.

## Now (next 1-2 weeks: make claims true, close the loop)

### U1. Reconcile the docs with the code (BullMQ, dispatch worker, empty packages)
- **Status:** todo. **Evidence:** `README.md` and `AGENTS.md` list a "BullMQ dispatch worker" at
  `services/dispatch`; `bullmq` appears in no `package.json`; `services/dispatch/src/index.ts` is a
  4-line interface (`launch(issueKey)`) that disagrees with the real contract in `docs/adapters.md`;
  dispatch lives in `apps/api/src/services/dispatch.ts`. `packages/ui/` has an empty `src/` and no
  `package.json`.
- **Depends on:** none. **Verification:** `rg -i bullmq` returns nothing in docs; `pnpm install` and
  `pnpm check` still pass after removing the stub workspace.
- **Difficulty:** easy. Docs edits plus deleting two directories.
- **Feasibility:** nothing external. Check `pnpm-workspace.yaml` and `turbo.json` filters for the
  removed names.
- **Simpler alternative:** this unit is the simplification. Delete `services/dispatch/` and
  `packages/ui/`; fold the Stack list in `README.md` and `AGENTS.md` to what exists.

### U2. Add a GitHub Actions gate for `pnpm check`
- **Status:** todo. **Evidence:** `.github/workflows/` holds only `argus-reviewer.yml` and
  `argus-mention.yml`; `CONTRIBUTING.md` says "There is no GitHub Actions CI"; the e2e script binds
  fixed host ports.
- **Depends on:** U3 (e2e port handling) for the e2e job; typecheck/lint/unit job can ship first.
- **Verification:** a PR run shows green typecheck, lint and tests; a deliberately broken type fails it.
- **Difficulty:** medium. Postgres and Redis service containers are easy; `tools/e2e` needs Playwright
  browsers and a built web app.
- **Feasibility:** Actions minutes are free on public repos. Branch protection requires the repo
  standard from `~/bin/gh-new-repo` (already applied per AGENTS.md).
- **Simpler alternative:** one job, typecheck + lint + `pnpm --filter ./apps/api --filter ./packages/types test`,
  leave e2e as a nightly workflow. Most of the regression value for a fraction of the setup.

### U3. Make e2e and perf scripts runnable beside other stacks
- **Status:** todo. **Evidence:** `tools/e2e/package.json` `test` runs `docker compose up -d` from the
  repo root; `docker-compose.yml` publishes 5432 and 6380, which collided with an already running stack
  during this program's check run.
- **Depends on:** none. **Verification:** `pnpm check` completes with another Postgres bound to 5432.
- **Difficulty:** easy. Read host ports from env (`${POSTGRES_PORT:-5432}`), or let e2e use
  `E2E_*` variables without touching compose.
- **Feasibility:** none.
- **Simpler alternative:** drop `docker compose up -d` from the `test` script and document
  `pnpm db:up` as a prerequisite, as `CONTRIBUTING.md` already does.

### U4. Agent key revoke and rotate routes
- **Status:** todo (documented as tracked). **Evidence:** `docs/agents.md` says revoke today means
  deleting the key row by SQL; `apps/api/src/routes/agents.ts` has POST and GET on `/agents/:id/keys`
  only. Seeded issue DOK-5 in the demo workspace models this.
- **Depends on:** none. **Verification:** API tests for DELETE (own workspace 204, other workspace 403,
  revoked key then fails `whoami` with 401); `docs/agents.md` updated; MCP and CLI unaffected.
- **Difficulty:** easy. One route, one test file; keys are already hashed rows.
- **Feasibility:** none. Decide whether revoke is a delete or a `revoked_at` column (migration).
- **Simpler alternative:** hard delete, no migration; add `revoked_at` only if an audit trail of
  revocations is wanted (the event log already records the action if emitted).

### U5. Stand up the hosted dogfood instance (issue #88)
- **Status:** todo. **Evidence:** issue #88; `docs/deploy.md` has Cloudflare Tunnel and Railway paths;
  `docker-compose.selfhost.yml` exists.
- **Depends on:** U1, U4. **Verification:** the open-computer roadmap is tracked on a docketry board
  reachable by an agent using a scoped key through MCP; one full claim, PR, review, done loop is
  recorded in the event log.
- **Difficulty:** medium. The stack is built; the work is secrets, backups, and finding the gaps real
  use exposes.
- **Feasibility:** a host (Railway or the user's server), a domain or tunnel, and a Postgres backup
  plan. Hosting cost is the only spend.
- **Simpler alternative:** run it on the existing machine behind Cloudflare Tunnel via the selfhost
  compose file before paying for any platform.

## Next (1-2 months: close the gap with the reference experience)

### U6. Decide on Redis, then remove it or use it
- **Status:** todo. **Evidence:** `apps/api` imports `ioredis` only in `src/health.ts` (a ping) and
  reads `REDIS_URL` in `src/env.ts`; no queue, cache or pub/sub exists. `routes/events.ts` says
  pub/sub is "a later work order". The stack ships Redis in `docker-compose.yml` and
  `docker-compose.selfhost.yml`.
- **Depends on:** U1. **Verification:** if removed, `/health` reports Postgres only, the selfhost
  compose has two services, and the e2e and bench scripts still pass; if kept, a real consumer exists.
- **Difficulty:** easy to remove, medium to use.
- **Feasibility:** none to remove. Using it for realtime needs the U7 design.
- **Simpler alternative:** delete Redis for v1 and use Postgres `LISTEN/NOTIFY` for U7. One fewer
  container for self-hosters, which supports the "under 10 minutes" promise.

### U7. Replace 1-second polling SSE with push
- **Status:** partial. **Evidence:** `routes/events.ts` polls every 1 s per connection; the CLI
  `events --follow` and the web activity feed depend on it.
- **Depends on:** U6 decision. **Verification:** p95 cross-client latency under 300 ms in the e2e
  keymap/board specs; connection count test shows no per-connection DB query loop.
- **Difficulty:** medium. A single shared listener fanning out to SSE streams, with cursor replay on
  reconnect to keep the current resume behaviour.
- **Feasibility:** `pg_notify` payload limit is 8000 bytes; send ids only and read rows.
- **Simpler alternative:** keep polling but share one poller across connections (one query per second
  total). Often enough at self-host scale, and a small change to `events.ts`.

### U8. Agent sessions: acknowledge, stream and close like Linear's protocol
- **Status:** partial. **Evidence:** dispatch acks on the thread and has `/dispatches/:id/events` and
  `/report` (`docs/adapters.md`); Linear's session protocol requires an acknowledging activity in 10 s
  and models delegate separately from assignee ([landscape](../docs/research/2026-10-10-landscape.md)).
- **Depends on:** U5 for real usage evidence. **Verification:** a dispatch with no acknowledgement in a
  configured window flips to `dispatch_failed` with a thread comment; session timeline shows state.
- **Difficulty:** medium. Mostly a timeout in the sweeper and UI states in `session-timeline.tsx`.
- **Feasibility:** none external; do not copy Linear's schema or names.
- **Simpler alternative:** only add the ack timeout; skip a delegate field until a second
  agent-on-human-issue use case appears.

### U9. Transition-triggered dispatch
- **Status:** todo. **Evidence:** only assign and `@mention` dispatch exist (`docs/adapters.md`); Jira
  offers workflow-transition triggers ([landscape](../docs/research/2026-10-10-landscape.md)).
- **Depends on:** U8. **Verification:** a rule "when state becomes `todo` with label X, dispatch agent
  Y" fires once, is idempotent across retries, and is visible in the event log.
- **Difficulty:** medium. Rule storage, loop prevention.
- **Feasibility:** risk of dispatch loops; reuse the loop-prevention approach from GitHub sync.
- **Simpler alternative:** a webhook consumer (n8n node already exists) can do this today; document that
  recipe in `docs/adapters.md` instead of building rule storage.

### U10. Web UI: virtualization, board overflow and the design pass
- **Status:** partial. **Evidence:** screenshots in this PR show the board scrolling horizontally at
  1760 px (six columns); `docs/perf-budgets.md` budgets 10k issues; `DESIGN.md` Known Gaps lists board
  anatomy and drag states as unspecified.
- **Depends on:** none. **Verification:** the `perf.spec.ts` and `a11y.spec.ts` suites pass; board at
  1440 px shows a collapse rule for empty columns.
- **Difficulty:** medium.
- **Feasibility:** none.
- **Simpler alternative:** collapse empty columns by default and cap the board at the active states
  before building virtualization.

### U11. Voice intake via WordInk (issue #41)
- **Status:** todo. **Evidence:** issue #41, labelled `roadmap`, `hitl`, `pillar:integrations`.
- **Depends on:** U5. **Verification:** dictating into WordInk creates a `triage` issue with source
  recorded.
- **Difficulty:** medium. docketry side is a normal intake call.
- **Feasibility:** blocked on the WordInk SDK's Phase 2 direction, which is the owner's decision.
- **Simpler alternative:** WordInk calls the existing `POST /issues` (state `triage`) or the n8n
  trigger; no docketry code needed.

## Later (a quarter or more)

### U12. OAuth agent install and per-agent permissions
- **Status:** todo. **Evidence:** keys are only `read` or `write`; humans mint them in the UI or API.
- **Depends on:** U4, U8. **Verification:** an MCP client can complete an OAuth flow and receive a
  scoped agent identity.
- **Difficulty:** hard. An authorisation server surface and consent UI.
- **Feasibility:** hosted MCP gateways (Klavis, `docs/klavis.md`) already pass headers through, so
  this is only needed if clients insist on OAuth, as Linear's MCP does.
- **Simpler alternative:** keep static keys and add finer scopes (`issues:write`, `comments:write`)
  to the existing key table.

### U13. Multi-workspace and hosted-tenant hardening
- **Status:** partial. **Evidence:** every query is workspace-scoped (R24), but bootstrap is single
  workspace; the CHANGELOG says a hosted SaaS is out of scope for this repo.
- **Depends on:** U5. **Verification:** isolation tests for cross-workspace access on every route.
- **Difficulty:** hard. **Feasibility:** product decision, not technical.
- **Simpler alternative:** do not build it. Self-host per team.

### U14. Reduce the integration surface to what is used
- **Status:** todo. **Evidence:** GitHub sync, Slack, n8n, Composio, Klavis docs, LLM assist, two
  importers and Argus CI all ship in v1.0.0 with one user.
- **Depends on:** U5 (a quarter of real use). **Verification:** removed surfaces have no references
  and `pnpm check` passes.
- **Difficulty:** medium (deleting is easy; deciding is the work).
- **Feasibility:** none.
- **Simpler alternative:** mark unused integrations "experimental" in README rather than deleting.
  Candidates by cost: `apps/api/src/services/assist.ts` + `llm.ts` (opt-in, off by default),
  `integrations/composio`, `docs/klavis.md`.

## Biggest simplification

Delete `services/dispatch/` and `packages/ui/` (U1) and decide on Redis (U6): three of the five
infrastructure claims in the README (BullMQ worker, shared UI package, Redis) have no code behind them.

## Open decisions for the owner

1. Redis: remove for v1 or keep for a realtime design (U6)?
2. Logo and glint use in the brand mark (see `assets/brand/README.md`).
3. WordInk Phase 2 direction (U11).
