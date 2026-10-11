---
title: "feat: pluggable OAuth providers + org/team identity model"
date: 2026-10-10
type: feat
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
deepened: 2026-10-10
doc_reviewed: 2026-10-10 (ce-doc-review: coherence, feasibility, scope-guardian, security-lens, design-lens, adversarial, product-lens — 48 findings synthesized, ~30 applied; cross-model pass skipped: host family un-attestable)
---

## Goal Capsule

- **Objective:** A self-hosting stranger can sign in to docketry with GitHub or Google (or their own OIDC IdP), land in the right workspace as a real member with a role, and be one person across multiple workspaces — while every existing credential (`dok_session`, `dok_pat_`, `dok_agt_`, JWT) keeps working and every workspace boundary stays closed.
- **Means:** `openid-client` v6 provider registry + global `users`/`workspace_members`/`team_members`/`auth_identities`/`auth_providers`/`invites` schema (KTD1, KTD8).
- **Authority:** Requirements beat implementation detail; R15 (membership checked per request) and R16 (admin-gated minting) are the cardinal invariants; the three research dossiers in Sources orient but do not bind.
- **Stop conditions:** Any auto-link path that would join two identities on unverified email; any route that lets a removed member keep a live session; `POST /v1/workspaces` staying agent-reachable.
- **Execution profile:** One PR per coherent unit group (migration+enforcement, OAuth+linking, admin surface, parity+docs); serial implementation — U1 unblocks U2, which gates most later units.

---

## Product Contract

### Summary

docketry is an open-source self-hosted issue tracker whose only auth today is email/password behind `/v1/auth/bootstrap`. This plan adds a pluggable OAuth/OIDC provider framework (GitHub + Google named, generic OIDC slot) configured by env vars or an admin settings UI, promotes `users` from workspace-scoped to global identity, and introduces real org structure — workspace membership with owner/admin/member roles, team membership, and link-based invites — so a team can run docketry behind their existing identity stack. Agent authentication is untouched; agents never become members.

### Problem Frame

Self-hosters evaluating an OSS tracker hit the same wall: the product works but nobody else can log in sanely. The current model compounds it — users are per-workspace rows (`users.workspaceId NOT NULL`), so one person can't exist across orgs, there is no membership or role concept anywhere (the only privilege bit is `isCookieSession`), no settings surface, and no members list — even the assignee picker can only self-assign. A login lookup already takes the first global row by email, a latent ambiguity the schema permits. The fix is not a bolt-on sign-in button; it is the identity model the product was always going to need, plus the provider framework the user explicitly asked for.

### Key Decisions

- KD1. **Pluggable provider framework with guided setup** — env-first config plus a settings UI to add providers, rather than password-auth-only or a single hardcoded IdP. (session-settled: user-directed — chosen over shipping password auth alone: "framework then they go do guided setup or settings add it") Governs R5, R6, R7, R9, R22.
- KD2. **Workspace is the org** — no new layer above `workspaces`; teams live inside as today. Governs R2, R3, R17.
- KD3. **Named GitHub + Google providers** (user-directed — "github and google"), with a generic OIDC slot in the same registry shape for the enterprise self-host audience. Governs R5, R6, R7.

### Requirements

**Identity model**

- R1. `users` becomes a global identity: `lower(btrim(email))` globally unique — the index predicate must match the R15a lookup predicate exactly (`lower()` alone does not trim, so a whitespace-variant email would evade both the constraint and the merge). Emails are normalized `lower(btrim(email))` at write time. `workspace_id` column removed. Canonical (surviving) user UUIDs never rekey — actor joins and live sessions must keep resolving; merged-away duplicate UUIDs are re-pointed to the canonical UUID across all FK'd and actor columns per U1's enumeration, with `user_id_map` as the audit trail.
- R2. `workspace_members(user_id, workspace_id, role)` exists with `role ∈ {owner, admin, member}`; the bootstrap user becomes `owner`; every pre-existing user becomes `member` of their current workspace except the earliest-created user **in each workspace**, who becomes `owner`.
- R3. `team_members(team_id, user_id)` exists as membership only — no per-team role in v1.
- R4. The migration runs in ordered phases — additive tables, members backfill, email-collision merge with an auditable `user_id_map` (carrying a full `snapshot` of each deleted row), global `lower(btrim(email))` unique, drop `workspace_id` — and leaves every live session, PAT, and agent key valid afterwards, including credentials of merged users acting in every workspace any merged row belonged to. `0019` is the point of no return: the plan and deploy docs state the `pg_dump` pre-deploy gate and the restore-from-backup rollback story; `migrate()` gains `pg_advisory_lock`.

**OAuth providers**

- R5. GitHub sign-in: authorization-code flow with scope `read:user user:email` (`/user/emails` 401s without `user:email` — every verified-email flow depends on it), subject = numeric `id` (never `login`), verified primary email from `GET /user/emails`; PKCE S256 sent (github.com supports it; conditional if GHES is ever targeted).
- R6. Google sign-in: OIDC authorization-code flow with scope `openid email profile`; `email_verified` handling per Google's rules — `email_verified && (hd || gmail-domain)` counts as verified; `hd` claim feeds domain matching.
- R7. Generic OIDC provider slot: issuer + client id/secret + scopes + claim mappings (`email`, `name`, `email_verified`, `hosted_domain`) with discovery at `/.well-known/openid-configuration` and manual endpoint overrides. Configured endpoints must be https. IdPs emitting no verifiable email claim operate invite-only (documented in `docs/auth.md`).
- R8. OAuth hardening: `state` + PKCE `code_verifier` + `nonce` in `HttpOnly; SameSite=Lax` cookies (10 min); `Secure` follows the existing `setSessionCookie` precedent (`NODE_ENV === 'production'` or `API_BASE_URL` https-scheme — an unconditional `Secure` breaks plain-HTTP self-hosters); `redirect_uri` derived from the existing `API_BASE_URL`/`config_.apiBaseUrl` public-origin var (never Host — no second canonical-origin var; `github.ts` already derives webhook/redirect URLs from it); `return_to` validated as same-origin relative path; every callback non-happy path 302s to `{WEB_URL}/login?error=<code>` (never a raw JSON blob mid-flow), with the code→copy map shared between U3 and U6.

**Provider configuration**

- R9. Providers can be defined by env vars (`GITHUB_CLIENT_ID`, `GOOGLE_*`, `OIDC_*`) and by DB `auth_providers` rows; env wins on key collision and renders the UI field read-only; DB-stored client secrets are encrypted AES-256-GCM keyed from an env `AUTH_SECRET_KEY`; the admin UI never renders a stored secret (write-only).
- R10. `GET /v1/auth/methods` is public and returns `{password: bool, providers: [{key, type, label}]}` — no secrets — for the login page and for CLI/agent detection.
- R11. `AUTH_DISABLE_PASSWORD=1` rejects `/v1/auth/login` password paths and hides password fields; on a zero-workspace install the first OAuth login enters a pending-bootstrap state, the web bootstrap-bridge page collects workspace/team names, and `POST /v1/auth/oauth/exchange` accepts `{code, bootstrap: {workspaceSlug, workspaceName, teamKey}}` to complete it atomically (user + workspace + team + owner member in one tx). The `oauth_codes` discriminator distinguishes `login`/`pending-bootstrap`/`pending-link` states.
- R12. `AUTH_ALLOWED_EMAIL_DOMAINS` optionally allowlists post-verification email domains before JIT provisioning.

**Linking and membership**

- R13. `auth_identities(provider_key, provider_subject)` is unique and maps to `user_id`; `AUTH_ACCOUNT_LINKING ∈ {auto, login, disabled}` (default `login`): `auto` links on provider-verified email match, `login` creates a pending-link `oauth_codes` row and the web challenge page completes it via `POST /v1/auth/oauth/link` (fresh authentication as the matched user required — the challenge keys on the **matched user's credential state**, not the global flag: password prompt when `password_hash` is set, otherwise an existing session or re-auth through an already-linked provider — the link token is single-use, short-lived, bound to `(provider_key, subject)`, and never itself session-minting), `disabled` errors on email collision.
- R14. No code path ever auto-links identities on unverified email — GitHub `/user` `email` null/absent, OIDC `email_verified` absent/false, or Google's non-authoritative third-party-domain case all count as unverified.
- R15. Workspace binding is per credential class: **cookie sessions** act in any workspace where the user holds a `workspace_members` row (checked at the URL `:ws` per request — `sessions.workspaceId` is only the active default, changed via `POST /v1/auth/session {workspaceSlug}` which re-checks membership and re-binds); **PATs and JWTs** keep the hard bound-workspace equality check *plus* the per-request membership check at their bound workspace — a `user_tokens` row for ws A never acts in ws B, and a removed member's live PAT/session credentials 403 on the next request. **Agent keys** keep bound-workspace equality only — agents hold no member rows (R24) so no membership check applies to them. All credential classes run through `requireWorkspace`'s ~80 call sites in one place. Web contract, pinned as a decision tree: `/me`-driven resolution fails and `memberships.length > 0` → `/workspaces` chooser (the session is still valid elsewhere); `memberships.length === 0` or a `FORBIDDEN_WORKSPACE` with no remaining memberships → `/login?error=no_workspace` with removal copy — never a silently empty board.
- R15a. All email lookup paths — `/v1/auth/login`, `/v1/auth/me`, OAuth verified-email matching, invite acceptance — case-fold identically to `lower(btrim(email))`; case-variant duplicates merge per U1.
- R16. Credential minting requires a cookie session **and** workspace `owner`/`admin` role; agent keys can never mint keys, invites, or workspaces; `POST /v1/workspaces` becomes cookie-session-only with the creator becoming `owner`. Explicit exemption, pinned so implementers don't resolve it differently: `POST /v1/auth/token` (cookie→JWT exchange) is **outside** the admin mint gate — any member's cookie session may mint the 15-minute JWT, which is a projection of the session's own identity (inherits the caller's workspace binding, membership-checked per request, non-renewable beyond session life). PAT/agent-key minting stays owner/admin + cookie-only.
- R16a. `/v1/auth/*` endpoints carry an auth-scoped rate limiter *inside every router that serves the prefix* — one shared limiter middleware mounted in `auth.ts` (`login`, `token`), `oauth.ts` (`exchange`, `link`), and `invites.ts` (`accept-invite`) — today `authRoutes` mounts before the global middleware so neither `requireSession` nor `rateLimiter` ever runs on `/v1/auth/*` (inherited bug: `/v1/auth/login` is already unthrottled); tightest ceilings on `login`, `oauth/exchange`, `oauth/link`, `accept-invite`; `x-forwarded-for` only trusted behind a configured proxy. Also inside the same skip: `/v1/auth/*` handlers receive no populated `session`/`agentAuth` context — they resolve credentials themselves, and must never trust a client-supplied user id.
- R17. JIT resolution order: invite token → domain match (Google `hd`, `AUTH_ALLOWED_EMAIL_DOMAINS`, workspace-declared domains) → auto-join when the install has exactly one workspace → otherwise deny with a pending/invite-required response. Every rung except invite-token additionally requires `emailVerified === true` — domain claims and auto-join never fire on an unverified provider email. The invite rung applies R18's binding rules even here: an **email-bound** invite requires the identity's *verified* email to equal `invites.email` (forcing `emailVerified` for bound invites — otherwise a leaked bound invite redeems for a different person); **open-link** invites (email NULL) remain token-only authorization and are the one path that works with unverified email. Sole-workspace auto-join is an opt-in flag (`AUTH_AUTO_JOIN_SINGLE_WORKSPACE`, default on for the self-host persona; deploy docs must state the open-door consequence of leaving it on).

