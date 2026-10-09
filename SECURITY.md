# Security Policy

## Supported Versions

docketry is pre-v1.0 and under active development. Only the latest `main`
branch receives security fixes — there are no supported release lines yet.
Self-hosters should track `main` (or pin to a recent commit and upgrade
promptly when a fix lands).

| Version      | Supported |
| ------------ | --------- |
| `main` (tip) | Yes       |
| anything else| No        |

## Reporting a Vulnerability

**Preferred:** use [GitHub private vulnerability reporting](https://github.com/duketopceo/docketry/security/advisories/new)
("Report a vulnerability" on the Security tab). This opens a private advisory
where we can discuss, develop a fix, and coordinate disclosure without exposing
details publicly.

**Fallback:** if private reporting is unavailable, email security@docketry.dev.
Include a description, reproduction steps, and affected components. Do not open
a public issue for security reports.

### What to expect

- **Acknowledgement within 72 hours** of your report.
- A triage decision (accepted / needs-more-info / declined with reasoning) as
  soon as we can reproduce or rule out the issue.
- If accepted: a fix developed in the private advisory, merged to `main`, and a
  published security advisory crediting you (unless you prefer otherwise).
- We ask for coordinated disclosure — please give us reasonable time to ship a
  fix before publishing details.

## Scope

docketry is **self-hosted software**. Keep this in mind when reporting:

- **In scope:** vulnerabilities in docketry's code — the web app (`apps/web`),
  API (`apps/api`), MCP server (`apps/mcp-server`), dispatch worker, and CLI —
  and in the default configuration we ship (docker-compose, auth flows,
  webhook handling, secret handling in the codebase).
- **Out of scope:** issues in your own deployment — your infrastructure,
  reverse proxy, TLS termination, network exposure, or how you configured
  third-party integrations. Also out of scope: vulnerabilities in upstream
  dependencies without a demonstrated exploit path through docketry (report
  those upstream), and denial-of-service vectors that require already-trusted
  access.

### Credentials and secrets

- Never commit secrets. `.env` is gitignored; `.env.example` documents the
  required variables with empty values only.
- If you find a leaked credential (in a commit, issue, log excerpt, or your own
  report), redact it and report it privately via the channels above — do not
  paste live secrets into the report itself.
- If you discover that docketry logs, stores, or transmits credentials in
  plaintext or with insufficient protection, that is a reportable
  vulnerability.
