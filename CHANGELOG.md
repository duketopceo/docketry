# Changelog

All notable changes to docketry. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); this project is pre-1.x
semver until stated otherwise.

## [1.0.0] — 2026-10-10

First public release. docketry is a self-hostable, MIT-licensed,
agent-native issue tracker: humans and AI agents work the same board,
through the same system of record.

### Core

- Monorepo toolchain — pnpm workspaces + Turborepo, strict TypeScript
  throughout (#42)
- Issue data model — full lifecycle state machine (`triage` → `backlog` →
  `todo` → `in_progress` → `in_review` → `done`, plus `canceled`/
  `duplicate`), sub-issues, labels, projects, cycles, milestones (#43)
- Append-only event log — every mutation is an auditable event; powers
  the activity feed, insights, and webhooks (#43)
- REST API on Hono + Drizzle/Postgres with an OpenAPI spec (#44, #51)

### Web app

- App shell + dark canvas, single-workspace bootstrap (#46)
- Keyboard-first issue UX — list navigation, Cmd+K palette, quick-create,
  triage inbox, issue detail (#47)
- `?` keymap overlay + `:` command mode (`:state`, `:done`, `:assign`,
  `:comment`, `:open`) (#72)
- Kanban board with legal-move enforcement + keyboard drag (#74)
- Review queue — approve/send-back lane (#70)
- Insights — cycle time, burnup, velocity, actor throughput computed from
  the event log (#75)
- Roadmap — project milestones, start/target windows, timeline view (#79)

### Agents

- Agent identity model — `dok_agt_*` scoped keys, assignable agents,
  actor attribution on every event (#49)
- Human PATs (`dok_pat_*`) + short-lived session JWTs (#51, #52)
- MCP server — full issue/workflow tool surface on stdio and Streamable
  HTTP; hosted passthrough mode takes per-request
  `Authorization`/`x-docketry-workspace` headers for multi-tenant
  endpoints (Klavis Strata path documented) (#54, #86)
- `docketry` CLI — ready/next/claim/done/comment/create, machine-stable
  exit codes (#53)
- Dispatch pipeline — assign/@mention triggers, local CLI adapter,
  external harness delivery with signed webhooks, session timeline (#64,
  #67, #68, #69)
- Agent onboarding pack — `SKILL.md` board rules + harness setup (#57)

### Integrations

- GitHub App — webhook receiver, repo linkage, branch/PR loops,
  bidirectional issue sync (state/comments/labels, conflict events,
  loop prevention) (#62, #63, #77)
- Slack — `/docket` intake, emoji reaction capture, bidirectional thread
  mirroring, signed webhooks, atomic per-thread idempotency (#78)
- Signed outbound webhooks — endpoint CRUD, delivery log, retry sweeper
  (#65)
- Signed inbound webhook endpoints for external triggers (#69)
- Importers — GitHub issues + Linear CSV, idempotent (#66)
- n8n community node + signed webhook trigger (#83)
- Composio toolkit — `DOCKETRY_*` tools via `experimental_createTool`
  (#84)
- OpenRouter-first LLM assist — summarize, triage suggest, duplicate
  detect; opt-in and kill-switched off by default (#76)

### Self-hosting & ops

- One-command Docker Compose stack — postgres + redis (internal only) +
  api (migrations on boot) + web, board in under ten minutes (#85)
- Full deploy guide — env reference, Cloudflare Tunnel and Railway
  paths, upgrades, backup/restore, hardening (#85)
- Performance budgets enforced in CI — 10k-issue fixture, p50/p95 API
  bench, bundle gate, browser vitals, axe a11y suite (#82)
- Security review — Slack intake atomic-claim fix, webhook signature
  coverage, checklist documented (#82)

### Notes

- MIT-licensed. Self-hosting is the primary deployment path; a hosted
  SaaS is out of scope for this repo.
- Postgres 17 + Redis 7 + Node 22. Migrations are forward-only and run
  automatically on API boot.
- Agent-attribution: portions of this codebase were implemented by AI
  agents (Devin, Cursor, Codex) under human direction, per the repo's
  disclosure conventions.

[1.0.0]: https://github.com/duketopceo/docketry/releases/tag/v1.0.0
