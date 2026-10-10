# Self-hosting docketry

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
| `POSTGRES_USER` / `POSTGRES_DB` | no | `postgres` / `docketry` | Credentials/db name |
| `JWT_SECRET` | **yes** | — | Signs short-lived access JWTs — `openssl rand -hex 32` |
| `API_BASE_URL` | no | `http://localhost:4000` | Public API origin — used in the GitHub App manifest + Slack/CLI callbacks. Set to your real hostname when fronting with a tunnel |
| `API_PORT` | no | `4000` | Port the API binds *inside* its container — only change together with the compose `environment`/`API_INTERNAL_URL` |
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:4000` | Fallback API origin baked into the web build; server-side bridges prefer `API_INTERNAL_URL` |
| `API_INTERNAL_URL` | no | `http://api:4000` (in compose) | Where the web service's bridge routes reach the API — service-name URL inside the compose network; set it in `.env` only for exotic topologies |
| `API_PUBLISH_PORT` / `WEB_PUBLISH_PORT` | no | `4000` / `3100` | Host ports the services bind |
| `RATE_LIMIT_PER_MIN` | no | `600` | Requests/minute per token or IP (`0` disables — don't, on public instances) |
| `DATABASE_URL` / `REDIS_URL` | no | compose-internal | Override only for external datastores |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | no | — | GitHub App sync — see [github-sync.md](./github-sync.md); all empty = feature off |
| `SLACK_*` | no | — | Slack intake/mirroring — see [slack.md](./slack.md); empty tokens = off |
| `DOCKETRY_LLM_*` | no | — | LLM assist (OpenRouter or any OpenAI-compatible endpoint) — see [llm-assist.md](./llm-assist.md); empty key = off |
| `COMPOSIO_API_KEY`, `LINEAR_API_KEY` | no | — | Optional integration credentials |
| `AUTH_SECRET` | — | — | **removed** — legacy var older `.env` files may still carry; nothing reads it. `JWT_SECRET` is the live secret |

**MCP endpoint (optional `--profile mcp` service):**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `MCP_PUBLISH_PORT` | no | `3101` | Host port for the hosted-MCP endpoint |
| `DOCKETRY_MCP_API_URL` | no | `http://api:4000` | API the MCP server proxies to (service-internal; named distinctly so a caller-facing `DOCKETRY_API_URL` can't misroute it) |
| `DOCKETRY_TOKEN` / `DOCKETRY_WORKSPACE` | no | — | Set both → single-tenant mode; neither → per-request header passthrough (see [klavis.md](./klavis.md)) |
| `DOCKETRY_ALLOW_API_URL_OVERRIDE` | no | off | `1` honors `x-docketry-api-url` per request — needed for a multi-deployment hosted endpoint; SSRF surface, enable deliberately |

## Cloudflare Tunnel — public access, zero open ports

The free path to put a homelab instance on a real hostname without
exposing anything inbound:

```bash
# on the host running the stack
cloudflared tunnel login
cloudflared tunnel create docketry
cloudflared tunnel route dns docketry docketry.example.com
```

`~/.cloudflared/<tunnel-id>.json` + this `config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  # web on the apex, api on /api/* OR a subdomain — pick one pattern
  - hostname: docketry.example.com
    service: http://localhost:3100
  - hostname: api.docketry.example.com
    service: http://localhost:4000
  - service: http_status:404
```

```bash
cloudflared tunnel run docketry
# or install as a service: cloudflared service install
```

Then set `API_BASE_URL=https://api.docketry.example.com` +
`NEXT_PUBLIC_API_URL=https://api.docketry.example.com` (rebuild the web
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

## Backup & restore

Everything durable lives in the `docketry-postgres` volume (redis is
ephemeral queue state — safe to lose).

```bash
# backup — consistent dump while the stack runs
docker compose -f docker-compose.selfhost.yml exec postgres \
  pg_dump -U postgres -Fc docketry > backup-$(date +%F).dump

# restore — stop api/web, recreate the db, replay
# (two separate -c calls: DROP DATABASE refuses to run inside the
# implicit transaction a multi-statement -c creates)
docker compose -f docker-compose.selfhost.yml stop api web
docker compose -f docker-compose.selfhost.yml exec postgres \
  psql -U postgres -c "DROP DATABASE docketry;"
docker compose -f docker-compose.selfhost.yml exec postgres \
  psql -U postgres -c "CREATE DATABASE docketry;"
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
- Behind TLS before inviting anyone — cookies go `Secure` automatically.
- Webhook secrets set per provider (GitHub/Slack verify HMACs — see
  [security-review.md](./security-review.md)).
