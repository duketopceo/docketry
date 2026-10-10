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

## Self-host

From clone to a working board in <10 minutes:

```bash
git clone https://github.com/duketopceo/docketry && cd docketry
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF
docker compose -f docker-compose.selfhost.yml up -d
# → http://localhost:3100 → /bootstrap → board
```

Full guide — env reference, Cloudflare Tunnel, Railway, upgrades, backups:
[docs/deploy.md](./docs/deploy.md).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the local `pnpm check` gate, and conventions. Security reports: [SECURITY.md](./SECURITY.md). Licensed under [MIT](./LICENSE-MIT).

## Docs

- [AGENTS.md](./AGENTS.md) — agent entry point and repo conventions
- [DESIGN.md](./DESIGN.md) — design contract
- [docs/agents.md](./docs/agents.md) — onboard an AI agent (keys, MCP, CLI)
- [docs/mcp.md](./docs/mcp.md) — MCP server reference
- [docs/deploy.md](./docs/deploy.md) — self-host guide
- [SKILL.md](./SKILL.md) — board rules for agents working the tracker
- [plans/](./plans/) — implementation plans