**Invites and members**

- R18. Link-based invites (no mailer exists): `POST/GET/DELETE /v1/workspaces/:ws/invites` (owner/admin) produce single-use expiring tokens claimed atomically at accept. `POST /v1/auth/accept-invite` resolves the caller's identity **server-side** from the presented credential (never a client-supplied user id), enforces `invites.email == user.email` when the invite is email-bound, caps invite roles at `member|admin` (`owner` is never invite-issuable), and converts token + identity into a member row in the same tx. Invite tokens carried through OAuth `start` travel as a hash inside the state cookie — never embedded in the IdP-facing authorize URL. Three pins the flows depend on: (a) the email binding holds on **both** claim paths — `accept-invite` and the OAuth JIT rung (R17); (b) the invite is consumed on the `auth_identities`-**hit** path too — an existing user clicking an invite link gets the membership after login, not a dropped token; (c) on password-enabled installs an unauthenticated invitee may claim the invite by submitting `{name, password}` — `accept-invite` creates user + member + session in one tx (otherwise a default install's invite links dead-end: no OAuth provider, no register path, bootstrap already closed). Member-management role transitions are pinned alongside the invite role cap: `PATCH`/`DELETE` on an **owner** row and any `role=owner` grant require the caller to be an owner; admins may only assign `member|admin` and only modify non-owner rows.
- R19. `GET /v1/workspaces/:ws/members` is the first user-list surface — readable by any member including read-scoped PAT/agent credentials — returning id/name/email/role so the UI assignee picker and agents can resolve humans.
- R20. Membership changes emit `member_joined`, `member_left`, `member_role_changed` on the workspace events feed; admin security actions emit `invite_created`, `invite_revoked`, and `provider_created`/`provider_updated`/`provider_deleted` (instance-scoped, attributed to the acting admin) — the two surfaces where abuse detection matters most cannot go unaudited while member changes are logged.

**Web surface**

