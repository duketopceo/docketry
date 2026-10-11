# Security review — v1.0 gate (#37)

Checklist from `luke-agents/SECURITY_GUIDELINES.md`, walked 2026-10-09
against `main` @ `4ddc13f` (+ this PR's changes). Scope: tallyline API, web
app, MCP server, CLI, and all webhook/integration surfaces.

**Re-walked 2026-10-11** for the OAuth/org-identity release (global users,
workspace memberships, provider sign-in, invites, credential-class gates)
— updated sections marked *re-walk*; the rest stands as reviewed.

## Secrets & credentials — PASS *(re-walk)*

- No secrets in the repo; `.env` / `.env.local` gitignored; `.env.example`
  carries empty placeholders only.
- GitGuardian + Socket Security run on every PR.
- Agent keys (`tly_agt_*`), PATs (`tly_pat_*`), sessions, invite tokens,
  and webhook secrets are all stored hashed (`sha256`) or held in env —
  never logged. Invite tokens are single-use, email-bindable, 7-day
  default expiry.
- OAuth provider `client_secret`s stored via the providers UI are
  AES-256-GCM-encrypted under `AUTH_SECRET_KEY` and masked on read; env
  providers keep secrets in env only. Key rotation semantics documented
  in [auth.md](./auth.md) — rotation strands stored secrets (no
  key-versioned envelope in v1).
- One-time OAuth exchange codes are sha256-hashed at rest, purpose-
  scoped TTLs (60s login / 10min pending flows), claimed atomically.
- GitHub App private key arrives via env (multi-line PEM normalized in
  `env.ts`); Slack/LLM/Composio tokens are env-only; empty = feature off.

## AuthN / authZ — PASS *(re-walk)*

- Every `/v1/*` data route resolves identity through `requireWorkspace`
  — session cookie, `tly_agt_` key, `tly_pat_`, or access JWT. Default
  deny: no identity → 401; scoped credentials bound to a different
  workspace → 403. Cookie sessions **roam** — every request re-checks
  membership in the path workspace, so removal kills access instantly;
  a request to a workspace the user isn't a member of gets 403
  (slug-existence oracle accepted — see Deviations).
- Webhooks are unauthenticated by design and verified by signature instead
  (below).
- **Credential minting gates** (`requireRole` + credential-class checks):
  agent/key/token/invite/provider creation is cookie-session + role only;
  PATs, JWTs, and agent keys cannot mint agents, keys, invites, or
  workspaces, nor manage members/providers — the matrix is regression-
  tested in `workspaces.test.ts` + `admin.test.ts`.
- **Role transitions:** `owner` grants and edits to owner rows are
  owner-only; last-owner removal is blocked.
- **`x-actor-*` provenance headers** are accepted only under agent-key
  auth and can only name the authenticating agent — forgery → 422.
- Agent keys carry `read`/`write` scopes; write-gated mutations check
  scope; roster read (`/members`, MCP `list_members`) is the only
  people-data an agent sees.
- Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production,
  sha256-hashed at rest, revoked on logout.
- Access JWT: 15-minute TTL (`ACCESS_TOKEN_TTL_S`), exchanged from session.

### OAuth hardening *(new)*

- `state`/`nonce`/PKCE-S256 in HttpOnly `SameSite=Lax` cookies, 10-min
  TTL; `return_to` same-origin-relative only (else `/`); `invite` rides
  the state cookie, never the authorize URL.
- One-time codes are purpose-scoped and atomically claimed; the web
  exchange binds `dok_login_nonce` (login-CSRF).
- Identity resolution is subject-keyed; verified-email matching is
  governed by `AUTH_ACCOUNT_LINKING`; `login` mode's pending-link proof
  never mints a session itself. IdPs without `email_verified` are
  invite-only (see [auth.md](./auth.md)).
- `POST /v1/auth/providers/:id/test` + generic-OIDC discovery are SSRF
  dials: instance-admin-only, https-only, private/link-local/metadata
  IPs blocked, TLS verification never disabled.
- `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` now defaults **off** (go-live hardening);
  opt in with `1` for private installs.

### `/v1/auth/*` boundary *(new)*

`authRoutes`/`oauthRoutes`/invite/provider routers mount before
`requireSession` and the global limiter — every route under the prefix
self-resolves credentials and carries an **in-router auth limiter**
(`authLimiter`, proxy-aware via `TRUSTED_PROXY`). This is convention,
not middleware: any future `/v1/auth/*` route must mount the limiter
itself — new routes under the prefix are a review checklist item.

### Invite token model *(new)*

Opaque 32-byte tokens, sha256 at rest, single-use atomic claims, 7-day
default expiry; optional email binding enforced on every claim path
(session, OAuth-hit, JIT, password-claim); `owner` never issuable;
open links are token-only authorization. New-user claim with no
provider = `{name,password}` at `accept-invite` — the only unauth
account-creation surface when providers are off.

## Multi-tenancy — PASS (app-level scoping) *(re-walk)*

- No Postgres RLS — isolation is enforced at the service layer: every query
  is filtered by `workspaceId` resolved from the authenticated identity,
  and `requireWorkspace` now also asserts the credential's membership in
  that workspace per request (users are global; `workspace_members` is
  the boundary). Accepted deviation; compensating controls are the
  tenant-boundary tests (cross-workspace project/cycle validation → 422,
  foreign-workspace reads → 404/403) in `projects.test.ts`,
  `cycles.test.ts`, `api.test.ts`, and the credential-class matrix in
  `workspaces.test.ts`.
- Migration `0019` merges duplicate workspace-scoped users under
  `lower(btrim(email))` with a `user_id_map` snapshot + re-point of all
  FK'd and actor columns before loser rows delete — rehearsed on
  populated data; deploy doc carries the `pg_dump` gate.
- Prior audit caught and fixed `findWorkspace` (slug-only) on
  workspace-scoped routes → all scoped routes use `requireWorkspace`.

## Input validation — PASS

- Zod validators on every route boundary; Drizzle parameterizes all SQL
  (no string-concatenated queries; `sql` tags are parameterized).
- Output escaped by React; issue bodies are plain text, never `innerHTML`.

## API security — PASS (with one note) *(re-walk)*

- Rate limiting per identity (agent key / user+session / IP fallback) at
  600/min default, applied globally in `index.ts`; `/v1/auth/*` routes
  bypass it by design and carry an in-router limiter — `TRUSTED_PROXY=1`
  is required for correct client IPs behind a proxy (spoofable if set
  without one — documented).
- Error handling: generic `500 INTERNAL` to clients; internals logged via
  `console.error` only — no stack traces, SQL, or paths returned.
- The API emits **no per-request access log** — `GET /v1/auth/oauth/*`
  carries bearer credentials (`code`, `invite`, `login_nonce`) in the
  query string, so any proxy/ingress access log must redact those params;
  it's a deploy-hardening line.
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
duplicate issue. `handleReactionAdded` skips threads that already have a
`slack_links` row, and the claim is atomic: `slack_links` carries a
`UNIQUE(channel, thread_ts)` constraint (migration `0017`), so a
concurrent delivery that races past the existence check loses the insert,
its duplicate issue is deleted, and no confirmation is posted. Covered by
sequential-retry and concurrent-delivery regression tests.

## Data protection / logging — PASS

- `console.error` call sites reviewed: log message + error object only —
  no tokens, keys, or request bodies.
- PII surface is minimal (user name + email); nothing is logged.

## Dependencies — PASS

- All versions pinned in `package.json` / lockfile; Socket Security
  project report + PR alerts in CI.

## Deviations *(updated)*

- App-level tenant isolation instead of RLS (compensating tests above).
- No CORS middleware (same-origin + bearer clients only).
- **Workspace-slug oracle:** 403 vs 404 distinguishes workspace existence
  for authenticated non-members. Accepted — slugs aren't secrets, and
  equalizing the responses leaks more (timing/enumeration via valid-slug
  behavior) than it prevents.
- **Roaming cookie sessions** widen a stolen session's blast radius to
  every workspace the user belongs to (weighed vs bound-session UX —
  Linear parity; per-request membership checks keep removal instant).
- **`POST /v1/workspaces` is cookie-open** — any member can spawn a
  workspace and own it; deliberate self-host posture, a gate env is a
  coherent follow-up for shared installs.
- **`AUTH_AUTO_JOIN_SINGLE_WORKSPACE`** — was default-on; now default-off.
  Workspace creation is likewise admin-only unless
  `TALLYLINE_ALLOW_WORKSPACE_CREATE=1`.

## Verdict

**Security review PASSED** — one medium finding (Slack intake idempotency)
fixed in this PR with a regression test. Re-walk for the identity release
found no gate-blocking issues; deviations documented above: app-level
tenant isolation instead of RLS, no CORS middleware, slug oracle, roaming
sessions, open workspace creation, auto-join default.
