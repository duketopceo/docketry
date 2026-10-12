# Changelog

All notable changes to Tallyline (formerly docketry). Format loosely follows
[Keep a Changelog](https://keepachangelog.com); this project is pre-1.x
semver until stated otherwise.

## [Unreleased] — go-live security hardening

### Changed (breaking — authorization fixes from the permission matrix)

- **Agent keys can no longer approve or send back review items** (PLAN-056):
  `POST /issues/:key/review` and `PATCH` state `in_review → done|in_progress`
  return `403 FORBIDDEN_AGENT` for agent credentials. Agents can still move
  work into `in_review`. `tallyline done` with an agent key now stops at
  `in_review`.
- **Webhook endpoints are owner/admin only**: create, update, delete, list and
  delivery log return `403 FORBIDDEN_ROLE` to members and agent keys.
- **`GET /v1/workspaces/:ws/github/setup` is replaced by
  `POST /v1/workspaces/:ws/github/setup`** with body `{"installationId": n}`,
  owner/admin only. GitHub's Setup URL must be a web page that POSTs it.

### Changed (defaults — review before upgrading an internet-facing install)

- **`AUTH_AUTO_JOIN_SINGLE_WORKSPACE` now defaults to off** (was on). Set `1`
  to keep the old open-membership behaviour.
- **`POST /v1/workspaces` is instance-admin only** unless
  `TALLYLINE_ALLOW_WORKSPACE_CREATE=1` (403 `FORBIDDEN_INSTANCE_ADMIN`).
- **Production refuses weak secrets**: with `NODE_ENV=production` the API
  will not start if `JWT_SECRET` is unset/empty/<32 chars/a known default, or
  if `AUTH_SECRET_KEY` (when set) is weak or equals `JWT_SECRET`.
- **Webhook and agent-dispatch URLs are SSRF-guarded** (private, loopback,
  link-local, CGNAT, ULA, metadata addresses rejected at save and at
  delivery; redirects not followed). Existing endpoints pointing at LAN hosts
  need `TALLYLINE_WEBHOOK_ALLOW_PRIVATE=1`.
- **Rate limiting counts anonymous traffic** per client IP
  (`RATE_LIMIT_ANON_PER_MIN`, default 120; `RATE_LIMIT_AUTH_PER_MIN`, default
  30 for login/bootstrap/invite/OAuth). Behind a proxy set `TRUSTED_PROXY=1`
  so the real client IP is read from `CF-Connecting-IP` / last
  `X-Forwarded-For` hop.

### Added

- **Remote MCP endpoint with OAuth 2.1** (PLAN-010/011): `POST /mcp`
  (Streamable HTTP) on the API host, Tallyline as its own authorization
  server (RFC 9728/8414, CIMD + DCR, PKCE S256, resource-bound tokens, rotating
  refresh tokens), a minimal consent page in the web app, and grant
  list/revoke endpoints. See `docs/mcp.md`.

- Security headers on web and API: CSP (nonce + `strict-dynamic` on the web
  app, `default-src 'none'` on the API), `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, HSTS on https requests; `x-powered-by`
  removed. The web root layout is now dynamically rendered (needed for nonces).
- `ops/backup.sh` / `ops/restore.sh`: encrypted (age) offsite Postgres backups
  to S3-compatible storage, with a documented, tested restore procedure
  (see docs/deploy.md).
- `RateStore` seam in the API rate limiter (in-memory default) for a future
  shared store.

## [Unreleased] — renamed: docketry → Tallyline

The project is now **Tallyline**. Existing local instances keep working;
nothing below requires a database migration or re-issuing credentials.

### Migration notes

- **Packages and binaries** — `@docketry/*` → `@tallyline/*`; `docketry` →
  `tallyline`; `docketry-mcp` → `tallyline-mcp`; short alias `dok` → `tly`.
  `dok` remains as a deprecated bin that prints a one-line notice on stderr
  and then runs `tly`. Update agent/MCP configs to the new names.
- **Environment variables** — `DOCKETRY_*` → `TALLYLINE_*`. The old names
  are still read as a fallback when the new one is unset or empty (one
  helper, `readEnv` in `@tallyline/types`; the compose files forward the
  old names the same way). The new name always wins. The fallback will be
  removed in a future release.
- **Token prefixes** — newly issued agent keys, PATs, webhook secrets
  (n8n) and invites use `tly_agt_` / `tly_pat_` / `tly_wh_` / `tly_inv_`.
  Existing `dok_agt_*` and `dok_pat_*` credentials keep working
  (validation is hash-based and accepts both prefixes); no need to rotate.
- **HTTP headers** — outbound webhooks now send
  `X-Tallyline-Signature`, `-Event`, `-Delivery`; passthrough MCP uses
  `x-tallyline-workspace` / `x-tallyline-api-url`. Inbound handling
  (MCP passthrough, the n8n trigger) accepts both the new names and the old
  `X-Docketry-*` ones. Consumers verifying webhook signatures should read
  `X-Tallyline-Signature` (old header is no longer sent).
- **CLI config files** — `.tallyline.json`, `.tallyline/config.json` and
  `~/.config/tallyline/config.json` are the new locations; the old
  `docketry` paths are still read at lower precedence. `tallyline init` and
  `tallyline work` write `.tallyline/` going forward.
- **n8n / Composio** — node and credential types are now `Tallyline*`,
  Composio tool slugs `TALLYLINE_*`; workflows using the old node types need
  to be re-pointed.
- **Deliberately unchanged** — Postgres database/user (`docketry`/`postgres`)
  and the `docketry-postgres` / `docketry-redis` volume names, session
  cookie names (`dok_session`, `dok_ws`, …), the default dev `JWT_SECRET`,
  and the GitHub repository URL. Changing them would orphan existing data or
  sign everyone out; they are follow-ups.

### Brand

- New mark and lockup in `assets/brand/` (four tally strokes struck by an
  azure line, with a dedicated 16px variant); the old docketry card logo
  is removed.

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

[1.0.0]: https://github.com/duketopceo/tallyline/releases/tag/v1.0.0
