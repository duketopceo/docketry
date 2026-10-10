# @docketry/composio

Composio custom toolkit for [docketry](https://github.com/duketopceo/docketry) —
`DOCKETRY_*` tools that wrap the workspace REST API, so Composio-session
agents discover and operate the tracker natively.

## Configure (self-hosted endpoint)

The toolkit is a thin client — no Composio-managed auth. You supply your
own docketry API:

```ts
import { createDocketryToolkit } from "@docketry/composio";

const docketry = createDocketryToolkit({
  baseUrl: "https://docketry.example.com", // your self-hosted API root
  workspace: "acme",                        // workspace slug
  apiKey: process.env.DOCKETRY_API_KEY!,    // dok_agt_* or dok_pat_* key
});
```

Mint a key per [`docs/agents.md`](https://github.com/duketopceo/docketry/blob/main/docs/agents.md):
`POST /v1/workspaces/:ws/agents/:id/keys` with `["read","write"]` scopes.
`read` covers all `LIST_*/GET_*/WHOAMI` tools; the mutation tools need `write`.

## Attach to a session

```ts
import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const session = await composio.create(userId, {
  experimental: { customToolkits: [docketry] },
});
// session.tools() now exposes the DOCKETRY_* surface to the agent
```

## Tool surface — 1:1 with the public API

| Tool | API |
|---|---|
| `DOCKETRY_WHOAMI` | `GET /v1/whoami` |
| `DOCKETRY_LIST_ISSUES` | `GET /issues` (state/priority/team/assignee/cycle/project/label/source/search/limit/cursor) |
| `DOCKETRY_GET_ISSUE` | `GET /issues/:key` |
| `DOCKETRY_CREATE_ISSUE` | `POST /issues` |
| `DOCKETRY_UPDATE_ISSUE` | `PATCH /issues/:key` |
| `DOCKETRY_TRIAGE_ISSUE` | `POST /issues/:key/triage` |
| `DOCKETRY_COMMENT` | `POST /issues/:key/comments` |
| `DOCKETRY_LIST_EVENTS` | `GET /events` |
| `DOCKETRY_LIST_TEAMS` | `GET /teams` |
| `DOCKETRY_LIST_AGENTS` | `GET /agents` |
| `DOCKETRY_LIST_LABELS` | `GET /labels` |
| `DOCKETRY_LIST_PROJECTS` | `GET /projects` |
| `DOCKETRY_LIST_CYCLES` | `GET /cycles` |

Auth, workspace scoping, and the issue state machine stay server-side —
the tools just forward authenticated HTTP.

## Submission path

Two routes, per Composio's current custom-toolkit flow (`@composio/core`
0.22):

1. **In-session (used above)** — pass the built toolkit in
   `experimental.customToolkits` at `composio.create()`; tools execute
   locally in your process against your docketry API.
2. **Backend-registered** — publish as a connected toolkit via
   `composio.experimental.customToolkits.upsert({ slug: "DOCKETRY",
   toolkitConfig: { name, appUrl, authSchemes } })`. Self-hosters should
   prefer the in-session path: it keeps their base URL and key local
   instead of in a Composio auth config. The API-key auth scheme maps as
   `headers: { authorization: "Bearer {{generic_api_key}}" }`.

## License

MIT
