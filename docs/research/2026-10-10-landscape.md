# Landscape: who else builds this, and where docketry sits

Date: 2026-10-10. Scope: issue trackers a team could pick instead of docketry, and the
agent-native trackers that appeared in 2025-2026. Claims carry a source URL. Items marked
"snippet" were seen only in a search result, not on the page itself; "unverified" means I could
not confirm them. Where a page could not be fetched, that is noted.

## What "agent-native" means in this code

Checked against the code and docs at `b605b47`, not the marketing line.

- **Agents are identities, not API users.** An `agents` table holds name, harness, capabilities and
  an optional `endpointUrl`. Issues take `assigneeType: "human" | "agent"` plus `assigneeId`
  (`apps/api/src/routes/issues.ts`). Every event row carries `actorType`/`actorId`, so activity
  is attributed to the agent by name (`docs/agents.md`, `apps/api/src/db/schema.ts`).
- **Scoped keys.** `dok_agt_*` keys are workspace-bound, `read` or `write` scoped, stored as SHA-256,
  and cannot mint other agents or keys. Humans use `dok_pat_*` tokens or session JWTs
  (`docs/agents.md`). `GET /v1/whoami` resolves any credential to its identity.
- **MCP server.** `apps/mcp-server` is a thin client over the REST API with 15 tools (`whoami`,
  `list_issues`, `ready`, `get_issue`, `create_issue`, `update_issue`, `triage_issue`, `comment`,
  `claim`, and list tools for agents, teams, labels, projects, cycles, events). Transports are stdio
  and stateless Streamable HTTP; the HTTP mode can run per-request header passthrough
  (`Authorization` + `x-docketry-workspace`) for hosted gateways (`docs/mcp.md`). API errors come
  back as MCP tool errors with the API's `{error:{code,message}}` envelope.
- **The state machine is the guard rail.** `triage -> backlog -> todo -> in_progress -> in_review ->
  done`, plus `canceled` and `duplicate`, is enforced server-side for humans and agents alike
  (`packages/types/src/state-machine.ts`; illegal moves return 409 `INVALID_TRANSITION`).
- **Outbound signed webhooks.** HMAC-SHA256 over the raw body in `X-Docketry-Signature`, eight
  event types, exponential retries with a delivery log (`docs/webhooks.md`).
- **Dispatch.** Assigning an issue to an agent or `@mention`ing it creates a durable `dispatches`
  record, posts an ack on the thread, and calls the adapter for the agent's `harness`. Built-ins:
  `local` family (marks `claimed`; a human or daemon runs `docketry claim`) and `webhook` (signed POST,
  8 s timeout, same retry pipeline). The harness reports back through
  `POST /v1/:ws/dispatches/:id/events` and `/report` (`docs/adapters.md`, `docs/webhooks.md`).
- **Agent-shaped CLI.** `docketry ready|claim|start|done|comment|events --follow`, `--json`
  everywhere, machine-stable exit codes 0-5 (`docs/agents.md`).
- **Board rules for agents.** `SKILL.md` ships claim etiquette and lifecycle rules.
- **Reach.** GitHub App sync, Slack intake and thread mirror, n8n node, Composio toolkit, importers
  for GitHub issues and Linear CSV (`CHANGELOG.md`).

What it is not (yet), from the code: the realtime stream is 1-second polling SSE
(`apps/api/src/routes/events.ts`); no key-revoke route exists (`docs/agents.md`);
`services/dispatch` is a stub and `redis` is used only for a health ping (see the roadmap plan).
There is no OAuth agent install flow of the kind Linear has.

## Comparison

