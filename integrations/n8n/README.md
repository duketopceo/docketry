# n8n-nodes-docketry

n8n community nodes for [docketry](https://github.com/duketopceo/docketry) —
issue operations plus a signed outbound-webhook trigger, for self-hosted
and cloud n8n.

## Install

```bash
# self-hosted n8n — community node installation
cd ~/.n8n && mkdir -p nodes && cd nodes
npm install n8n-nodes-docketry
# or: Settings → Community Nodes → install "n8n-nodes-docketry"
```

## Credentials

Create **docketry API** credentials:

| Field | Value |
|---|---|
| Base URL | Root URL of your docketry API — e.g. `http://localhost:4000` for local dev, `https://docketry.example.com` self-hosted (trailing slashes are ignored) |
| Workspace | Workspace slug — every resource is workspace-scoped, resolved once here |
| API Key | `dok_agt_*` agent key or `dok_pat_*` personal access token |

Mint a key from a browser session or curl (see
[`docs/agents.md`](https://github.com/duketopceo/docketry/blob/main/docs/agents.md)):

```bash
curl -X POST $API/v1/workspaces/$WS/agents/$AGENT_ID/keys \
  -H "content-type: application/json" -b dok_session=… \
  -d '{"name":"n8n","scopes":["read","write"]}'
```

The credentials test calls `GET /v1/whoami`.

## docketry (action node)

Issue operations against the workspace API: create, get, update, delete,
list/search (state, priority, team, assignee, cycle, project, label,
source, full-text), comment, and transition — plus loadOptions-driven
pickers for teams, labels, projects, cycles, and assignees.

## docketry Trigger (webhook trigger)

On activation, the node registers a `webhook_endpoints` row on the
workspace pointing at n8n's webhook URL — the API accepts a
caller-provided secret, so the trigger generates a fresh
`dok_wh_…` secret per activation. Every delivery arrives
`X-Docketry-Signature: sha256=…` signed; unsigned or forged requests are
rejected silently and never start a run. Deactivation deletes the
endpoint.

Events: `issue.created`, `issue.state_changed`, `issue.commented`,
`issue.github_review`, `issue.dispatched`, `issue.dispatch_delivered`,
`issue.dispatch_failed`, `issue.session_update` — or **All events** (`*`).

Each run item carries `{deliveryId, action, ...event payload}`.

Requirements: your n8n instance must be reachable from docketry —
self-hosters behind NAT should expose n8n through a tunnel/reverse proxy
(the endpoint URL is what docketry POSTs to).

## License

MIT
