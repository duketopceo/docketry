# Slack app

Two-way Slack surface: intake (`/docket` + emoji) and thread mirroring.
HTTP Events API — no Socket Mode, no SDK dependency; a self-hosted instance
just needs a public HTTPS URL (Cloudflare Tunnel works).

## Config

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
SLACK_WORKSPACE_SLUG=your-workspace   # binding for self-host installs
SLACK_INTAKE_EMOJI=ticket             # optional, default :ticket:
```

All Slack surfaces 503 `SLACK_DISABLED` until token + secret + workspace slug
are set. Every request is verified with `X-Slack-Signature` (HMAC-SHA256
`v0:ts:body`, 5-minute freshness window) before parsing.

## Slack app setup

1. Create the app at api.slack.com/apps → **From scratch**.
2. **Slash Commands**: `/docket` → Request URL `https://<host>/webhooks/slack`.
3. **Event Subscriptions**: enable, same URL (the `url_verification`
   handshake answers automatically). Bot events: `reaction_added`, `message.channels`.
4. **Interactivity**: enable, same URL (modal submissions land here).
5. **OAuth scopes**: `commands`, `chat:write`, `reactions:read`,
   `channels:history` (+ `groups:history` for private channels).
6. Install to workspace → copy `SLACK_BOT_TOKEN` (Bot User OAuth) and the
   Signing Secret from **Basic Information**.

## Intake (#28)

- **`/docket`** alone → intake modal (title, description, urgency). On submit,
  the issue lands in triage and a confirmation posts to the channel; the
  thread ts becomes the mirror binding.
- **`/docket <title>`** → instant create, ephemeral reply with the key.
- **`:ticket:` reaction** on any message → `conversations.replies` pulls the
  thread, drafts an issue (`source: slack`, state `triage`), replies in
  thread with the key.

Every intake path writes a `slack_links` row (issue ↔ channel+thread+reporter)
— one thread per issue.

## Mirroring (#29)

| Direction | Behavior |
|---|---|
| Slack thread reply | becomes a comment `**<@user> via Slack:** …` (+ `commented` event with `after.via="slack"`) |
| docketry comment | posted into the linked thread — unless it carries the `via Slack:` marker (loop break) |
| terminal transition (`done`/`canceled`/`duplicate`) | `:white_check_mark:` resolution reply naming the resolver (user or agent) |

Bot-posted and subtype messages never mirror inbound — our own `chat.postMessage`
posts can't echo back. `DELETE /v1/:ws/issues/:key/slack-link` unlinks;
`GET` on the same path shows the binding.

## Limitations

- One docketry workspace per deployment (`SLACK_WORKSPACE_SLUG`) — Slack
  multi-workspace installs are a future OAuth-dance feature.
- Mirroring is best-effort; Slack API failures log, never block issue writes.
