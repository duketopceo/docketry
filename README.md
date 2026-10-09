# docketry

> A self-hostable, agent-native issue tracker — Linear-class UX, MIT-licensed, built so humans and AI agents work the same board

## Stack

- **Monorepo:** pnpm workspaces + Turborepo, all TypeScript (strict)
- **Web:** Next.js App Router + Tailwind CSS + shadcn/ui + cmdk (`apps/web`)
- **API:** Node + Hono + Postgres via Drizzle (`apps/api`)
- **MCP server:** Model Context Protocol server for AI agents (`apps/mcp-server`)
- **Dispatch:** agent-routing worker on BullMQ (`services/dispatch`)
- **CLI:** `docketry` command-line tool (`tools/cli`)
- **Shared packages:** `packages/ui`, `packages/types`, `packages/config`
- **Infra:** Docker Compose (Postgres + Redis) for dev and self-host

## Local Setup

```bash
git clone https://github.com/duketopceo/docketry
cd docketry
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

## Deploy

Docker Compose self-host — see docs/deploy.md (planned).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the local `pnpm check` gate, and conventions. Security reports: [SECURITY.md](./SECURITY.md). Licensed under [MIT](./LICENSE-MIT).

## Docs

- [AGENTS.md](./AGENTS.md) — agent entry point and repo conventions
- [DESIGN.md](./DESIGN.md) — design contract (planned)
- [plans/](./plans/) — implementation plans
