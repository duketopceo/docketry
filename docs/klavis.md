# Klavis Strata — catalog listing

Goal: agents discover tallyline next to GitHub/Linear in the Strata catalog
and execute tools end-to-end. Two routes — the self-hosted one works today,
the native-catalog one is a submission to Klavis.

## 1. Hosted endpoint (what Klavis connects to)

`apps/mcp-server --http` is a stateless Streamable HTTP server at `POST /mcp`.
Two credential modes:

| Mode | When | Credentials |
|---|---|---|
| env | `TALLYLINE_TOKEN` + `TALLYLINE_WORKSPACE` set | all requests share them — single-tenant self-host |
| **passthrough** | neither set | **per-request headers** — the hosted/multi-tenant shape |

Passthrough request headers:

- `Authorization: Bearer <tly_agt_*>` — the caller's agent key (or PAT/JWT)
- `x-tallyline-workspace: <slug>` — their workspace
- `x-tallyline-api-url: <url>` — only honored when the endpoint sets
  `TALLYLINE_ALLOW_API_URL_OVERRIDE=1`. Off by default: forwarding
  caller-chosen URLs server-side is an SSRF surface. When enabled,
  literal loopback/link-local/cloud-metadata hosts are refused (RFC1918
  stays allowed — pointing at a LAN self-host API is the legitimate use);
  DNS names resolving there are residual risk — constrain egress on
  public deployments.

Each request builds a fresh client + MCP server (no session state), so any
number of workspaces/tenants share one process and any replica serves any
request.

### Run it

```bash
# docker — part of the self-host stack, behind the `mcp` profile:
docker compose -f docker-compose.selfhost.yml --profile mcp up -d
# → POST http://localhost:3101/mcp  (proxies to api:4000 inside the stack)

# or bare (from the repo root, after pnpm --filter @tallyline/mcp-server build):
TALLYLINE_API_URL=https://api.example.com \
  node apps/mcp-server/dist/index.js --http=3101
```

Verified end-to-end in the self-host stack: `whoami` returns the caller's
agent identity and `create_issue` lands in their workspace — see
`apps/mcp-server/src/env.test.ts` for the header-contract tests.

## 2. Path A — Strata `externalServers` (works today)

A self-hoster adds their own endpoint to their Strata instance; no Klavis
involvement needed:

```bash
curl -X POST https://api.klavis.ai/mcp-server/strata/create \
  -H "Authorization: Bearer $KLAVIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "servers": [],
    "externalServers": [{
      "name": "tallyline",
      "url": "https://mcp.tallyline.example.com/mcp",
      "headers": {
        "Authorization": "Bearer tly_agt_...",
        "x-tallyline-workspace": "acme"
      }
    }]
  }'
```

Klavis forwards the header map verbatim per user — that is the passthrough
contract above. Each user supplies their own agent key + workspace slug.

## 3. Path B — native catalog entry (submission)

Native listings live in `Klavis-AI/klavis` under `mcp_servers/` — community
servers land via PR (see their `CONTRIBUTING.md` + `MCP_SERVER_GUIDE.md`).
Our submission needs:

- `mcp_servers/tallyline/` — a thin wrapper or pointer to our published
  image + a README describing tools and auth.
- Auth model: API-key-style (`api_key` authData → `Authorization` header)
  plus a `workspace` field → `x-tallyline-workspace`, and (for self-hosted
  deployments) an optional `api_url` field → `x-tallyline-api-url`. Whether
  Klavis's authData can carry the extra fields decides if the native entry
  covers self-hosters or only a managed cloud deployment — confirm with
  them before scoping.
- A publicly reachable endpoint. Strata-hosted images run on Klavis infra;
  our server proxies to `TALLYLINE_API_URL`, which for self-hosters is
  *their* API — a Klavis-hosted catalog entry therefore needs
  `x-tallyline-api-url` support, i.e. the endpoint must run with
  `TALLYLINE_ALLOW_API_URL_OVERRIDE=1`. That is the main design point to
  settle in the submission.

## Keeping the entry current

- Bump `SERVER_INFO.version` in `apps/mcp-server/src/server.ts` per release.
- The tool surface (`tools.ts`) is the contract Klavis users see — tool
  additions/renames should ride with changelog notes in the PR body so the
  catalog description stays accurate.
- Re-verify after each release: `whoami` + `list_issues` + `create_issue`
  through `POST /mcp` with header creds against a staging deploy.
