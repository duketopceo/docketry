# syntax=docker/dockerfile:1
# docketry API — Hono + Drizzle + Postgres. Migrations run on boot, so
# `docker compose up` on a fresh volume lands at a ready database.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @docketry/api...

COPY packages/types packages/types
COPY apps/api apps/api
RUN pnpm --filter @docketry/types build && pnpm --filter @docketry/api build
RUN pnpm deploy --legacy --filter @docketry/api --prod /out

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