- R21. The login page renders provider buttons from `/v1/auth/methods` (hidden when none enabled) and the OAuth callback completes through the web bridge so the session cookie lands on the web origin. Login-CSRF binding: `GET /api/auth/methods` (a route handler — a client-component login page **cannot** set an HttpOnly cookie) sets `dok_login_nonce` HttpOnly/SameSite=Lax once per ~10min window *and* returns the value in its response body so the client can embed it in `start` links; **every** OAuth entry path (`/login`, `/join`, `/link` re-entry) goes through the bridge and so mints the nonce before `start` — `exchange` requires the nonce whenever the code carries `login_nonce_hash`, never optional. The API threads it through `state` into `oauth_codes.login_nonce_hash`; the web callback forwards it on the exchange POST and the API verifies — a code minted on one browser cannot establish a session on another.
- R22. A first settings surface ships: workspace members (list, change role, remove), invites (create, list, revoke), and auth providers (CRUD + test-connection). Provider config is **instance-scoped**: CRUD/test requires an instance admin — env `AUTH_ADMIN_EMAILS` allowlist checked alongside cookie session, **matching only emails with verified provenance** (a `users.email` that arrived unverified — e.g. via an open-link invite claim — never satisfies the allowlist); when `AUTH_ADMIN_EMAILS` is **unset** the bootstrap owner counts as instance admin (otherwise a clean install can't reach the guided-setup surface KD1 promises — the env allowlist still wins whenever set). Not merely a workspace admin, because `auth_providers` and `/v1/auth/methods` govern every workspace's sign-in. The `test` endpoint's discovery fetch is egress-constrained: https-only, resolved-IP checked against loopback/private/link-local/metadata ranges, **the validated IP is the IP the connection dials** (no DNS-rebinding gap between check and connect), every redirect hop re-checked, size+time capped. The same egress rules apply to the runtime OIDC discovery/JWKS/token fetches on configured endpoints (R7 requires https at create/patch time).
- R23. Multi-workspace session semantics are pinned: `POST /v1/auth/session {workspaceSlug}` is **cookie-session-only** (PAT/JWT/agent callers have no session row to rebind → 403) — it re-checks membership then re-binds `sessions.workspaceId` and returns the slug so the web layer sets `dok_ws`. `/me` returns `memberships`, `activeWorkspaceSlug` (the cookie-session field name — PAT/JWT `/me` keeps `workspaceSlug` = bound workspace), and `isInstanceAdmin` (R22's signal — the web can't derive it from `memberRole`), keeping `activeWorkspaceSlug` (server-rendered pages) and `dok_ws` (bridge routes) in agreement. A chooser page at `/workspaces` renders `memberships` from `/me` when a session holds >1 and no active ws resolves.

**Agent parity**

- R24. Agents are never `workspace_members`/`team_members` rows; the invariant "agent keys cannot mint agents, keys, invites, or workspaces" is preserved and closed where currently open.
- R25. MCP gains a `list_members` tool; `GET /v1/whoami` reports the caller's memberships and role; `openapi.json`, `docs/agents.md`, and e2e seeding (which currently SQL-inserts a second user because no invite endpoint exists) move to the real invite path.

### Success Criteria

- `docker compose up` on a clean install → bootstrap → admin adds a Google provider in settings → a second human signs in with Google and lands in the workspace as a member.
- A removed member's live `dok_session`/`dok_pat_` returns 403 on the next request, not at token expiry (30-day TTL makes lazy revocation unacceptable).
- Two providers linked to one verified email produce one user, never two; an unverified-email collision never auto-links.
- `AUTH_DISABLE_PASSWORD=1` install: password login 403s, first OAuth login bootstraps owner, login page shows providers only.
- `dok_agt_` keys keep working for reads/writes they always had and gain no new privileges; agent keys cannot create workspaces, invites, or credentials.
- Migration on a populated dev DB: all pre-existing issues/comments/events keep their actor names; duplicate-email fixtures merge deterministically with an audit trail.

### Scope Boundaries

**Deferred to Follow-Up Work** (planned elsewhere, not this plan's units)

- Workspace switcher UX beyond groundwork (R23's full picker polish), CLI `dok members`, private teams, guest role, team-level roles gating dispatch, agent-registration-request queue, DB-managed provider CRUD beyond the settings UI needs, GitHub Enterprise Server support (no PKCE — conditional handling when scoped), OIDC `form_post` response mode (cross-site POST callbacks don't round-trip `SameSite=Lax` state cookies — would need `SameSite=None; Secure`; query-param flow covers the target IdPs), issue-detail assignee-picker component beyond `:assign` member resolution.

**Outside this product's identity**

- Hosted-SaaS auth (Clerk/Auth0/managed identity) — self-host only. SAML, LDAP, SCIM, directory sync, SSO enforcement policies, 2FA, magic links, email-delivered invites (no mailer exists; adding SMTP is its own decision).

**Considered and not built**

- Per-team roles in v1 (member-only lists cover assignment scoping; a team role adds a second permission axis before the first is exercised — revisit when private teams land).
- Provider access/refresh-token storage (nothing calls provider APIs post-login; storing them adds a secret-at-rest liability for zero current use — revisit if calendar/profile sync appears).
- Auto-created workspace for unknown-domain SSO users (org-less signups spinning up ad-hoc orgs is a governance hole; invite/domain/sole-workspace covers the real cases).
- Trusted-header / reverse-proxy auth (Authentik proxy, oauth2-proxy, Traefik forward-auth — the Grafana/Miniflux pattern). A real alternative for part of the self-host audience, but it delegates identity to deployment topology rather than giving the product a user model — the global-users/membership refactor is needed regardless, and a provider framework covers IdPs header auth can't reach (GitHub, Google). A `AUTH_TRUSTED_HEADER` companion behind `TRUSTED_PROXY` is a coherent follow-up, not a substitute.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`openid-client` v6 for Google + generic OIDC; ~80-line fetch client for GitHub** — arctic is deprecated (author EOL'd Oslo July 2026), better-auth is a framework buy-in with its own schema and a CVSS-9.1 history. openid-client handles discovery, PKCE, state/nonce, and full id_token validation (JWKS/iss/aud/exp/nonce) — exactly the surface not worth owning. GitHub is OAuth-only (no id_token) so a small fetch client is honest code. Governs R5–R8.
- KTD2. **Identity is `(provider_key, provider_subject)`; email is only a linking hint** — `sub`/GitHub numeric `id` is the durable key; verified-email rules per provider (GitHub `/user/emails` primary+verified, Google `email_verified`+`hd`/gmail, OIDC `email_verified` claim). Entra/nOAuth precedent: auto-link on unverified email = account takeover. Governs R13, R14.
- KTD3. **Config precedence: env > DB, secrets AES-256-GCM from `AUTH_SECRET_KEY`** — env-defined providers are read-only in the UI (Plane/Gitea convention); DB secrets encrypted with an instance key (Plane `AES_SECRET_KEY` precedent; Gitea's plaintext-JSON is the counterexample). Public discovery endpoint exposes keys/types/labels only. Governs R9, R10.
- KTD4. **Workspace binding is a per-credential-class matrix, not one rule** — cookie sessions are roam-capable (membership at the URL `:ws`, `sessions.workspaceId` = mutable active default via `POST /v1/auth/session`); PATs/JWTs/agent keys keep hard bound-ws equality (delegated credentials never expand beyond their minted scope) *plus* the membership check (removal still kills them instantly). The ambiguity between "replace equality" and "keep binding" is the security-critical choice and is pinned here, not left to the implementer. Governs R15, R16, R23.
- KTD5. **`oauth_codes` is the full post-auth handoff carrier, not just a session voucher** — the API→web bridge carries `{purpose: login|pending-bootstrap|pending-link, user_id, workspace_id, return_to, invite_hash, link_provider_key, link_subject, pending_email, login_nonce_hash}` so `return_to`, the invite reference, link state, and bootstrap state all survive the API→web 302 without riding the URL or the IdP-facing `state`. TTLs are purpose-scoped: `login` codes are 60s (machine-redeemed immediately by the callback route), `pending-bootstrap`/`pending-link` codes are 10min (they bound a human-in-the-loop step — form-filling or re-auth — a 60s code would 410 mid-typing; matches the state-cookie `Max-Age=600` precedent). Codes are claimed atomically (`UPDATE … SET used_at WHERE used_at IS NULL RETURNING`) **at completion, not on first read** — exchange dispatches on `purpose` before claiming (U3.6), so pending-purpose codes survive long enough to be completed. Never logged, `Cache-Control: no-store` on both legs. Governs R11, R13, R21, R8.
- KTD6. **Roles: `owner|admin|member` on the workspace; teams carry membership only; agents never members** — the first privilege model stays one-dimensional; agent identity stays a separate table with its own key format, and "agents cannot mint credentials" stays a hard invariant. Governs R2, R3, R16, R24.
- KTD7. **Provider registry shape: `{key, type, label, start(req)→redirect, callback(req)→IdentityResult}`** — one module per provider type (`github`, `google`, `oidc`); configured instances come from env + DB under one resolver so `GET /v1/auth/methods` and the callback router share it. `IdentityResult = {subject, email, emailVerified, name, avatarUrl, hd}`. Governs R5, R6, R7, R10.
- KTD8. **Migration in two drizzle migrations inside U1** — `0018` additive (six new tables + members backfill + `user_id_map` scaffold) then `0019` destructive (email-collision merge on `lower(btrim(email))`, complete re-point set, `lower(btrim(email))` unique, drop `users.workspace_id`). `0019` is forward-only and row-deleting — the pre-deploy `pg_dump` is the rollback; it runs single-instance under `pg_advisory_lock`. Governs R1, R4.
- KTD9. **Pluggable framework via guided setup or admin settings** (session-settled: user-directed — chosen over password-auth-only: the user asked for a framework with guided setup/settings, not a hardcoded provider). Governs R5–R9, R22 — instantiates KD1.
- KTD10. **Provider config is instance administration, not workspace administration** — `auth_providers` is instance-scoped and `/v1/auth/methods` is global, so provider CRUD/test sits behind `AUTH_ADMIN_EMAILS` + cookie session (verified-provenance emails only; bootstrap owner is the fallback instance admin when the env var is unset — R22); workspace owner/admin manages members, teams, and invites only. Test/discovery egress is constrained (https-only on all configured endpoints, validated IP is the dialed IP, redirect hops re-checked, no private/link-local/metadata targets). Governs R9, R22.

### High-Level Technical Design

**OAuth login, end to end**

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as Web (:3100)
    participant A as API (:4000)
    participant P as Provider (GitHub/Google/OIDC)
    B->>W: GET /login (buttons from /v1/auth/methods)
    B->>A: GET /v1/auth/oauth/{provider}/start?return_to=
    A->>A: state+nonce+PKCE cookies (HttpOnly Lax)
    A-->>B: 302 provider authorize URL
    B->>P: authorize (consent)
    P-->>B: 302 /v1/auth/oauth/{provider}/callback?code&state
    B->>A: callback (verify state, exchange code, validate id_token)
    A->>A: resolve identity → user → membership (JIT chain)
    A-->>B: 302 {WEB_URL}/api/auth/callback?code={one-time}
    B->>W: GET /api/auth/callback?code=
    W->>A: POST /v1/auth/oauth/exchange {code}
    A-->>W: 200 + set-cookie: dok_session
    W-->>B: 302 return_to (session cookie on web origin)
```

**Identity resolution on callback**

```mermaid
flowchart TB
    C[IdentityResult from provider] --> L{auth_identities hit<br>provider+subject?}
    L -->|yes| M[load user → pick workspace]
    L -->|no| E{verified email matches<br>existing user?}
    E -->|yes + policy=auto| AL[link identity → user]
    E -->|yes + policy=login| LP[pending-link state:<br>re-auth then link]
    E -->|yes + policy=disabled| X[409 LINK_DISABLED]
    E -->|no| J{JIT: invite token?}
    J -->|yes| JM["member of invite's workspace<br>(email-bound: verified email must match)"]
    J -->|no| D{domain match?}
    D -->|yes| JM2[member of matching workspace]
    D -->|no| S{exactly one workspace?}
    S -->|yes| JM3[member of sole workspace]
    S -->|no| X2[403 INVITE_REQUIRED]
    AL --> M
    LP -->|authed| AL
    JM --> M
    JM2 --> M
    JM3 --> M
    M --> T[create user/identity/member in one tx<br>→ session → one-time code]
```

**Migration phases (U1)**

| Phase | Migration | Content | Breaks nothing because |
|---|---|---|---|
| 1 | `0018` additive | `auth_providers`, `auth_identities`, `workspace_members`, `team_members`, `invites`, `oauth_codes`, `user_id_map` + backfill members from `users.workspace_id` | new objects only; app still reads old shape |
| 2 | `0019` destructive | merge duplicate-email users into canonical rows via `user_id_map`, add global `unique(lower(btrim(email)))`, drop `users.workspace_id`, add `workspaces.allowed_domains` | UUIDs stable → actor joins + sessions unaffected |

### Assumptions

- `WEB_URL` can be added to env for the API→web origin; `API_BASE_URL` already exists and is reused for `redirect_uri` derivation — OAuth redirects must never derive from Host headers.
- `openid-client` v6 installs cleanly under pnpm/Node 22 in `apps/api` (ESM).
- A 32-byte `AUTH_SECRET_KEY` env var is acceptable as a new required-when-providers-DB-configured secret (providers may be env-only without it).
- Workspace-declared domains for JIT matching live on `workspaces` (new `allowed_domains text[]`), admin-editable.
- Bootstrap remains single-use per deployment; under `AUTH_DISABLE_PASSWORD` the first-ever OAuth login substitutes the password step but still collects workspace/team naming.
- Hosted instances are dogfood surfaces: the first hosted deployment tracks external projects (e.g. `duketopceo/open-computer` — phase-parent/checklist-child roadmap filed by its agents). Deploy docs must keep agent-filed issue flows working end-to-end — `dok_agt_` minting (owner/admin, R16), REST `POST /v1/workspaces/:ws/issues`, and the MCP server — so fleet agents can file and update issues without human-in-loop.

### Sources / Research

- Repo dossier (auth.ts, schema.ts, requireWorkspace, web bridge, env/test/docs surfaces) — `apps/api/src/routes/auth.ts:49-308`, `apps/api/src/db/schema.ts:64-428`, `apps/api/src/routes/workspaces.ts:36-131`, `apps/web/lib/session.ts`, `apps/api/src/env.ts`.
- OAuth/OIDC external research — `openid-client` v6 official docs/examples; GitHub OAuth docs (`/user/emails`, PKCE changelog, GHES no-PKCE); Google OIDC docs (`hd`, `email_verified` rules); RFC 7636/9700; Copenhagen Book state/nonce/PKCE guidance; Gitea `ACCOUNT_LINKING` policy + auth-source UI; Plane god-mode provider config + `AES_SECRET_KEY`; Outline env-only OIDC; Entra `xms_edov`/nOAuth account-takeover class.
- Agent-parity assessment — `apps/api/src/routes/agents.ts`, `apps/api/src/routes/tokens.ts`, `apps/mcp-server/src/tools.ts`, `tools/e2e/global-setup.ts` invite-workaround note.
- Competitive reference: Linear (Google free tier; SAML/SCIM enterprise-quote), GitHub Projects (org/teams, SSO on enterprise), Plane (Google/GitHub OAuth + OIDC + SAML self-host; no Google-domain restriction yet — the gap R12 beats), Jira (Atlassian Guard SAML).

---

## Implementation Units

| U-ID | Unit | Key files | Depends on |
|---|---|---|---|
| U1 | Schema migration: global users + seven new tables | `apps/api/src/db/schema.ts`, `apps/api/drizzle/0018_*.sql`, `0019_*.sql`, `db/migrate.ts`, all test wipe lists | — |
| U2 | Membership enforcement + credential-class matrix | `apps/api/src/routes/workspaces.ts`, `routes/auth.ts`, `routes/{agents,tokens}.ts`, `lib/actor.ts`, `services/members.ts` | U1 |
| U3 | Provider registry + OAuth endpoints | `apps/api/src/auth/providers/*`, `auth/{oauth-state,secrets}.ts`, `routes/oauth.ts`, `env.ts` | U1 |
| U4 | Identity resolution + JIT + bootstrap rework | `apps/api/src/services/identity.ts`, `routes/auth.ts`, `routes/oauth.ts` | U2, U3 |
| U5 | Admin API: members, invites, provider CRUD | `apps/api/src/routes/{members,invites,providers}.ts`, `services/invites.ts` | U2, U4 |
| U6 | Web auth UX: provider buttons, bridge, chooser, link + join pages | `apps/web/app/(auth)/*`, `app/api/auth/*`, `app/(auth)/workspaces/*`, `middleware.ts`, `lib/{session,api}.ts` | U3, U4, U5 |
| U7 | Settings admin UI | `apps/web/app/(app)/settings/*`, `app/api/settings/*` | U5 |
| U8 | Agent parity: MCP tool, whoami, openapi, events | `apps/mcp-server/src/tools.ts`, `routes/whoami.ts`, `openapi.ts` | U5 |
| U9 | Env surface + docs | `apps/api/src/env.ts`, `.env.example`, `docs/{auth,deploy,agents}.md`, `docker-compose.selfhost.yml` | all |

### U1. Schema migration: global users + seven new tables

**Goal:** Introduce the identity schema — `auth_providers`, `auth_identities`, `workspace_members`, `team_members`, `invites`, `oauth_codes`, `user_id_map` — and promote `users` to global identity per R1–R4.

**Requirements:** R1, R2, R3, R4 (KTD8)

**Files:**
- `apps/api/src/db/schema.ts` — new tables; `users.workspaceId` removed; `workspaces.allowedDomains text[]` added
- `apps/api/drizzle/0018_<tag>.sql`, `apps/api/drizzle/meta/0018_snapshot.json`, `meta/_journal.json`
- `apps/api/drizzle/0019_<tag>.sql`, `meta/0019_snapshot.json`, `meta/_journal.json`
- `apps/api/scripts/seed.ts` — fixture user gains a `workspace_members` row (it still references `users.workspace_id` — DoD's "no dead references" gate would catch it anyway)
- Wipe lists in every API test file (~12 sites: `api.test.ts`, `cycles.test.ts`, `events.test.ts`, `projects.test.ts`, `dispatches.test.ts`, `github-sync.test.ts`, `webhooks.test.ts`, `slack*.test.ts`, `services/*.test.ts`) and `tools/e2e/global-setup.ts`
- `apps/api/src/db/schema.test.ts` or `routes/api.test.ts` — migration-verification coverage

**Approach:**
1. Regenerate the schema first so `0018` covers only additive tables; `users` and `workspaces` changes stay out of it.
2. `workspace_members`: `(id, workspace_id FK cascade, user_id FK cascade, role pgEnum('owner','admin','member') notNull default 'member', created_at)`, `unique(workspace_id, user_id)`, index on `user_id`. Backfill: one row per existing `users` row — `owner` for the earliest-created user per workspace, `member` for the rest.
3. `team_members`: `(id, team_id FK cascade, user_id FK cascade, created_at)`, `unique(team_id, user_id)`.
4. `auth_providers`: `(id, workspace_id NULL → instance-scoped v1, key text, type pgEnum('github','google','oidc'), label, client_id, client_secret_enc bytea|text, issuer, scopes text[], claim_map jsonb, endpoints jsonb, enabled bool, created_at)`, `unique(key)` — no FK cascade to workspaces (instance-scoped); column kept nullable for future per-workspace providers.
5. `auth_identities`: `(id, user_id FK cascade, provider_key, provider_subject, email, email_verified bool, created_at)`, `unique(provider_key, provider_subject)`, index on `user_id`.
6. `invites`: `(id, workspace_id FK cascade, email NULL (open-link invites allowed), token_hash unique, role pgEnum('member','admin') default 'member' — never 'owner', team_id uuid NULL → teams (U5.4 accepts it, U4.3 inserts team_members on accept), created_by → users, expires_at, accepted_at, accepted_by → users, created_at)`.
7. `oauth_codes`: `(id, code_hash unique, purpose pgEnum('login','pending-bootstrap','pending-link'), user_id FK cascade NULL (pending states may precede the user row — store subject+email in context), workspace_id NULL, context jsonb {return_to, invite_hash, link_provider_key, link_subject, pending_email, login_nonce_hash}, expires_at, used_at)` — the full handoff carrier per KTD5.
8. `user_id_map`: `(old_user_id, merged_into_user_id, reason, snapshot jsonb)` — `snapshot` stores the full deleted row (name, email, password_hash, avatar_url, created_at) so a bad canonical pick is forensically reconstructible.
9. `0019` in one transaction: (a) find duplicate emails grouped by `lower(btrim(email))`; (b) canonical pick among credential-bearing duplicates prefers the row with the **most recent session/login** (the surviving `password_hash` should be the one the human remembers — earliest `created_at` can strand a dormant password while the active one dies), then earliest `created_at`, then lowest UUID; (c) `INSERT user_id_map` with snapshots; (d) re-point the **complete** set before delete — `sessions.user_id`, `user_tokens.user_id`, `views.owner_id`, `workspace_members.user_id`, `team_members.user_id`, `auth_identities.user_id`, `oauth_codes.user_id`, `invites.created_by`, `invites.accepted_by` — members via `INSERT … SELECT … ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = <higher of the two>` then delete losing rows (case-variant dupes collide on `unique(workspace_id, user_id)`, and a plain `DO NOTHING` can silently keep canonical's `member` row while discarding the losing row's `owner` — stripping a workspace's only owner); (e) actor columns — four explicit updates on `issues.creator_id` + `assignee_id`, `comments.actor_id`, `events.actor_id` — keyed on `user_id_map` membership, **not** an actor-type predicate (`UPDATE … WHERE actor_id IN (SELECT old_user_id FROM user_id_map)`); today's unvalidated `x-actor-type: agent` path can forge `agent`-typed rows carrying a `users.id`, so a `<> 'agent'` guard leaves dangling attribution; (f) `DELETE FROM users` merged rows (cascade then has nothing left to kill); (g) `CREATE UNIQUE INDEX … ON lower(btrim(email))` — matching the R15a lookup predicate; (h) drop `users.workspace_id`; (i) `ALTER TABLE workspaces ADD allowed_domains text[]` (additive, rides `0019` so U4's domain matching has a home). A racing login mid-merge worst case loses a session, never corrupts.
10. Update every hand-maintained wipe list in the same commit — new tables get FK-ordered entries or suites leak state.
11. `apps/api/src/db/migrate.ts`: wrap `migrate()` in `pg_advisory_lock` **held on one dedicated `pool.connect()` client that also runs `migrate()`** — advisory locks are session-scoped, so locking via the pooled `db` can lock a different connection than the one migrating (and `pg_advisory_unlock` then silently returns false, leaking the lock for the process lifetime). Alternative: `pg_advisory_xact_lock` inside the migration transaction (auto-releases). Two replicas booting together both apply today; loser crash-loops on `42P07`.
12. Journal-drift preflight: self-host DBs that applied regenerated-tag migrations (the slack_links `0014→0015` retag is real precedent — `meta/0006_snapshot.json` is absent from the repo) hit drizzle's hash/order check on boot. U1 ships a documented reconcile step in `docs/deploy.md` (insert the missing `__drizzle_migrations` row by hand) — the rehearsal gate below will fail on drifted DBs without it, which is the point.

**Execution note:** Write the dedupe migration as a characterization exercise first — seed a fixture DB with two workspaces sharing an email (plus a case-variant `A@x.com`/`a@x.com` pair and a credential-less fixture row) before writing `0019`, and verify `user_id_map` output by hand before trusting the generator.

**Test scenarios:**
- Additive migration applies cleanly on a populated DB; `workspace_members` backfill produces exactly one row per pre-existing user with correct owner/member split.
- Two workspaces containing `a@x.com` merge into one canonical user; `user_id_map` records both old IDs **with full row snapshots**; sessions for both old rows point at the canonical id afterwards.
- Merged user retains membership in **both** workspaces (re-point before delete — a workspace that loses its only member this way is a brick); no workspace ends with zero members or zero owner.
- Case-variant pair `A@x.com`/`a@x.com` (legal under today's case-sensitive unique) merges without violating `unique(workspace_id, user_id)` or `lower(email)`; post-merge `a@x.com` login authenticates the canonical row.
- Issues created-by and assigned-to a merged user resolve creator/assignee names under the canonical UUID and appear in canonical's `?assignee` filter; events by the merged user keep `actorName`.
- A live `dok_session` and `dok_pat_` minted before the migration authenticate afterwards (UUID-stable guarantee).
- Rollforward on an empty DB: both migrations apply, schema matches `schema.ts`, `users` has no `workspace_id`.
- Post-0019 assertion queries pass: `count(users)` delta = `count(user_id_map)`; zero dangling `actor_id` where `*_type='human'` across the four pairs; zero workspaces with zero members/owners; every `sessions.workspace_id` covered by a `workspace_members` row for that user; zero duplicate `lower(email)`; `__drizzle_migrations` matches the journal.
- Two concurrent `migrate()` runs serialize on the advisory lock; second instance sees all applied, exits clean.

**Verification:** `pnpm --filter @docketry/api test` green on a fresh DB and on a copy of a populated dev DB; `drizzle-kit generate` produces no further diff after `0019`.

---

### U2. Membership enforcement + role guards

**Goal:** Make `workspace_members` the authorization boundary — `requireWorkspace` resolves membership + role, credential minting becomes admin-gated, and `POST /v1/workspaces` closes to cookie sessions per R15–R17.

**Requirements:** R15, R16, R17 (KTD4, KTD6)

**Dependencies:** U1

**Files:**
- `apps/api/src/routes/workspaces.ts` — `requireWorkspace` gains membership join + role injection; `POST /v1/workspaces` gated
- `apps/api/src/routes/auth.ts` — `requireSession` context gains `memberRole`; `isCookieSession` unchanged
- `apps/api/src/services/members.ts` (new) — `memberOf(userId, workspaceId)`, `requireRole(c, ws, 'admin')`
- `apps/api/src/routes/agents.ts`, `apps/api/src/routes/tokens.ts` — mint routes add role gate
- `apps/api/src/routes/issues.ts` — `validateAssignee` switches `users.workspaceId` check to membership check
- `apps/api/src/routes/workspaces.test.ts` (new), plus edits to existing route tests asserting old behavior

**Approach:**
1. `requireWorkspace` keeps URL-slug resolution, then applies the per-class matrix (KTD4): **cookie sessions** → `workspace_members(userId, url-ws)` check (roam-capable; `sessions.workspaceId` no longer gates, only seeds the default); **PATs/JWTs** → bound-ws == url-ws (unchanged) AND `workspace_members(userId, bound-ws)`; **agent keys** → bound-ws == url-ws (unchanged, no membership — agents aren't members per KTD6/R24). Absent → 403 `FORBIDDEN_WORKSPACE`; on hit inject `memberRole` into context.
2. PATs/JWTs keep their hard binding — a `user_tokens` row for ws A never acts in ws B — and the new membership check means a removed member's PAT 403s even while unexpired.
3. `requireRole` helper: owner > admin > member ordering; mint routes (`POST /v1/workspaces/:ws/agents`, `POST /v1/workspaces/:ws/tokens` — the real scoped paths) require `admin` + `isCookieSession`; `POST /v1/auth/token` stays exempt per R16 (session-derived JWT, not a new credential); member/invite routes (U5) share it; provider-admin routes require instance admin (KTD10).
4. `POST /v1/workspaces`: cookie-session only; creator auto-becomes `owner` of the new workspace in the same tx. Document the agent-key close in `docs/agents.md`.
5. `POST /v1/auth/session {workspaceSlug}` (new, **cookie-session-only** — PAT/JWT/agent credentials 403): re-checks membership, re-binds `sessions.workspaceId`, returns `{workspaceSlug, memberships}` — the switch mechanism U6's picker calls.
6. `sessions.workspaceId` semantics: "active workspace of this session" — login mints it to the resolved membership; `/me` returns `memberships` + `activeWorkspaceSlug` + `isInstanceAdmin` (cookie-session fields — the web reads `isInstanceAdmin` for the providers page since `memberRole` can't derive it; PAT/JWT `/me` responses keep `workspaceSlug` = bound workspace — contract pinned for web).
7. `validateAssignee` (issues.ts:137): `users.workspaceId` check → `workspace_members` row check; agent branch unchanged.
8. `x-actor-*` headers — terminal rule pinned: the actor **id** is always derived from the authenticated credential (agent key → its own `agentId`; session/PAT → `userId`) — `x-actor-id` is never honored from any caller. `x-actor-type` may only select among types the credential class permits: `human` for cookie/PAT sessions (or omit), `agent` for agent keys; `system` is rejected for all callers in v1 (no internal emitter exists — closes the provenance-forgery path `lib/actor.ts` leaves open before `member_*` events land on the audit feed).

**Test scenarios:**
- Member of ws A reads ws A issues; same user without membership in ws B gets 403 `FORBIDDEN_WORKSPACE` on ws B routes.
- Cookie session of a user with memberships in A and B reads B's issues without re-login (roam); `POST /v1/auth/session {slug:B}` re-binds and `/me` reports B as active.
- A PAT minted for ws A with the user later joining ws B still 403s on every ws B route (hard binding preserved).
- Removing a member row causes their live `dok_session` and `dok_pat_` to 403 on the next request (no TTL wait).
- `POST /v1/workspaces` with `dok_agt_` key → 403; with cookie session → 201 and caller is `owner`.
- `POST /v1/workspaces/:ws/tokens` (PAT mint) as member → 403 `FORBIDDEN_ROLE`; as admin/owner → 201; via PAT (not cookie) → 403 regardless of role; `POST /v1/auth/token` as member cookie session → 200 (R16 exemption — not a mint).
- Agent key reads/writes inside its bound workspace unchanged; `validateAssignee` accepts a member, rejects a non-member human, accepts an agent.
- Cookie/PAT request with `x-actor-type: agent` → 403; same header from an agent key → honored.
- Owner demoting the last owner → 4xx guard (`LAST_OWNER`).

**Verification:** existing suites stay green (no behavior change for grandfathered single-workspace single-member installs beyond role defaults); new workspaces.test.ts covers the role matrix.

---

### U3. Provider registry + OAuth endpoints

**Goal:** The pluggable provider machinery — registry, three provider types, and the `/v1/auth/oauth/*` route family per R5–R10 and KTD1/KTD7.

**Requirements:** R5, R6, R7, R8, R9, R10 (KTD1, KTD3, KTD5, KTD7)

**Dependencies:** U1

**Files:**
- `apps/api/src/auth/providers/{registry,github,google,oidc}.ts` (new)
- `apps/api/src/auth/oauth-state.ts` (new) — state/nonce/PKCE cookie issue + verify
- `apps/api/src/auth/secrets.ts` (new) — AES-256-GCM encrypt/decrypt from `AUTH_SECRET_KEY`
- `apps/api/src/routes/oauth.ts` (new) — `GET /v1/auth/methods`, `GET /v1/auth/oauth/:provider/start`, `GET /v1/auth/oauth/:provider/callback`, `POST /v1/auth/oauth/exchange`, `POST /v1/auth/oauth/link`
- `apps/api/src/routes/auth.ts` — exchange endpoint reuses `createSession`/`setSessionCookie`
- `apps/api/src/env.ts` — provider env parsing (`GITHUB_*`, `GOOGLE_*`, `OIDC_*`, `AUTH_SECRET_KEY`, `APP_BASE_URL`, `WEB_URL`, `AUTH_DISABLE_PASSWORD`, `AUTH_ACCOUNT_LINKING`, `AUTH_ALLOWED_EMAIL_DOMAINS`)
- `apps/api/package.json` — add `openid-client` (pin a version ≥7 days old)
- `apps/api/src/auth/providers/providers.test.ts` (new)

**Approach:**
1. Registry resolves configured providers from env first, then `auth_providers` rows (env key wins; a DB row with a colliding key is ignored and flagged in the admin API as `env_shadowed`). Every entry exposes `{key, type, label, start(), callback()}` per KTD7.
2. `GET /v1/auth/methods` is pre-auth (mounted under `/v1/auth/*` which `requireSession` skips) and returns `{password: !AUTH_DISABLE_PASSWORD, providers: [{key,type,label}]}`.
3. `start`: builds `state` (32B b64url), `nonce`, `code_verifier` → S256 challenge; stores each as `HttpOnly; SameSite=Lax; Path=/; Max-Age=600` cookies (`Secure` conditional per R8); validates optional `return_to` (same-origin-relative — an invalid value is **ignored and treated as `/`**, never aborts the flow; the error channel is reserved for provider/state failures) and optional `invite` (opaque token — hashed into the state cookie, never the authorize URL) and `login_nonce` (from the web login page's `dok_login_nonce` cookie) into the state-cookie payload; 302s to `buildAuthorizationUrl`. `redirect_uri` = `${API_BASE_URL}/v1/auth/oauth/{key}/callback`. Request logging must exclude/redact `start`'s query params (`invite`, `return_to`, `login_nonce`) — the invite token is a bearer credential riding a GET and must not land in API/proxy access logs (U9 hardening checklist).
4. `callback`: reads state cookie (missing/mismatch → abort before token exchange), exchanges code — `client.authorizationCodeGrant` for google/oidc with `idTokenExpected`, hand-rolled token+`/user`+`/user/emails` for github — produces `IdentityResult`; hands it to U4's resolver; on success mints an `oauth_codes` row carrying `{purpose, return_to, invite_hash, link_*, login_nonce_hash}` per KTD5 and 302s to `${WEB_URL}/api/auth/callback?code=`; deletes state/nonce/verifier cookies on success AND failure.
5. Failure exits: every non-happy path (state failure, provider `?error=access_denied`, token-exchange failure, `INVITE_REQUIRED`, `LINK_DISABLED`, resolver error) 302s to `{WEB_URL}/login?error=<code>` — the browser never lands on a raw `apiError` JSON blob mid-flow; the code→copy map is shared with U6.
6. `POST /v1/auth/oauth/exchange {code, login_nonce, bootstrap?}`: loads the row by `code_hash`, verifies `login_nonce_hash`, then **dispatches on `purpose` before claiming** — claiming first would burn pending-purpose codes on their discovery read (KTD5). `purpose=login` → atomic claim → session cookie + `{purpose:"login", returnTo, user, workspaceSlug, memberships}`. `purpose=pending-bootstrap`, no `bootstrap` payload → **unclaimed** `200 {purpose:"pending-bootstrap", returnTo}` (the web bootstrap page re-POSTs with the payload); with `{bootstrap:{workspaceSlug, workspaceName, teamKey}}` → atomic claim → creates user+workspace+team+owner in one tx → session. `purpose=pending-link` → **unclaimed** `409 {purpose:"pending-link", context:{pendingEmail, linkProviderKey, linkProviderLabel}}` (handled by `/link`, which performs the claim on success). Claimed/expired code on any path → 410; wrong/missing `login_nonce` → 403; `no-store` on every response.
7. `POST /v1/auth/oauth/link {code, password}` (or a fresh session): verifies the pending-link code (unclaimed so far), authenticates the matched user per **their** credential state — password when `password_hash` is set, else an existing session or re-auth via an already-linked provider (R13 — keying on the global `AUTH_DISABLE_PASSWORD` flag would dead-end JIT users who never set a password), then atomically claims the code and writes `auth_identities` — the link token never mints a session itself.
8. Auth-scoped rate limiter (R16a): one shared middleware mounted inside **each** router serving `/v1/auth/*` — `auth.ts` (`login`, `token`), `oauth.ts` (`exchange`, `link`), `invites.ts` (`accept-invite`, U5) — tight ceilings on `login`, `exchange`, `link`, `accept-invite`; `x-forwarded-for` honored only behind `TRUSTED_PROXY` env.
9. Env parsing: `GITHUB_CLIENT_ID/SECRET` (the planted-but-unread var finally gets read), `GOOGLE_CLIENT_ID/SECRET`, `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_DISPLAY_NAME`/`OIDC_SCOPES`; missing = provider absent; `AUTH_SECRET_KEY` required only when DB providers are enabled; `AUTH_ADMIN_EMAILS` (instance admin, KTD10); `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` (R17); `WEB_URL` (new — API→web origin; `API_BASE_URL` already exists and is reused for `redirect_uri`).
10. Keep provider access/refresh tokens ephemeral — fetch identity, discard (Scope Boundaries).
11. `oauth_codes`/`invites` expiry cleanup: prune-on-claim (`DELETE … WHERE expires_at < now()` in the claim tx) — no sweeper needed, consistent with sessions/tokens having none.

**Test scenarios:**
- `/v1/auth/methods` returns password:true and an empty provider list with no config; lists env-configured providers without secrets; reflects `password:false` under `AUTH_DISABLE_PASSWORD`.
- `start` 302s to the provider authorize URL carrying state/PKCE params and sets the hardened cookies; a `return_to=https://evil.example` is reset to `/` (flow continues, no error); an `invite` param is hashed into the state cookie and absent from the authorize URL; `login_nonce` is carried through; provider scopes on the authorize URL are `read:user user:email` (github) / `openid email profile` (google) / configured+`openid` (oidc).
- Stub-provider round trip: state match → exchange → `oauth_codes` row → 302 with one-time code; `POST /exchange` with matching `login_nonce` mints a real session once; replay → 410; wrong/missing `login_nonce` → 403 (login-CSRF binding).
- Pending-bootstrap code + `{bootstrap:{workspaceSlug,workspaceName,teamKey}}` → workspace+team+owner created atomically → session; missing payload → `200 {purpose:"pending-bootstrap"}` **unclaimed** (the page re-POSTs with the payload — a claim here would burn the code).
- Pending-link code via `/link` with correct password → `auth_identities` row, no session minted; wrong password → 401; first exchange read → `409` with `context.pendingEmail` and the code still live.
- Callback with tampered/missing state → 302 `?error=state`, no token exchange (spy on fetch layer); provider `?error=access_denied` → 302 `?error=denied`; every failure exit lands on the web error path, none emits JSON.
- GitHub resolver maps numeric `id` → subject and `primary && verified` email; `email:null` `/user` falls back to `/user/emails`.
- OIDC resolver honors `email_verified` claim and claim mappings; discovery is cached per provider, not per request.
- `secrets.ts` round-trips AES-256-GCM encrypt/decrypt and rejects a wrong key.
- Auth-scoped limiter: N+1 rapid `exchange`/`login` hits → 429; `x-forwarded-for` spoof ignored without `TRUSTED_PROXY`.

**Verification:** unit tests green for registry/callback/exchange; a live `start` URL against real GitHub OAuth app config manually verified once (deploy doc covers the operator setup).

---

### U4. Identity resolution + JIT + bootstrap rework

**Goal:** The callback's `IdentityResult` becomes a user + membership (or a correct denial) — linking policy, JIT chain, `AUTH_DISABLE_PASSWORD` paths, and bootstrap-via-first-OAuth per R11–R14, R17.

**Requirements:** R11, R12, R13, R14, R17 (KTD2, KTD4)

**Dependencies:** U2, U3

**Files:**
- `apps/api/src/services/identity.ts` (new) — `resolveIdentity(result, ctx) → {user, workspace, memberRole} | {error}` implementing the HTD flowchart
- `apps/api/src/auth/invite-token.ts` (new) — invite token hash/validate helpers shared by the JIT rung here and U5's mint/revoke routes (the JIT chain needs the validate half before `services/invites.ts` exists — putting it in U5 would create a backwards dependency)
- `apps/api/src/routes/oauth.ts` — callback calls the resolver; pending-link branch returns a one-time link challenge instead of a session
- `apps/api/src/routes/auth.ts` — `/v1/auth/login` gated by `AUTH_DISABLE_PASSWORD`; `/v1/auth/bootstrap` 403s `BOOTSTRAP_CLOSED` under `AUTH_DISABLE_PASSWORD` (the OAuth-substitute bootstrap lives wholly in the pending-bootstrap `oauth_codes` → exchange path, R11 — `bootstrap` itself gains no provider variant); global email lookup made deterministic
- `apps/api/src/services/identity.test.ts` (new)

**Approach:**
1. `resolveIdentity` order per HTD: `auth_identities(provider_key, provider_subject)` hit → load user → **invite consumption runs here too** — if `invite_hash` is present in the code context and the user lacks membership in the invite's workspace, run invite acceptance (same tx, same email-binding rules as R18) before workspace selection, otherwise the invite dies silently for exactly the users most likely to receive one → workspace selection below. Miss → verified-email user match → linking policy: `auto` links inline, `login` creates a `purpose=pending-link` `oauth_codes` row carrying `{link_provider_key, link_subject, pending_email}` → callback 302s to the web challenge page → `POST /v1/auth/oauth/link` completes it (R13/U3.7 — pinned mechanism, no "pick in implementation"), `disabled` → `409 LINK_DISABLED` error redirect.
2. No match → JIT chain, every rung gated per R17: invite token (hash compared via `auth/invite-token.ts` from the state-cookie `invite`) — **email-bound** invites additionally require the identity's verified email to equal `invites.email`; **open-link** invites (email NULL) are token-only authorization and the sole unverified-email path → domain match (`hd`, `AUTH_ALLOWED_EMAIL_DOMAINS`, `workspaces.allowed_domains`) requires `emailVerified` → sole-workspace auto-join (flag-gated) requires `emailVerified` → else `?error=invite_required` redirect.
3. Creation runs in one tx: `users` (password_hash NULL) + `auth_identities` + `workspace_members` (+ optional `team_members` when invite names a team) → emit `member_joined` event → session → `purpose=login` `oauth_codes` row.
4. Workspace selection when user has memberships: exactly one → active; several → invite/domain-resolved one else the most recent; `/me` contract returns `memberships` + `activeWorkspaceSlug` for the picker (U6).
5. `AUTH_DISABLE_PASSWORD=1`: `/v1/auth/login` → 403 `PASSWORD_DISABLED`; `/v1/auth/bootstrap` → 403 `BOOTSTRAP_CLOSED` outright — the OAuth-substitute bootstrap lives wholly in the pending-bootstrap `oauth_codes` → exchange path (R11): zero-workspace first OAuth login creates the `pending-bootstrap` row; the web bootstrap-bridge page collects workspace/team names; exchange's `bootstrap` payload completes it atomically (U3.6). Two concurrent first-logins: the second's tx loses the zero-workspace check and falls into the normal JIT path — no double-bootstrap (also fix the same check-then-act race in `/v1/auth/bootstrap` with a serializable guard).
6. Link policy and domain allowlist read from env; per-workspace `allowed_domains` editable via `PATCH /v1/workspaces/:ws {allowedDomains}` (U5.9, owner/admin-gated).
7. All email lookups case-fold to `lower(btrim(email))` (R15a) — login, `/me`, verified-email matching, invite acceptance; post-migration `lower(btrim(email))` unique makes the lookup deterministic (fixes the latent first-row ambiguity).

**Test scenarios:**
- First GitHub login on a sole-workspace install: user + identity + member(auto-join) created in one tx; `member_joined` event row exists; session minted.
- Second provider, same verified email, policy=auto: one user gains a second `auth_identities` row — no duplicate user.
- Same collision under `login` policy → pending-link response, no identity row written; completing the existing-session proof links it.
- Unverified-email provider account (GitHub `email:null`, OIDC `email_verified:false`) never auto-links under any policy → JIT or pending-link only.
- `hd` mismatch with `AUTH_ALLOWED_EMAIL_DOMAINS=corp.io` (user logs `gmail.com`) → `403 INVITE_REQUIRED` unless an invite token is present.
- Invite-token path creates membership in the invite's workspace + team regardless of domain; an **email-bound** invite via JIT rejects a mismatched verified email; an **existing user** (auth_identities hit) carrying `invite_hash` gains the membership instead of the token being dropped.
- Zero-workspace + password-disabled: first OAuth login produces workspace + team + owner + session (bootstrap-substitute flow).
- Policy edge: `AUTH_ACCOUNT_LINKING=disabled` + existing email → `409 LINK_DISABLED`.

**Verification:** identity.test.ts covers the full matrix above; a manual end-to-end pass (stub provider or real GitHub app) confirms the browser flow lands on `/my-issues`.

---

### U5. Admin API: members, invites, provider CRUD

**Goal:** The admin surface U7's UI and agents consume — member list/roles, link invites, provider management + test, per R18–R20 and the U7 inputs.

**Requirements:** R18, R19, R20, plus admin inputs for R2, R9 (KTD3, KTD6)

**Dependencies:** U2, U4

**Files:**
- `apps/api/src/routes/members.ts` (new) — `GET /workspaces/:ws/members`, `PATCH /workspaces/:ws/members/:id` (role), `DELETE /workspaces/:ws/members/:id` (with last-owner guard)
- `apps/api/src/routes/invites.ts` (new) — `POST/GET/DELETE /workspaces/:ws/invites`, `POST /v1/auth/accept-invite` (public)
- `apps/api/src/routes/providers.ts` (new) — `GET/POST/PATCH/DELETE /v1/auth/providers`, `POST /v1/auth/providers/:id/test` (discovery/connectivity probe — instance scope per KTD10, NOT `/workspaces/:ws/*`)
- `apps/api/src/routes/workspaces.ts` — `PATCH /v1/workspaces/:ws {allowedDomains}` (owner/admin — the only write path for `workspaces.allowed_domains`, which R17's domain rung and U4.6 depend on)
- `apps/api/src/services/invites.ts` (new) — token mint/revoke/list (reusing U4's `auth/invite-token.ts` hash/validate helpers — same `dok_`-style opaque pattern)
- `apps/api/src/routes/{members,invites,providers}.test.ts` (new)
- `apps/api/src/index.ts` — route registration
- `tools/e2e/global-setup.ts` — replace the raw-SQL second-user insert with the real invite path

**Approach:**
1. `/workspaces/:ws/*` admin routes run `requireWorkspace` + `requireRole('admin')`; `GET members` allows any member (including read-scoped PAT/agent) since assignee resolution needs it (R19). **Every `:id` row lookup is filtered by the resolved `ws.id`** — a member/invite id from another workspace returns 404 (consistent with the slug-oracle decision), never crosses workspaces; invite `team_id` must belong to the invite's workspace.
2. `DELETE /members/:id`: refuses last-owner removal (`LAST_OWNER`); deleting an **owner** row additionally requires the caller to be an owner; deleting emits `member_left`; the removed member's credentials die on next request per R15 (verified in U2 tests — assert here too).
3. `PATCH /members/:id` role transitions per R18's matrix: setting `role=owner` or modifying an **owner** row requires caller-is-owner; admins may only assign `member|admin` and only modify non-owner rows (otherwise an admin self-grants owner — the invite-side cap is meaningless if PATCH is open); last-owner demotion guard; emits `member_role_changed`.
4. Invites: `POST` mints opaque token (sha256 at rest), optional `email` + `role` (enum `member|admin` — `owner` rejected 422) + `team_id` (must belong to this workspace — 422 otherwise), `expires_at` default 7d, returns the join URL (`{WEB_URL}/join/{token}`); emits `invite_created`; revoke emits `invite_revoked`.
5. `POST /v1/auth/accept-invite`: lives under `/v1/auth/` so it self-resolves the presented credential server-side per R16a (cookie session or PAT — never a body `userId`); enforces `invites.email == user.email` when email-bound; claims atomically (`accepted_at` IS NULL guard) and inserts the member row + optional team row + `member_joined` event in one tx. Two caller shapes: **authenticated** → membership for the resolved user; **unauthenticated with `{name, password}` on a password-enabled install** → creates user + member + session atomically (R18c — the only onboarding path on a default install: no provider, no register route, bootstrap closed).
6. Provider routes mount under `/v1/auth/providers` (instance scope, NOT `/workspaces/:ws/*`) gated by cookie session + instance-admin check (KTD10/R22: `AUTH_ADMIN_EMAILS` match on verified-provenance email, or bootstrap-owner fallback when the var is unset): `POST` validates type-required fields (oidc needs `issuer`), requires **https on all configured endpoints** (issuer + manual overrides — 422 otherwise), encrypts `client_secret`; `PATCH` secret write-only; responses mask secrets; `POST /:id/test` probes discovery (oidc/google) or authorize endpoint (github) with egress constraints — https-only, **dials the validated IP** (no check/connect gap), every redirect hop re-checked against loopback/private/link-local/metadata ranges, size+time capped, no secret in the error path; the runtime OIDC discovery/JWKS/token fetches get the same treatment. Provider CRUD emits `provider_created`/`provider_updated`/`provider_deleted` (R20).
7. Env-shadowed provider keys are listed with `source: "env"` and reject mutations with `409 ENV_SHADOWED`.
8. Update `openapi.json` entries for all new routes (hand-maintained — repo convention).
9. `PATCH /v1/workspaces/:ws {allowedDomains}` — owner/admin-gated array write for the R17 domain-match rung.

**Test scenarios:**
- Members list returns id/name/email/role to a member, a PAT, and an agent key; role-write endpoints 403 for member role, PAT (non-cookie), and agent keys; a `:id` belonging to another workspace → 404 (no cross-workspace mutation); admin `PATCH` to `role=owner` or on an owner row → 403, owner caller → allowed.
- Invite lifecycle: create → accept via second user → member row + `member_joined` event; single-use rejects replay (atomic claim — concurrent accepts yield exactly one member row); expired/revoked/wrong-workspace tokens rejected; email-bound invite rejected for a mismatched user email; `owner` role invite → 422 at create; `team_id` from another workspace → 422; **unauthenticated `{name, password}` claim on a password-enabled install → user + member + session created**; accepting while logged out with no credentials claim → 401; accepting with a body `userId` different from the credential's → 403/ignored.
- Last-owner remove/demote → `409 LAST_OWNER`.
- Provider CRUD requires instance admin — a workspace owner not in `AUTH_ADMIN_EMAILS` gets 403; the **bootstrap owner on an env-unset install** gets 200; stores `client_secret` encrypted, masks on read; `test` reports discovery reachability and refuses `http://`, private-IP, and metadata-range issuers; create/patch with an `http://` endpoint → 422; env-defined provider rejects `PATCH` with `ENV_SHADOWED`; provider CRUD emits `provider_*` events.
- OIDC provider created via API shows up in `GET /v1/auth/methods` and its `start` route redirects (provider registry is shared).
- e2e global-setup uses `POST /invites` + accept instead of raw SQL user insert.

**Verification:** new suites green; `pnpm --filter @docketry/api test` overall; openapi.json includes every new path.

---

### U6. Web auth UX: provider buttons + OAuth bridge

**Goal:** Login renders providers and the OAuth callback lands on the web origin — R10, R11, R21, R23.

**Requirements:** R10, R11, R21, R23 (KTD5)

**Dependencies:** U3, U4, U5

**Files:**
- `apps/web/app/(auth)/login/page.tsx` — fetch `/api/auth/methods` (bridge), render provider buttons + conditional password form; accepts a `return_to`/`next` param (validated same-origin-relative) that both the password path and provider `start` links honor — the join flow needs it to round-trip the invite
- `apps/web/app/api/auth/methods/route.ts` (new bridge) — **route handler**: sets `dok_login_nonce` (HttpOnly, SameSite=Lax, ~10min, issued once — not rotated per fetch) AND returns `{password, providers, loginNonce}` so the client embeds the value in `start` links; also builds each provider's `startUrl` from `NEXT_PUBLIC_API_URL` (the browser-reachable public origin — `API_URL` in `lib/api.ts` resolves to `API_INTERNAL_URL` on compose, a docker hostname browsers cannot reach)
- `apps/web/app/api/auth/callback/route.ts` (new) — exchanges one-time code (with `login_nonce` from the cookie), replays `set-cookie`, branches on the exchange response's `purpose`
- `apps/web/app/(auth)/join/[token]/page.tsx` (new) — accept-invite landing: logged in → accept → workspace; logged out → password-enabled installs show a `{name, password}` claim form (R18c) or `/login?return_to=/join/{token}` for existing users; OAuth-configured installs route through `start` with `invite` carried
- `apps/web/app/(auth)/link/page.tsx` (new) — pending-link challenge: "sign in as {email} to connect this {provider} account" → `POST /api/auth/link` → `POST /v1/auth/oauth/link`
- `apps/web/app/api/auth/link/route.ts` (new bridge)
- `apps/web/app/api/login/route.ts` — accept + forward `return_to`/`next` (same-origin-relative validated) so password login lands back on the join page instead of the hardcoded `/my-issues`
- `apps/web/app/(auth)/workspaces/page.tsx` (new) — chooser listing `memberships`, calls `POST /v1/auth/session` + sets `dok_ws` — lives under `(auth)`, not `(app)` (the app shell renders Sidebar/CommandPalette bound to `workspaceSlug`, which is exactly what's missing here)
- `apps/web/app/api/auth/session/route.ts` (new bridge)
- `apps/web/middleware.ts` — `PUBLIC_PATHS` gains `/join`, `/link` (NOT `/api/auth/callback` — middleware already passes all `/api/*`; adding it is dead config); `/workspaces` is session-gated but exempt from active-workspace resolution (it's the page that *resolves* the workspace — under `(auth)`)
- `apps/web/lib/session.ts` — `dok_ws` resolution extended for multi-membership; `forwardSessionCookies` propagates `secure` in production (inherited bug: it strips `Secure` from the web-origin session cookie today)
- `apps/web/app/(auth)/bootstrap/page.tsx` — pending-bootstrap mode: when `/api/auth/callback` sees `purpose=pending-bootstrap`, render this page to collect workspace/team names then POST exchange with `{code, bootstrap:{workspaceSlug, workspaceName, teamKey}}`
- `apps/web/lib/api.ts` — surface `memberships`/`activeWorkspaceSlug`/`isInstanceAdmin` from `/me`; treat error-envelope `data` as non-auth (today `data = {error}` is truthy and renders a broken shell — the zero-membership/removed-member bounce in R15 depends on this)
- `apps/web/components/workspace-chooser.tsx` (new)

**Approach:**
1. `/login` calls the bridge → `{password, providers, loginNonce}`; the bridge sets `dok_login_nonce` (HttpOnly — client JS can't); provider buttons link to the bridge-provided `startUrl` (`{NEXT_PUBLIC_API_URL}/v1/auth/oauth/{key}/start?return_to=&login_nonce=<nonce>` — full-page navigation, never `API_INTERNAL_URL`). On methods-fetch failure/timeout, render the password form **optimistically** with a "sign-in providers unavailable" note — a wrong default of `password:false` would render a login card with no way to log in.
2. `/api/auth/callback` (web route): reads `code` → `POST /v1/auth/oauth/exchange {code, login_nonce}` server-side → `purpose=login` → `forwardSessionCookies` replays `dok_session` onto the web jar (with `secure` fixed) → resolve `dok_ws` (response slug or chooser redirect when >1 membership) → 302 `returnTo` from the exchange response (validated same-origin); `purpose=pending-bootstrap` → bootstrap page collects names → re-POST exchange with `{code, bootstrap}` payload; `purpose=pending-link` → redirect to `/link?code=`; used/invalid code → error view → `/login`.
3. `/workspaces` chooser (under `(auth)`): renders `memberships` → `POST /v1/auth/session {slug}` → set `dok_ws` → redirect. Keeps `me.activeWorkspaceSlug` and `dok_ws` in agreement per R23.
4. Join page: authed → `POST /v1/auth/accept-invite` → set `dok_ws` → redirect board; unauthed on a password-enabled install → `{name, password}` claim form (R18c) or `/login?return_to=/join/{token}` for existing users (the `/api/login` bridge forwards `return_to`); on OAuth-configured installs → `start` with `invite={token}` carried (the JIT chain reads it from the state cookie).
5. `/link` challenge page: explains the account-link (rendering `pendingEmail`/`linkProviderLabel` from the exchange context), offers password login when the matched user has a `password_hash` (or "continue with your existing provider" otherwise — re-auth through an already-linked provider) → `POST /v1/auth/oauth/link` → success → back to provider `start` (now `auth_identities` resolves).
6. `AUTH_DISABLE_PASSWORD`: bridge reports `password:false` → password form hidden; `/link` offers session-auth path only.
7. Error copy map: `?error=` codes (`state`, `denied`, `exchange`, `invite_required`, `link_disabled`, `no_workspace`, `auth`) → readable strings on `/login`.

**Test scenarios:**
- Login page with zero providers renders password-only; with providers renders buttons linking to the bridge-provided `startUrl`s (public origin, `login_nonce` present); `password:false` hides the form; a failed methods fetch still renders the password form.
- `/api/auth/callback` happy path: code+nonce → session cookie on web origin → lands `/my-issues`; used/invalid code → error view, no cookie; wrong nonce → exchange 403 → error view.
- OAuth error (denied consent, state failure) surfaces a readable message on `/login`, not a stack trace.
- Pending-link: code → `/link` → password auth → `auth_identities` written → subsequent provider login succeeds; a matched user with no `password_hash` completes via session/re-auth through an already-linked provider (not a dead end).
- Pending-bootstrap: code → bootstrap page → names → exchange with payload → session + lands in the new workspace.
- Join flow: invite URL → unauthed on password install → `{name,password}` claim or `/login?return_to=/join/{token}` → membership; unauthed on OAuth install → `start` with `invite` param → JIT consumes invite → member of the invite's workspace; **existing OAuth user** clicking the link → logged in → membership via the hit-path consumption (U4.1); authed → straight through.
- Multi-membership user without `dok_ws` sees the chooser and lands in the picked workspace; `/me.activeWorkspaceSlug` and `dok_ws` agree afterwards.
- Removed member mid-session: next request → API 403 → remaining memberships > 0 → `/workspaces` chooser; zero memberships → `/login?error=no_workspace` (never a silently empty board).

**Verification:** manual browser pass on the dev stack (github OAuth app from docs/auth.md) plus existing e2e `storageState` login unchanged (password path must keep working when enabled).

---

### U7. Settings admin UI

**Goal:** The first settings surface — members, invites, auth providers — per R22 and the guided-setup decision (KD1/KTD9).

**Requirements:** R22, R9, R2 (KD1)

**Dependencies:** U5

**Files:**
- `apps/web/app/(app)/settings/{page,members/page,invites/page,providers/page}.tsx` (new)
- `apps/web/app/api/settings/{members,invites,providers}/*` bridge routes (new)
- `apps/web/components/{member-list,invite-form,provider-form}.tsx` (new)
- `apps/web/components/sidebar.tsx` + `components/global-nav.tsx` + `components/keymap-overlay.tsx` + `components/command-palette.tsx` — settings nav entry bound to **`g ,`** (decided: `g s` is already bound to Insights in all four surfaces — stealing it regresses an existing shortcut; all four hint surfaces update together)
- `apps/web/lib/colon-commands.ts` — `:assign` gains `member` resolution via `GET /members` (the assignee pain named in the problem frame — the endpoint exists for this)
- `apps/web/app/(app)/layout.tsx` — carry `memberRole` into nav (hide settings for non-admin)

**Approach:**
1. Settings section under `(app)` with three pages following existing page conventions (server component fetches via `lib/api.ts` bridge → client components for forms/tables).
2. Members page: table (name, email, role select, remove) — role select + remove hit U5 routes honoring R18's transition matrix (owner-row changes and `role=owner` grants are owner-only); last-owner guard errors surface via the API envelope pattern. **Non-admin members get the roster read-only** — table visible, role/remove controls hidden (matches R19's any-member read; a member should be able to see who else is on the team).
3. Invites page: create form (optional email/role/team) → renders join URL with copy button; list of pending invites with revoke. Destructive actions get a named confirm dialog.
4. Providers page (visible when `/me.isInstanceAdmin` — R22's signal, NOT `memberRole`; a workspace owner who isn't instance admin sees a locked state per KTD10): list (`key`, `type`, `label`, `enabled`, `source: env|db` badge) + add form per type (github: client id/secret; google: client id/secret; oidc: issuer + client + scopes + claim map incl. `email_verified`/`hosted_domain`) + test-connection button hitting `POST /v1/auth/providers/:id/test`; env-sourced rows render read-only with a "configured by environment" note; secrets are write-only ("leave blank to keep"). **Provider delete gets consequence copy** ("users who only sign in via {label} will lose access") and a block when it is the last enabled provider or `AUTH_DISABLE_PASSWORD=1` — deleting it would lock the whole instance out.
5. Non-admin sessions: nav hides settings; direct URL hits get the 403 envelope → render a friendly "requires admin" state (web checks `memberRole`/`isInstanceAdmin` from `/me`).
6. `:assign KEY <member>` resolves member names/emails against `GET /members` — the first time a human can assign an issue to another human in the UI (R19's purpose).

**Test scenarios:**
- Admin sees settings nav and all three pages render their data; member role hides nav and a direct settings URL shows the 403 state; a member on `/settings/members` sees the roster read-only.
- Instance admin (env allowlist or unset-env bootstrap owner) sees the providers page; workspace owner alone sees the locked state.
- Add-provider form validates required fields per type and masks the secret on reload; env-shadowed provider shows the badge and rejects edits; delete on the last enabled provider is blocked with consequence copy.
- Invite form produces a working join URL end-to-end (accept → member); `:assign KEY <member>` resolves and assigns to a human member.
- Test-connection button reports reachable/error states from the API.

**Verification:** `pnpm typecheck` + `pnpm lint` green; manual pass at `/settings/providers` adding a stub provider; axe-clean per the existing a11y spec pattern (add the new pages to it).

---

### U8. Agent parity: MCP, whoami, openapi, events

**Goal:** Agents can observe and act on the new surface where appropriate — `list_members`, membership-aware whoami, docs/openapi parity, membership events — per R19, R20, R24, R25.

**Requirements:** R19, R20, R24, R25 (KTD6)

**Dependencies:** U5

**Files:**
- `apps/mcp-server/src/tools.ts` — `list_members` tool (workspace-scoped read)
- `apps/mcp-server/src/tools.test.ts`
- `apps/api/src/routes/whoami.ts` — response gains `memberships: [{workspaceId, slug, role}]`
- `apps/api/src/routes/events.ts` — `member_*` event actor rendering (verify join works for member rows)
- `apps/api/src/openapi.ts` — entries for all new endpoints (methods, oauth, members, invites, providers)
- `docs/agents.md`, `docs/mcp.md` — credential rules + new tool + minting-role change
- `tools/cli/` — optional `dok members` (defer if it strains scope; record under Deferred)

**Approach:**
1. `list_members` mirrors the other read tools: workspace + optional team filter, paginated, returns id/name/email/role — same data `GET /members` returns (shared serializer).
2. `/v1/whoami` adds `memberships` (from `workspace_members`) and `role` for the bound workspace; agent-key responses stay unchanged shape plus their bound workspace.
3. Member events: `member_joined|left|role_changed` rows with `actor_type`/`actor_id` resolution — events route joins users on `actor_type='human'` already; verify no regression.
4. Openapi + docs stay hand-maintained per repo convention; the "who can mint agent keys" section in docs/agents.md updates to owner/admin.
5. Agent-key invariant tests: `dok_agt_` gets 403 on member-write, invite, provider, mint, and workspace-create routes; read access to `GET /members` allowed (assignee resolution).

**Test scenarios:**
- MCP `list_members` through the passthrough endpoint returns members for the caller's workspace; another workspace is unreachable.
- `whoami` as PAT reports role + memberships; as agent key reports bound workspace + agent identity only.
- `member_joined` appears on the events feed with actor name resolved; `list_events` MCP sees it.
- Agent key → `POST /invites`, `POST /tokens`, `POST /workspaces`, `DELETE /members/:id` all → 403.
- openapi.json paths match the implemented routes (lint-check style test or manual diff).

**Verification:** MCP tools suite + whoami assertions green; docs diff reviewed against actual behavior.

---

### U9. Env surface + docs

**Goal:** Every new var documented and wired through deploy surfaces; `docs/auth.md` exists; compose/env.example/CONTRIBUTING stay truthful per R9–R12.

**Requirements:** R9, R10, R11, R12 (KTD3)

**Dependencies:** all

**Files:**
- `apps/api/src/env.ts` — new keys in the grouped convention
- `.env.example` — provider blocks + auth flags
- `docker-compose.selfhost.yml` — passthrough for new vars
- `docs/auth.md` (new) — provider setup guides (GitHub OAuth app, Google consent screen, generic OIDC discovery), callback URL formats, linking/JIT/env-vs-DB semantics, `AUTH_DISABLE_PASSWORD` operations
- `docs/deploy.md` — env table rows + bootstrap narrative + hardening checklist
- `docs/security-review.md` — authn/authz/multi-tenancy sections re-walked for the new model
- `docs/agents.md`, `docs/mcp.md`, `README.md`, `CONTRIBUTING.md` — staleness fixes (`AUTH_SECRET` mention, minting roles, invite note)
- `argus-reviewer.config.ts` is untouched (CI surface unchanged)

**Approach:**
1. New env keys follow the flat `config_` + SCREAMING_SNAKE + grouped-banner convention: `WEB_URL`, `AUTH_SECRET_KEY`, `AUTH_ADMIN_EMAILS`, `AUTH_DISABLE_PASSWORD`, `AUTH_ACCOUNT_LINKING`, `AUTH_ALLOWED_EMAIL_DOMAINS`, `AUTH_AUTO_JOIN_SINGLE_WORKSPACE`, `TRUSTED_PROXY`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/DISPLAY_NAME/SCOPES`. **`API_BASE_URL` is reused, not duplicated** — `APP_BASE_URL` was considered and dropped (two public-origin vars that must agree is a misconfiguration trap; `github.ts` already derives URLs from `API_BASE_URL`).
2. `.env.example` documents each with the same grouping; compose adds `${VAR:-}` passthrough lines; deploy.md table gets a row per var and a "SSO setup" walkthrough.
3. `docs/auth.md` is the operator doc — per-provider console steps (GitHub OAuth App callback `https://<host>/v1/auth/oauth/github/callback` + scope `read:user user:email`, Google consent + redirect, generic OIDC discovery), the linking policy table, JIT order, env-vs-DB precedence, secret encryption note, `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` open-door warning, a note that IdPs emitting no `email_verified` claim operate invite-only, `AUTH_SECRET_KEY` rotation semantics (rotating or losing it renders every DB-stored `client_secret` undecryptable — re-enter secrets via the providers UI; no key-versioned envelope in v1), the `AUTH_ADMIN_EMAILS` unset→bootstrap-owner fallback, and the troubleshooting list (iss trailing-slash, SameSite loop, clock skew).
4. `docs/deploy.md` gains the migration-runbook entry for this release: **pre-deploy `pg_dump` gate** (0019 is the point of no return — rollback = restore), single-instance upgrade window (old code post-0019 is dead, not degraded — drizzle selects enumerate `users.workspace_id`), the journal-drift reconcile procedure for installs that applied a retagged migration, and a hardening-checklist line that request logging must redact `start`/callback query params (`invite`, `return_to`, `login_nonce`, `code`) — bearer credentials ride those GETs.
5. security-review.md gets a re-walk: membership enforcement, credential minting gates, OAuth hardening inventory, invite token model, the `/v1/auth/*` middleware-skip + in-router limiter, and the workspace-slug oracle (404-vs-403 enumeration — documented, accepted: slugs aren't secrets and mitigating leaks more than it prevents).

**Test scenarios:**
- `docs/deploy.md` env table covers every new `.env.example` key (script-check or manual diff).
- `docker compose config` renders with the new vars absent (defaults) and set.
- docs/auth.md callback URLs match the implemented routes (`/v1/auth/oauth/{key}/callback` — verify against the registered routes, not memory: the repo already has one callback-URL doc drift bug on github.ts).

**Verification:** doc-diff completeness; a fresh-compose stranger walkthrough using only docs/auth.md.

---

## System-Wide Impact

The surfaces this change touches and what each inherits:

- **`/v1/auth/*` middleware skip (load-bearing).** `authRoutes` mounts before `requireSession`/`rateLimiter` in `index.ts`, so every new endpoint under the prefix self-resolves credentials and gets no global throttle — R16a puts the auth-scoped limiter inside the routers and bans client-supplied user ids. `/v1/auth/login` is unthrottled today; this fixes that too.
- **`requireWorkspace` (~80 call sites).** One choke point becomes the per-credential-class boundary (KTD4). Every workspace route inherits the roam/bound matrix without per-route edits; behavior changes only for sessions held by multi-workspace users and removed members.
- **Every FK'd + actor reference to `users.id`.** Three FK'd columns (sessions, user_tokens, views) + four un-FK'd actor pairs (issues creator/assignee, comments, events) all re-point in the merge — the complete enumeration lives in U1 step 9 because missing one is silent attribution corruption.
- **Web bridge surfaces.** Server-rendered pages read `me.workspaceSlug`; bridge routes read `dok_ws` — two sources of truth that must agree after any workspace switch (R23's chooser + session re-bind keeps them aligned); `forwardSessionCookies` regains `Secure` in production.
- **Credential-issuing routes.** `POST /agents`, `POST /tokens`, `POST /workspaces` gain the cookie+role gate; agent keys' existing "cannot mint" invariant extends to invites/providers.
- **Events feed.** `member_*` events join the feed; `x-actor-*` provenance is constrained to agent keys before they land (U2.8).
- **e2e + test harness.** `global-setup.ts` stops SQL-inserting users once invite APIs exist; ~12 wipe lists gain the new tables in FK order.
- **Boot path.** `migrate()` runs under `pg_advisory_lock`; old code against a post-0019 DB is dead (not degraded) — deploy doc carries the single-instance window + pg_dump gate.

## Risks

| Risk | Decision |
|---|---|
| `0019` dedupe destroys user rows irreversibly | Mitigated: snapshot-in-`user_id_map` + re-point-before-delete (U1.9); `pg_dump` pre-deploy gate in deploy docs (U9.4); single-instance upgrade under advisory lock |
| Login CSRF via the one-time-code bridge | Mitigated: `login_nonce` binding through `oauth_codes` (R21/KTD5); atomic claim; `no-store` both legs |
| Email-based account takeover (nOAuth class) | Mitigated: subject-keyed identities + verified-email-only linking/JIT (R13/R14/R17); unverified email can only ride an invite token, which is itself authorization |
| Open-link invite leaks → unintended member | Mitigated: email-bound invites enforce `email == user.email` (R18); open links are single-use atomic claims; `owner` is never invite-issuable |
| Sole-workspace auto-join = open membership on public installs | Accepted with flag: `AUTH_AUTO_JOIN_SINGLE_WORKSPACE` default-on for the self-host persona, deploy doc warns to disable on internet-facing installs (R17) |
| Provider `test`/discovery is an SSRF dial | Mitigated: instance-admin authority (KTD10) + https-only + private/metadata-IP block + caps (R22) |
| Old instance code post-0019 → auth outage | Accepted: drizzle selects enumerate `users.workspace_id` against a dropped column; deploy doc mandates single-instance window (U9.4) |
| Workspace-slug enumeration via 404-vs-403 | Accepted + documented: slugs aren't secrets; equalizing responses leaks more than it prevents (U9.5) |
| `/v1/auth/*` unthrottled (inherited) | Mitigated in-plan: in-router auth limiter + trusted-proxy fix (R16a) |
| `x-actor-*` provenance forgery (inherited) | Mitigated in-plan: actor id always derived from the credential; `agent`/`system` types rejected for sessions (U2.8) |
| `forwardSessionCookies` drops `Secure` (inherited) | Fixed in U6 |
| Roaming cookie sessions widen a stolen session's blast radius to every workspace the user belongs to | Accepted + weighed: bound-session-with-switch was the alternative; roaming is the multi-workspace UX the product wants (Linear parity), and per-request membership checks still kill removed-member sessions instantly (KTD4) |
| `POST /v1/workspaces` open to any cookie session → workspace sprawl on shared installs | Accepted self-host posture: deliberate (any member can spawn a workspace and own it); a gate env is a coherent follow-up if multi-tenant-shared installs appear |
| In-router auth limiter is convention, not middleware — a future `/v1/auth/*` route can silently re-open the unthrottled hole | Mitigated: R16a names the per-router mount as a requirement and U9's security-review re-walk + openapi lint cover new routes |

---

## Verification Contract

- `pnpm --filter @docketry/api test` — serial vitest against real Postgres; covers migration (U1), role matrix (U2), provider/OAuth units (U3, U4), admin API (U5), whoami (U8). Fresh DB per run (`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/docketry_auth_test`).
- `pnpm --filter @docketry/mcp-server test` — `list_members` tool coverage (U8).
- `pnpm typecheck && pnpm lint` — repo-wide.
- `pnpm --filter @docketry/e2e test` — existing specs pass; a11y spec extended to `/settings/*` (U7) plus `/login`, `/join`, `/link`, `/workspaces` under an unauthenticated context (the existing spec only visits authed pages via `storageState` — the new public pages need their own lane); `global-setup.ts` uses the real invite path (U5).
- `pnpm --filter @docketry/web build` — new pages/routes compile.
- Manual OAuth round-trip on the dev stack: GitHub OAuth App per `docs/auth.md` → `/login` button → consent → lands on board as member.
- Migration rehearsal: dump of a populated dev DB → `0018`+`0019` → verify `user_id_map`, members backfill, and a live session surviving.

## Definition of Done

- Global: all new env vars in `.env.example` + deploy table + compose passthrough; `openapi.json` covers every new route; `docs/auth.md` operator walkthrough exists; no route introduced under `/v1/` that skips the membership check unintentionally; every test wipe list includes the new tables.
- Per unit: its test scenarios are written and green; `typecheck`/`lint` clean; new tables/routes registered.
- Behavior gates: removed member's credentials 403 immediately; unverified email never auto-links; agent keys cannot mint credentials/invites/workspaces; `AUTH_DISABLE_PASSWORD` leaves no password surface; bootstrap works in both password and provider-only modes.
- Cleanup: no abandoned alternative implementations (e.g., arctic stubs, half-wired provider types), no dead `users.workspaceId` references, no placeholder TODOs left in the diff.
