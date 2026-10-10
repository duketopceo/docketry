# Security review — v1.0 gate (#37)

Checklist from `luke-agents/SECURITY_GUIDELINES.md`, walked 2026-10-09
against `main` @ `4ddc13f` (+ this PR's changes). Scope: docketry API, web
app, MCP server, CLI, and all webhook/integration surfaces.

## Secrets & credentials — PASS

- No secrets in the repo; `.env` / `.env.local` gitignored; `.env.example`
  carries empty placeholders only.
- GitGuardian + Socket Security run on every PR.
- Agent keys (`dok_agt_*`), PATs (`dok_pat_*`), sessions, and webhook
  secrets are all stored hashed (`sha256`) or held in env — never logged.
- GitHub App private key arrives via env (multi-line PEM normalized in
  `env.ts`); Slack/LLM/Composio tokens are env-only; empty = feature off.

## AuthN / authZ — PASS

- Every `/v1/*` data route resolves identity through `requireWorkspace`
  (80 call sites) — session cookie, `dok_agt_` key, `dok_pat_`, or access
  JWT. Default deny: no identity → 401, wrong workspace → 404.
- Webhooks are unauthenticated by design and verified by signature instead
  (below).
- Agent keys carry `read`/`write` scopes; write-gated mutations check scope.
- Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production,
  sha256-hashed at rest, revoked on logout.
- Access JWT: 15-minute TTL (`ACCESS_TOKEN_TTL_S`), exchanged from session.

## Multi-tenancy — PASS (app-level scoping)

- No Postgres RLS — isolation is enforced at the service layer: every query
  is filtered by `workspaceId` resolved from the authenticated identity.
  Accepted deviation; compensating controls are the tenant-boundary tests
  (cross-workspace project/cycle validation → 422, foreign-workspace reads
  → 404) in `projects.test.ts`, `cycles.test.ts`, `api.test.ts`.
- Prior audit caught and fixed `findWorkspace` (slug-only) on
  workspace-scoped routes → all scoped routes use `requireWorkspace`.

## Input validation — PASS

- Zod validators on every route boundary; Drizzle parameterizes all SQL
  (no string-concatenated queries; `sql` tags are parameterized).
- Output escaped by React; issue bodies are plain text, never `innerHTML`.

## API security — PASS (with one note)

- Rate limiting per identity (agent key / user+session / IP fallback) at
  600/min default, applied globally in `index.ts`.
- Error handling: generic `500 INTERNAL` to clients; internals logged via
  `console.error` only — no stack traces, SQL, or paths returned.
- Note: no CORS middleware — API is consumed by same-origin SSR + bearer
  clients, so no `Access-Control-Allow-Origin` is emitted. If browser
  cross-origin embedding is added later, it needs an explicit whitelist.

## Third-party integrations — PASS

- GitHub: `X-Hub-Signature-256` verified with `timingSafeEqual`;
  deliveries deduped by unique `delivery_id`.
- Slack: `v0=` HMAC + timestamp window verified with `timingSafeEqual`.
- Outbound webhooks (incl. dispatch delivery) are HMAC-signed, retried
  with backoff, and land in a durable delivery table.

**Finding fixed in this PR:** Slack `reaction_added` was not idempotent —
a retried event (or a second user reacting to the same message) created a
duplicate issue. `handleReactionAdded` now skips threads that already have
a `slack_links` row; regression test added.

## Data protection / logging — PASS

- `console.error` call sites reviewed: log message + error object only —
  no tokens, keys, or request bodies.
- PII surface is minimal (user name + email); nothing is logged.

## Dependencies — PASS

- All versions pinned in `package.json` / lockfile; Socket Security
  project report + PR alerts in CI.

## Verdict

**Security review PASSED** — one medium finding (Slack intake idempotency)
fixed in this PR with a regression test. Deviations documented above:
app-level tenant isolation instead of RLS, no CORS middleware.
