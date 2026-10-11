# Authentication & SSO

docketry supports email/password (built-in), GitHub, Google, and any
generic OIDC provider. Humans are global identities — one `users` row
with memberships into workspaces — so a single sign-in can roam every
workspace the account belongs to, and `/workspaces` offers a chooser
when it belongs to more than one.

This page is the operator doc: provider setup, callback URLs, the
linking/JIT rules, env-vs-DB precedence, and troubleshooting.

## Callback URLs

Every provider redirect lands on the API, not the web app:

```
{API_BASE_URL}/v1/auth/oauth/github/callback
{API_BASE_URL}/v1/auth/oauth/google/callback
{API_BASE_URL}/v1/auth/oauth/oidc/callback
```

`API_BASE_URL` is the public API origin (the same var used for webhook
callbacks). The API bounces the browser to `WEB_URL` after the code
exchange — set both correctly or the flow dead-ends at the last hop.

## Provider setup

### GitHub

GitHub Apps already carry OAuth credentials — the same `GITHUB_CLIENT_ID`
used for issue sync doubles as the sign-in provider when
`GITHUB_CLIENT_SECRET` is set. To use a separate OAuth App instead:
GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

- **Authorization callback URL:** `{API_BASE_URL}/v1/auth/oauth/github/callback`
- **Scopes (automatic):** `read:user user:email` — needed to resolve the
  primary verified email.

### Google

Google Cloud Console → APIs & Services → Credentials → Create OAuth
client ID → Web application.

- **Authorized redirect URI:** `{API_BASE_URL}/v1/auth/oauth/google/callback`
- **Scopes (automatic):** `openid email profile`.
- The consent screen needs `email`/`profile` — internal workspaces can
  restrict to the Google Workspace org.

### Generic OIDC

Any spec-compliant IdP (Keycloak, Authentik, Entra, Okta, Dex…).
Configure `OIDC_ISSUER` to the issuer base — discovery runs against
`{OIDC_ISSUER}/.well-known/openid-configuration`, so **no endpoint URLs
are configured or trusted by hand**.

- **Redirect URI at the IdP:** `{API_BASE_URL}/v1/auth/oauth/oidc/callback`
- `OIDC_SCOPES` defaults to `email profile` (`openid` is always added).
- `OIDC_DISPLAY_NAME` sets the button label on the login page.

All provider endpoints are validated server-side: https-only, public
DNS, private/link-local/metadata IPs blocked. An IdP on a private
address is rejected — run the API with a routable IdP.

## Providers: env vs. DB

Two places to define providers, env wins:

| Source | Managed in | Notes |
|---|---|---|
| Env vars (`GITHUB_*`, `GOOGLE_*`, `OIDC_*`) | `.env` / compose | Shadow any DB row with the same key; can't be edited or deleted in the UI |
| DB rows | `/settings/providers` | Created/edited by instance admins; secrets AES-256-GCM-encrypted at rest, shown masked |

Instance admins = `AUTH_ADMIN_EMAILS`. **When that var is unset, the
bootstrap workspace owner is the fallback instance admin** — a fresh
install can reach the providers UI without any env config.

`POST /v1/auth/providers/:id/test` probes discovery/client-metadata from
the API server — use it after saving, before pointing users at the
button.

## Sign-in → identity resolution

After a provider callback verifies state, PKCE, and nonce, claims are
resolved in order:

1. **`auth_identities` hit** — returning user; session minted.
2. **Invite token carried through the flow** — consumed here for
   existing users; new users continue to rung 4.
3. **Verified-email match to an existing account** — governed by
   `AUTH_ACCOUNT_LINKING`:
   - `auto` (default): identity linked, signed in.
   - `login`: a pending-link code is issued; the web `/link` page proves
     control of the existing account (password or already-authenticated
     session) before the identity attaches. The link step never mints a
     session itself.
   - `disabled`: the match is treated as a new user.
4. **JIT create** — new global user, then:
   - email-bound invite: `user.email` must equal `invites.email`;
   - open invite: token-only, consumed atomically;
   - single workspace + `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` on: auto-join;
   - multiple/zero workspaces: pending-bootstrap — a 10-minute code
     carries the user to `/bootstrap` to create or join a workspace.
5. No workspace created → a `pending-bootstrap` code carries the new
   user to `/bootstrap`.

