# syntax=docker/dockerfile:1
# docketry MCP server — Streamable HTTP endpoint for hosted/multi-tenant
# use (Klavis Strata, gateways). Runs `--http`; credentials arrive per
# request via headers in passthrough mode.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/package.json
COPY apps/mcp-server/package.json apps/mcp-server/package.json
# manifest-only: deploy resolves the devDep workspace link (tests use the api app)
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @docketry/mcp-server...

COPY packages/types packages/types
COPY apps/mcp-server apps/mcp-server
RUN pnpm --filter @docketry/types build && pnpm --filter @docketry/mcp-server build
RUN pnpm deploy --legacy --filter @docketry/mcp-server --prod /out

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
EXPOSE 3101
# passthrough mode (no DOCKETRY_TOKEN/WORKSPACE) = per-request header creds;
# set the env pair for a single-tenant self-host endpoint instead
CMD ["node", "dist/index.js", "--http"]
