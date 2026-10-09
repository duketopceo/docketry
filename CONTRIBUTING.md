# Contributing to docketry

Thanks for helping build docketry — a self-hostable, agent-native issue tracker where humans and AI agents work the same board. This document covers setup, the local quality gate, and the conventions that keep the repo consistent.

## Setup

Requirements: Node.js, pnpm 10, and Docker (for Postgres + Redis).

```bash
git clone https://github.com/duketopceo/docketry
cd docketry
pnpm install
cp .env.example .env
docker compose up -d   # Postgres on :5432, Redis on :6380
pnpm dev               # turbo dev — web + api + workers
```

Fill in `.env` values as needed for the integrations you are touching — the core app only needs `DATABASE_URL`, `REDIS_URL`, and `AUTH_SECRET`.

## The check gate

There is no GitHub Actions CI on this repo — the quality gate is local. Before opening or updating a PR, run:

```bash
pnpm check   # turbo run typecheck lint test
```

All three must pass. If your change needs a database, `docker compose up -d` first.

## Testing against real Postgres

Tests run against a real Postgres database — do not mock the database layer. Use the Postgres instance from `docker-compose.yml` (or an equivalent test database) and write tests that exercise actual queries and migrations.

## Conventions

- **TypeScript strict everywhere; no `any`.**
- **Conventional-commit PR titles.** Title every PR `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` (etc.) — e.g. `feat: add issue activity feed`. Squash merge means the PR title becomes the commit message.
- **Merge policy:** all changes to `main` go through a pull request with at least one approving review. No direct pushes, no self-merge without review.

## Work orders

Larger pieces of work are tracked as **work orders** — GitHub issues using the *Work order* template, titled with a conventional-commit prefix (`feat:`, `fix:`, `chore:`), with two required sections:

- `## Acceptance criteria` — a checkbox list that defines done
- `## Blocked by` — dependencies on other issues, or `None`

If you are picking up work, look for issues labeled `work-order`. If you are proposing work, file it in that format so it is unambiguous when complete.

## License

docketry is MIT-licensed. There is no CLA and no DCO — by submitting a contribution you agree it is provided under the terms of the existing [MIT license](./LICENSE-MIT). That's it.

## Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Report conduct issues to conduct@docketry.dev.