`AUTH_ALLOWED_EMAIL_DOMAINS` filters JIT account creation by email
domain (invite claims bypass it — the invite is itself authorization).
IdPs that omit an `email_verified` claim are treated as unverified:
their users can only enter via invite, and email-match linking requires
the `login` proof regardless of the `auto` setting.

## Invites

`POST /v1/workspaces/:ws/invites` (owner/admin) creates a hashed-at-rest,
single-use token, default 7-day expiry. Options: `email` binding,
`teamId` pre-assignment, `role` (`member`/`admin` — never `owner`).

- **Existing user:** accept at `/join/{token}` while signed in, or
  `POST /v1/auth/accept-invite` with a session.
- **New user:** the same link carries them through password setup or an
  OAuth round-trip; the token rides the OAuth state cookie (hashed), not
  the authorize URL.
- Password-only installs: the accept endpoint also takes
  `{name, password}` and creates the account — the invite is the only
  account-creation surface when every provider is off.

## Sessions, workspaces, and the chooser

- `dok_session` — HttpOnly cookie session, `Secure` in production,
  sha256-hashed at rest.
- `dok_ws` — active-workspace cookie the web bridges read; the chooser
  at `/workspaces` sets it (and re-binds the session server-side).
- Cookie sessions roam all member workspaces per request — membership
  is checked on every call, so removal is effective immediately.
- PATs (`dok_pat_*`), access JWTs, and agent keys (`dok_agt_*`) are
  workspace-bound. None can create workspaces, manage members/invites/
  providers, or mint credentials — those are cookie+role-gated.

## Operational flags

| Var | Effect |
|---|---|
| `AUTH_DISABLE_PASSWORD=1` | Hides password login + disables the login route. SSO-only installs. Don't set before at least one provider works |
| `AUTH_ACCOUNT_LINKING` | `auto`/`login`/`disabled` — see resolution rung 3 |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | JIT domain allowlist; invites bypass |
| `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` | **Default on.** A new OAuth user lands in the workspace when the instance has exactly one. On internet-facing installs this is open membership — set `0` unless you want it |
| `TRUSTED_PROXY=1` | Trust `x-forwarded-for` for rate-limit/log IPs. Set only behind a real proxy — spoofable otherwise |
| `AUTH_SECRET_KEY` | AES-256-GCM key (`openssl rand -base64 32`) encrypting DB provider secrets. **Rotating or losing it renders stored secrets undecryptable** — re-enter them in `/settings/providers` (no key-versioned envelope in v1) |
| `AUTH_ADMIN_EMAILS` | Instance-admin emails; unset → bootstrap owner fallback |
| `AUTH_DISABLE_PASSWORD` note | Password mint routes (`login`, bootstrap) return `PASSWORD_DISABLED`; agent/PAT/JWT auth unaffected |

## OAuth hardening inventory

- `state` (32B), `nonce`, PKCE S256 in HttpOnly `SameSite=Lax` cookies,
  10-minute TTL, `Secure` in production.
- One-time exchange codes: 60s TTL for `login`, 10min for
  `pending-bootstrap`/`pending-link` (a human has to fill a form);
  claimed atomically — discovery reads never consume them.
- `dok_login_nonce` binds the browser that clicked the provider button
  to the session minted from the exchanged code (login-CSRF fix).
- `return_to` is same-origin-relative only; anything else falls back
  to `/`.
- `invite` rides the state cookie — never the authorize URL — and is
  hashed at rest once consumed.
- The API emits no per-request access log; any proxy/ingress log must
  redact `start`/callback query params (`invite`, `return_to`,
  `login_nonce`, `code`) — bearer credentials ride GETs.

## Troubleshooting

| Symptom | Cause |
|---|---|
| OIDC discovery 404s | `OIDC_ISSUER` trailing slash mismatch — use the issuer exactly as the IdP publishes it |
| Login loop back to `/login` | `SameSite` cookie blocked — callback must be same-site (or your IdP must sit under the same eTLD+1); also check `WEB_URL` matches what the browser actually visits |
| `state mismatch` | Clock skew beyond the 10-min cookie TTL, or cookies dropped by a proxy — set `TRUSTED_PROXY=1` and check `Secure` handling behind TLS-terminating proxies |
| Provider button missing | Client id empty (env) or row disabled (DB); env rows shadow DB rows of the same key |
| `BAD_ENDPOINT` on save/test | Endpoint failed the https+public-IP check — private IdPs are rejected |
| Invite "already used" | Single-use claim raced or the link was forwarded after acceptance — mint a fresh invite |
