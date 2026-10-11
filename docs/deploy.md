# Self-hosting tallyline

Three paths, fastest first. All of them land on the same thing: the web
app on port `3100`, the API on `4000`, postgres + redis on an internal
network. Open `http://localhost:3100` — the first-run **/bootstrap** page
creates your workspace, team, and admin user, then you're on the board.

## Quickstart — Docker Compose (target: < 10 min)

```bash
git clone https://github.com/duketopceo/docketry.git && cd docketry

# required: a db password and a JWT secret
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF

docker compose -f docker-compose.selfhost.yml up -d
# first build ~4-6 min on a warm connection; then:
# → http://localhost:3100  → bootstrap → board
```

That's it — `docker-compose.selfhost.yml` builds `apps/api` and `apps/web`
from source, runs Drizzle migrations on API boot, and waits for healthy
postgres/redis before starting the app. Only `web:3100` and `api:4000` are
published; the datastores stay internal. Override published ports with
`WEB_PUBLISH_PORT` / `API_PUBLISH_PORT`.

The dev `docker-compose.yml` (postgres+redis only, host-mapped ports) is
unchanged — contributors keep using `docker compose up -d` + `pnpm dev`.

## Environment reference

Set these in `.env` next to the compose file (it reads `.env` automatically):

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_PASSWORD` | **yes** | — | Password for the internal postgres |
| `POSTGRES_USER` / `POSTGRES_DB` | no | `postgres` / `tallyline` | Credentials/db name |
| `JWT_SECRET` | **yes** | — | Signs short-lived access JWTs — `openssl rand -hex 32` |
| `API_BASE_URL` | no | `http://localhost:4000` | Public API origin — used in the GitHub App manifest + Slack/CLI callbacks. Set to your real hostname when fronting with a tunnel |
| `API_PORT` | no | `4000` | Port the API binds *inside* its container — only change together with the compose `environment`/`API_INTERNAL_URL` |
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:4000` | Fallback API origin baked into the web build; server-side bridges prefer `API_INTERNAL_URL` |
| `API_INTERNAL_URL` | no | `http://api:4000` (in compose) | Where the web service's bridge routes reach the API — service-name URL inside the compose network; set it in `.env` only for exotic topologies |
| `API_PUBLISH_PORT` / `WEB_PUBLISH_PORT` | no | `4000` / `3100` | Host ports the services bind |
| `RATE_LIMIT_PER_MIN` | no | `600` | Requests/minute per token or IP (`0` disables — don't, on public instances) |
| `DATABASE_URL` / `REDIS_URL` | no | compose-internal | Override only for external datastores |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | no | — | GitHub App sync — see [github-sync.md](./github-sync.md); all empty = feature off |
| `WEB_URL` | no | `http://localhost:3100` | Public web origin — OAuth callbacks bounce here after exchange; set to your real web hostname behind a tunnel |
| `AUTH_SECRET_KEY` | for DB providers | — | AES-256-GCM key (`openssl rand -base64 32`) encrypting provider secrets stored via the UI. Losing/rotating strands them — see [auth.md](./auth.md) |
| `AUTH_ADMIN_EMAILS` | no | bootstrap owner | Comma-separated instance admins (provider CRUD). Unset → the bootstrap workspace owner is the fallback admin |
| `AUTH_DISABLE_PASSWORD` | no | off | `1` = SSO-only — hides password login, `PASSWORD_DISABLED` on mint routes |
| `AUTH_ACCOUNT_LINKING` | no | `auto` | `auto`/`login`/`disabled` — verified-email match links silently, requires proof, or never links |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | no | any | Comma-separated JIT allowlist; invites bypass it |
| `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` | no | **on** | New OAuth users auto-join when the instance has one workspace. **Set `0` on internet-facing installs — default-on is open membership** |
| `TRUSTED_PROXY` | no | off | `1` honors `x-forwarded-for` in rate limits/logs — only behind a real reverse proxy |
| `GITHUB_CLIENT_ID`/`_SECRET` | no | — | "Sign in with GitHub" — the App's OAuth credentials double as the provider's (see [auth.md](./auth.md)) |
| `GOOGLE_CLIENT_ID`/`_SECRET` | no | — | "Sign in with Google" — callback `{API_BASE_URL}/v1/auth/oauth/google/callback` |
| `OIDC_ISSUER`/`_CLIENT_ID`/`_CLIENT_SECRET`/`_DISPLAY_NAME`/`_SCOPES` | no | — | Generic OIDC via discovery — `{issuer}/.well-known/openid-configuration` |
| `SLACK_*` | no | — | Slack intake/mirroring — see [slack.md](./slack.md); empty tokens = off |
| `TALLYLINE_LLM_*` | no | — | LLM assist (OpenRouter or any OpenAI-compatible endpoint) — see [llm-assist.md](./llm-assist.md); empty key = off |
| `COMPOSIO_API_KEY`, `LINEAR_API_KEY` | no | — | Optional integration credentials |
| `AUTH_SECRET` | — | — | **removed** — legacy var older `.env` files may still carry; nothing reads it. `JWT_SECRET` is the live secret |

**MCP endpoint (optional `--profile mcp` service):**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `MCP_PUBLISH_PORT` | no | `3101` | Host port for the hosted-MCP endpoint |
| `TALLYLINE_MCP_API_URL` | no | `http://api:4000` | API the MCP server proxies to (service-internal; named distinctly so a caller-facing `TALLYLINE_API_URL` can't misroute it) |
| `TALLYLINE_TOKEN` / `TALLYLINE_WORKSPACE` | no | — | Set both → single-tenant mode; neither → per-request header passthrough (see [klavis.md](./klavis.md)) |
| `TALLYLINE_ALLOW_API_URL_OVERRIDE` | no | off | `1` honors `x-tallyline-api-url` per request — needed for a multi-deployment hosted endpoint; SSRF surface, enable deliberately |

## Cloudflare Tunnel — public access, zero open ports

The free path to put a homelab instance on a real hostname without
exposing anything inbound:

```bash
# on the host running the stack
cloudflared tunnel login
cloudflared tunnel create tallyline
cloudflared tunnel route dns tallyline tallyline.example.com
```

`~/.cloudflared/<tunnel-id>.json` + this `config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  # web on the apex, api on /api/* OR a subdomain — pick one pattern
  - hostname: tallyline.example.com
    service: http://localhost:3100
  - hostname: api.tallyline.example.com
    service: http://localhost:4000
  - service: http_status:404
```

```bash
cloudflared tunnel run tallyline
# or install as a service: cloudflared service install
```

Then set `API_BASE_URL=https://api.tallyline.example.com` +
`NEXT_PUBLIC_API_URL=https://api.tallyline.example.com` (rebuild the web
image — the var is build-time), restart. Webhooks (GitHub/Slack) then
reach the API through the tunnel; their signature checks are unchanged.
Cookie `Secure` engages automatically via `NODE_ENV=production` + HTTPS.

## Railway — managed path

A Railway project maps cleanly onto the four services:

1. **Postgres** — Railway's postgres plugin.
2. **Redis** — Railway's redis plugin.
3. **API** — deploy from repo, root `apps/api/Dockerfile`; env
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   `REDIS_URL=${{Redis.REDIS_URL}}`, `JWT_SECRET`, `API_BASE_URL` =
   the service's public domain. Migrations run on boot — no release step needed.
4. **Web** — deploy `apps/web/Dockerfile` with build arg
   `NEXT_PUBLIC_API_URL` = the API domain and env
   `API_INTERNAL_URL` = the API's *internal* Railway domain
   (`http://api.railway.internal:4000`).

A `railway.json`/template button lands when the Dockerfile paths stabilize;
until then the four-service manual setup is the documented route (~10 min).

## Upgrading

```bash
git pull
docker compose -f docker-compose.selfhost.yml up -d --build
```

Migrations apply automatically on API boot (forward-only — read the release
notes before jumping versions). No manual migration step exists today.

### Upgrading to the OAuth/org-identity release (migrations `0018`–`0019`)

`0019` is the **point of no return** — it dedupes workspace-scoped users
into global identities and drops `users.workspace_id`. Rows it merges are
snapshotted in `user_id_map` and every FK'd + actor column is re-pointed
before the losers delete, but that is data surgery, not a rollback path.

1. **Dump first.** `pg_dump` per [Backup](#backup--restore) — restoring
   that dump is the only rollback for this release.
2. **Single-instance window.** Stop every running API/web replica before
   upgrading: old code selects `users.workspace_id` against a dropped
   column, so a mixed fleet isn't degraded — it's dead. Migrations run
   under a `pg_advisory_lock` on API boot, so the first replica up
   migrates and the rest wait.
3. **Journal-drift reconcile** — only for installs that ever applied a
   retagged/edited migration: if boot fails with a migration-hash or
   "already applied" error, compare `drizzle.__drizzle_migrations.hash`
   against the shipped files under `apps/api/drizzle/`; a row whose hash
   doesn't match its file was applied from a different build — fix by
   restoring the dump and re-upgrading from a clean tree.
4. **Post-check.** Sign in once per auth method, and if you carried
   `.env` over: `AUTH_SECRET` is gone (dead var, nothing read it);
   `AUTH_SECRET_KEY` is the new provider-secret key.

## Backup & restore

Everything durable lives in the `docketry-postgres` volume (redis is
ephemeral queue state — safe to lose).

```bash
# backup — consistent dump while the stack runs
docker compose -f docker-compose.selfhost.yml exec postgres \
  pg_dump -U postgres -Fc tallyline > backup-$(date +%F).dump

# restore — stop api/web, recreate the db, replay
# (two separate -c calls: DROP DATABASE refuses to run inside the
# implicit transaction a multi-statement -c creates)
docker compose -f docker-compose.selfhost.yml stop api web
docker compose -f docker-compose.selfhost.yml exec postgres \
  psql -U postgres -c "DROP DATABASE tallyline;"
docker compose -f docker-compose.selfhost.yml exec postgres \
  psql -U postgres -c "CREATE DATABASE tallyline;"
cat backup-YYYY-MM-DD.dump | docker compose -f docker-compose.selfhost.yml \
  exec -T postgres pg_restore -U postgres -d docketry --clean --if-exists
docker compose -f docker-compose.selfhost.yml start api web
```

For continuous backup, `pg_dump` on a cron into object storage is
sufficient — no WAL shipping needed at this scale.

## Hardening checklist

- `JWT_SECRET` is set and not the dev default.
- Postgres/redis are **not** published (the compose file never maps them).
- `RATE_LIMIT_PER_MIN` > 0 on anything internet-facing.
- `AUTH_AUTO_JOIN_SINGLE_WORKSPACE=0` on anything internet-facing —
  default-on means any OAuth-verified stranger lands in your workspace.
- `TRUSTED_PROXY` unset unless a real proxy fronts the API.
- Behind TLS before inviting anyone — cookies go `Secure` automatically.
- Proxy/ingress access logs redact `GET /v1/auth/oauth/*` query params —
  `invite`, `return_to`, `login_nonce`, and `code` are bearer
  credentials riding a URL (the API emits no per-request log itself;
  check nginx/traefik/Cloudflare log config).
- Webhook secrets set per provider (GitHub/Slack verify HMACs — see
  [security-review.md](./security-review.md)); OAuth provider setup in
  [auth.md](./auth.md).
