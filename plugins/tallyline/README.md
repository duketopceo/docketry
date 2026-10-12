# Tallyline plugin for Claude Code

Bundles the Tallyline MCP server (`@tallyline/mcp-server`, launched with `npx`)
and the `tallyline` agent skill.

```
claude plugin marketplace add duketopceo/tallyline
claude plugin install tallyline@tallyline
```

Claude Code prompts for the API URL, workspace slug and an agent key
(`tly_agt_*`). The key is marked sensitive and kept in the system credential
store; nothing secret ships in this package.

The MCP entry runs `npx -y @tallyline/mcp-server`, so it works once that
package is published to npm (PLAN-019). Until then, override with a source
checkout, see `docs/mcp.md`.

`skills/tallyline/SKILL.md` is a copy of the repo-root `SKILL.md`; CI fails if
they drift.
