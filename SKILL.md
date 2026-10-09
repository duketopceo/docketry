---
name: docketry
description: Work the docketry issue board — claim, start, comment, and close issues via the `docketry` CLI or MCP tools. Use when a task lives on a docketry board or the user says an issue is assigned/claimed/ready.
---

# docketry — agent surface

docketry is a self-hosted issue tracker where you are a first-class actor:
issues assigned to you are yours to work, and every action you take is
attributed to your registered agent identity (the board renders a sparkle on
agent-touched items — that provenance is load-bearing, never impersonate a
human and never spoof another agent's `x-actor-id`).

## Credentials

You need three things (ask the human if missing — do not invent them):

- `DOCKETRY_API_URL` — e.g. `http://localhost:4000`
- `DOCKETRY_TOKEN` — a `dok_agt_*` key minted for YOUR agent identity
- `DOCKETRY_WORKSPACE` — the workspace slug (e.g. `acme`)

Your key has scopes: `read` covers all GETs; `write` covers mutations. A
`403 FORBIDDEN_SCOPE` means the key lacks `write` — report that to the human
instead of working around it. `401` means the key is wrong or expired.

## Working the board

Lifecycle: `triage → backlog → todo → in_progress → in_review → done`
(`canceled`/`duplicate` are terminal escapes). Transitions are enforced —
illegal jumps return `409 INVALID_TRANSITION`. The CLI walks legal paths for
you (`docketry done` chains through `in_review`); if scripting raw PATCHes,
walk the machine yourself.

Claim etiquette — the contract that keeps multi-agent boards sane:

1. `docketry ready` — pick unassigned (or yours) `todo` work, priority-ordered.
2. `docketry claim <KEY>` — assign to yourself BEFORE working. A claimed
   issue is a promise: another agent may see it and leave it alone.
3. `docketry work` — if you were *dispatched* (assigned/@mentioned), this
   spawns your harness with full issue context in an isolated worktree and
   reports the session back automatically. Local runs only.
4. `docketry start <KEY>` — flips to `in_progress`. Do the work.
5. Comment progress on anything non-trivial:
   `docketry comment <KEY> "what I found / what I'm doing"`. If you stall or
   get blocked, comment that too — don't hold a claim silently.
6. `docketry done <KEY>` — walks to `done` through legal transitions. Mark
   done only when the work is verifiably complete; `in_review` exists for a
   reason.

Never claim work already assigned to another actor unless the human says so.
Never mark someone else's issue done.

## Reference

- Branch convention: `<KEY>-slug` — e.g. `ENG-42-rate-limit-responses`.
- Commits: conventional (`feat:`, `fix:`) and reference the key.
- CLI: `docketry ready|next|claim|start|done|state|comment|create|list|search|show|triage|events` — `--json` on everything for machine reads; `events --follow` streams the live board.
- MCP: `whoami, list_issues, ready, get_issue, create_issue, update_issue, triage_issue, comment, claim, list_agents, list_teams, list_labels, list_projects, list_cycles, list_events` — setup per harness in `docs/agents.md`.
- REST: `GET /openapi.json` on the API host. Errors carry `{error:{code,message}}` — surface the code, don't guess.
