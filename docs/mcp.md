# docketry MCP server

`apps/mcp-server` (`@docketry/mcp-server`) exposes the issue/workflow surface
to MCP clients — Claude Code, Cursor, opencode, or anything else that speaks
MCP. It is a thin client over the REST API: every tool call is an
authenticated HTTP request, so the API's auth, scope, and state-machine rules
stay the single source of truth.

## Environment

| Var | Required | Notes |
| --- | --- | --- |
| `DOCKETRY_TOKEN` | yes | `dok_agt_*` agent key (preferred — actions are attributed to the agent) or `dok_pat_*` personal token. Mutating tools require the `write` scope. |
| `DOCKETRY_WORKSPACE` | yes | Workspace slug, e.g. `acme`. |
| `DOCKETRY_API_URL` | no | API base URL. Default `http://localhost:4000`. |

Missing required vars fail fast: the server writes the missing names to
stderr and exits 1 instead of serving tools that can only 401.

## Transports

- **stdio** (default) — what local MCP clients spawn:
  `tsx apps/mcp-server/src/index.ts` (dev) or `docketry-mcp` / `node
  apps/mcp-server/dist/index.js` after `pnpm --filter @docketry/mcp-server
  build`.
- **Streamable HTTP** — `--http[=PORT]` (or `MCP_HTTP_PORT`, default `3101`)
  serves a stateless `POST /mcp` endpoint plus `GET /health`.

## Client config

Claude Code — `claude mcp add` or `.mcp.json`:

```json
{
  "mcpServers": {
    "docketry": {
      "command": "node",
      "args": ["/path/to/docketry/apps/mcp-server/dist/index.js"],
      "env": {
        "DOCKETRY_API_URL": "http://localhost:4000",
        "DOCKETRY_TOKEN": "dok_agt_…",
        "DOCKETRY_WORKSPACE": "acme"
      }
    }
  }
}
```

Cursor — same shape in `~/.cursor/mcp.json`. For a source checkout without a
build, swap the command for `tsx` + `apps/mcp-server/src/index.ts`.

Mint an agent key first (human session required — agent keys can't mint
agents):

```sh
curl -X POST $API/v1/workspaces/$WS/agents \
  -H "cookie: dok_session=…" -H 'content-type: application/json' \
  -d '{"name":"claude","harness":"claude-code","capabilities":["code"]}'
curl -X POST $API/v1/workspaces/$WS/agents/$AGENT_ID/keys \
  -H "cookie: dok_session=…" -H 'content-type: application/json' \
  -d '{"name":"local","scopes":["read","write"]}'   # plaintext key returned once
```

## Tools

| Tool | Writes | Summary |
| --- | --- | --- |
| `whoami` | — | Resolve the credential to `{type, id, name, scopes}` |
| `list_issues` | — | Filter by state, priority, team, assignee, cycle, label, source, search; cursor-paginated |
| `ready` | — | `todo` issues ordered urgent→none then oldest; `mine` restricts to your assignments |
| `get_issue` | — | Full issue incl. labels/children; `includeComments` appends the thread |
| `create_issue` | yes | Title/desc/state(triage\|backlog)/priority/team/assignee/labels/project/cycle/parent |
| `update_issue` | yes | Patch any mutable field; state transitions validated; `null` clears nullable fields |
| `triage_issue` | yes | `accept`→backlog, `decline`→canceled |
| `comment` | yes | Post a comment as the credential's identity |
| `claim` | yes | Assign to yourself + move to `in_progress` (hops via `todo` from `backlog`) |
| `list_agents` / `list_teams` / `list_labels` / `list_projects` / `list_cycles` | — | Workspace resources, slim views |
| `list_events` | — | Workspace activity feed, cursor-paginated |

Tool outputs are compact JSON (both `content` text and `structuredContent`),
carrying only fields an agent needs — key, title, state, priority, assignee —
never full row dumps.

## Errors

API errors surface as MCP tool errors (`isError: true`) preserving the API's
`{error:{code,message}}` envelope — e.g. a read-scoped key calling
`create_issue` returns `FORBIDDEN_SCOPE`, an illegal state move returns
`INVALID_TRANSITION`, a missing issue returns `NOT_FOUND`. Tool errors never
crash the server.