| Project | Licence | Self-host | Agent story | Source |
|---|---|---|---|---|
| Linear | Proprietary | No | Hosted MCP, agent sessions, delegation | [pricing](https://linear.app/pricing), [mcp](https://linear.app/docs/mcp), [agents](https://linear.app/developers/agents) |
| Plane | AGPL-3.0 | Docker, Kubernetes | Official MCP server (MIT), no agent actors found | [repo](https://github.com/makeplane/plane), [mcp](https://developers.plane.so/dev-tools/mcp-server) |
| Huly | EPL-2.0 | Docker | API client; no MCP or agent story found | [repo](https://github.com/hcengineering/platform) |
| GitHub Issues | Proprietary | GHES | Copilot, Claude, Codex assignable | [changelog](https://github.blog/changelog/2025-05-19-github-copilot-coding-agent-in-public-preview/) |
| Jira | Proprietary | Data Center only (unverified) | Agents in Jira, Rovo MCP | [Atlassian](https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/) |
| Taiga | MPL-2.0 (snippet) | Yes | None found | [community](https://community.taiga.io/t/important-update-on-the-next-taiga-and-kaleidos/171) |
| Hiveship | Not stated | Hosted | MCP, SSE, signed webhooks, SDK | [site](https://hiveship.app) |
| Epiq | MIT | Local, git-backed | `epiq-mcp`, named agent identities | [repo](https://github.com/ljtn/epiq) |
| Backlog.md | MIT | Files in repo | Optional MCP, CLI | [repo](https://github.com/MrLesk/Backlog.md) |

## Per project

### Linear
Closed SaaS. Free plan: unlimited members, 2 teams, 250 issues; Basic is $10 and Business $16 per
user per month billed yearly ([pricing](https://linear.app/pricing)).
The official MCP server is remote only (`https://mcp.linear.app/mcp`, plus a read-only path), uses
OAuth 2.1 or a bearer key, and has no stdio mode or self-host option ([MCP docs](https://linear.app/docs/mcp)).
Agents are workspace actors that can be mentioned and assigned; assigning sets the agent as
`delegate` while a human stays the assignee. A mention or delegation opens an Agent Session, delivered
as an `AgentSessionEvent` webhook, and the agent must acknowledge with a `thought` activity within
10 seconds. Installed agents are not billable users and the API is in Developer Preview
([agents](https://linear.app/developers/agents)). Webhooks are HMAC-SHA256 signed in
`Linear-Signature` with a timestamp replay check, retried at 1 minute, 1 hour and 6 hours
([webhooks](https://linear.app/developers/webhooks)). Triage is an inbox with accept, decline,
duplicate and snooze; Triage Rules and Triage Intelligence are Business and Enterprise
([triage](https://linear.app/docs/triage)).
- Better: the UX bar, a mature agent session protocol, free agent seats.
- Worse: no self-host, 250-issue free cap, preview-status agent API, an MCP server you cannot run
  against your own data.
- Takeaway for docketry: the delegate-vs-assignee split and the 10-second acknowledgement are
  worth copying as ideas. docketry already acks dispatches on the thread. Linear's trade dress and
  tokens are off limits (`plans/2026-10-08-1647-feat-docketry-plan.md`, R25).

### Plane
AGPL-3.0, about 60k stars, Docker and Kubernetes self-host ([repo](https://github.com/makeplane/plane)).
Seat minimums apply to self-hosted Commercial tiers from 2026-04-24; Community Edition is free
([forum, snippet](https://forum.plane.so/t/new-seat-minimums-on-self-hosted-commercial-and-air-gapped-starting-april-24/96)).
Its MCP server is MIT, Python (v0.3.3), with 30 tools covering 207 actions behind an `action`
parameter; a hosted endpoint uses OAuth, and self-hosted instances use stdio with `PLANE_BASE_URL`
([docs](https://developers.plane.so/dev-tools/mcp-server)). Webhooks are HMAC-SHA256 in
`X-Plane-Signature` with a stable `event_id` ([docs](https://developers.plane.so/dev-tools/intro-webhooks)).
I found no agent-as-assignee model.
- Better: breadth (cycles, modules, pages), a large community.
- Worse: AGPL, and some features sit behind paid tiers.
- Takeaway: Plane's 207 actions behind one parameter is a cautionary design for MCP; docketry's
  small, typed tool list is easier for a model to choose from. Plane is study material only (AGPL).

### Huly
EPL-2.0. The original repo is marked frozen and development moved to
`Platform-Collective/platform`; I found no MCP, webhook or agent surface
([repo](https://github.com/hcengineering/platform), [fork](https://github.com/Platform-Collective/platform)).
The claim that the hosted service shut down in July comes from one secondary source and is
unverified. Better: all-in-one (issues, docs, chat). Worse: fragmented upstream, heavy to run.

### GitHub Issues and Projects
Copilot's cloud agent is assigned to an issue like a developer and returns a PR from an Actions
sandbox ([changelog](https://github.blog/changelog/2025-05-19-github-copilot-coding-agent-in-public-preview/));
limits include one repo and one PR per task and a 59-minute session
([docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)).
Claude and Codex became assignable in public preview on 2026-02-04
([changelog, snippet](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/)).
The GitHub MCP server exposes an `assign_copilot_to_issue` tool
([Stacklok guide](https://docs.stacklok.com/toolhive/guides-mcp/github)).
- Better: distribution and native PR linkage. Worse: agents are vendor-hosted and credit-billed;
  the issue UI is not dense or keyboard-first in the Linear sense.
- Takeaway: docketry should treat GitHub as a feed (the plan's decision) and keep PR linkage via the
  GitHub App, which it already has.

### Jira
Agents can be assigned from a picker, mentioned, triggered by a workflow transition rule, or bound to a
board column; a site admin must enable Rovo and MCP agents, and it consumes Rovo credits
([Atlassian](https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/),
open beta announced 2026-02-24 per [Business Wire](https://businesswire.com/news/home/20260224033792/en/Atlassian-Introduces-Agents-in-Jira-to-Drive-Human-AI-Collaboration-at-Enterprise-Scale)).
Pricing figures differ across third-party sources, so I do not quote them.
- Better: governance and workflow-triggered agents. Worse: weight, cost, credit metering.
- Takeaway: "trigger an agent on a transition" is a pattern docketry does not have (today only
  assign and mention dispatch).

### Taiga
MPL-2.0 and self-hostable, but the next-generation rewrite was looking for a new home
([community, snippet](https://community.taiga.io/t/important-update-on-the-next-taiga-and-kaleidos/171),
[call for applications](https://community.taiga.io/t/important-announcement-taiganext-looking-for-a-new-home-call-for-applications-is-open/3464)).
No MCP or agent features turned up (absence in search only, so unverified). It is a mature agile
tool with an uncertain roadmap.

### Agent-native trackers
- **Hiveship**: closest in concept. Delegation from Claude Code, Cursor and Codex, SSE run
  streaming, signed webhooks, MCP and TypeScript SDK; hosted, with a free tier of 100 issues
  ([site](https://hiveship.app), [npm](https://socket.dev/npm/package/@hiveship/mcp-server)).
  Licence and self-host not stated.
- **Tembo**: turns Linear or Jira tickets into PRs across several coding agents; it is a dispatcher,
  not a tracker ([docs](https://docs.tembo.io/learn/implement-from-issues)).
- **Epiq**: MIT, git-backed append-only event logs, TUI plus browser GUI, `epiq-mcp` with named
  agent identities, no server or auth ([repo](https://github.com/ljtn/epiq)).
- **Backlog.md**: MIT, markdown files in the repo, optional MCP ([repo](https://github.com/MrLesk/Backlog.md)).
- **git-issues** (MIT, `next`/`claim`/`done` commands, [pkg.go.dev](https://pkg.go.dev/github.com/steviee/git-issues)),
  **Beads** (git-backed, dependency "ready" queue, [docs](https://www.mintlify.com/steveyegge/beads/introduction), snippet),
  **Lific** (SQLite, MCP-native, [docs.rs](https://docs.rs/crate/lific/2.0.0)).
- **Vibe Kanban**: the company announced a shutdown on 2026-04-10 and hosted data was removed after
  30 days, with community maintenance after ([notice](https://vibekanban.com/shutdown)).
  A reminder that a tool run by one vendor can disappear.
- "Agentra", named in docketry's own plan, did not turn up in any search; treat the plan's mention
  as unverified.

## What users expect from a Linear-class tracker

From the sources I could confirm: an inbox for intake with accept, decline, duplicate and snooze
([Linear triage](https://linear.app/docs/triage)); a keyboard command palette with fast search
across objects and optimistic UI that makes clicks instant (third-party write-ups, so soft evidence:
[1](https://www.techinterview.org/companies/linear/),
[2](https://www.techinterview.org/post/3233475370/frontend-system-design-build-linear-project-management/)).
Cycles are a webhook resource in Linear ([webhooks](https://linear.app/developers/webhooks)). I could
not verify Linear's shortcut list (the page returned 404), so docketry's own `g`+letter and `j/k` set
is a design choice, not a copy.

## What is unique here

Inference from the comparison above, not a sourced claim:

1. **Self-hosted, MIT, and a multi-user dense web UI together.** Linear, Jira, GitHub and Hiveship are
   hosted. Plane and Huly are copyleft. The git-native tools (Epiq, Backlog.md, git-issues, Beads)
   are single-player or sync through git and have no server-side webhooks or review queue.
2. **Harness-agnostic dispatch.** `claude-code`, `codex`, `opencode`, `local` and arbitrary `webhook`
   harnesses sit behind one adapter contract. GitHub and Jira dispatch to their own agents;
   Tembo dispatches but does not track.
3. **Human and agent through the same state machine and the same event log**, with a review queue
   as the completion path (`plans/2026-10-08-1647-feat-docketry-plan.md`, R17).
4. **Reach**: GitHub App, Slack, n8n, Composio, MCP, CLI and signed webhooks in one repo.

Risks the landscape shows: Linear's agent API is the reference people will compare against and has
a session protocol docketry lacks; Hiveship occupies the hosted version of the same idea; and the
git-native tools win on zero-ops simplicity.
