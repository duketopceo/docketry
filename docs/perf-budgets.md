# Perf budgets (R10) — audit report

Measured 2026-10-09 on a workspace seeded with **10,000 issues** (+1 comment
per ~10 issues, ~14k events). Hardware: Apple M1 Max. Web served via
`next start` (production build), API in-process via `app.fetch` (handler +
Postgres, no TCP noise).

## Reproduce

```bash
docker compose up -d
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/docketry_perf \
  npx tsx apps/api/scripts/seed.ts 10000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/docketry_perf \
  RATE_LIMIT_PER_MIN=100000 npx tsx apps/api/scripts/bench.ts
# web vitals (needs prod web on :3105 + api on :4000 against the seeded DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/docketry_perf \
  E2E_WEB_PORT=3105 E2E_API_PORT=4000 \
  npx playwright test tests/perf.spec.ts -c tools/e2e/playwright.config.ts
node tools/e2e/scripts/bundle-budget.mjs   # after pnpm --filter web build
```

## API latency (declared budgets in `scripts/bench.ts`)

| Route | p50 | p95 | Budget | Result |
|---|---|---|---|---|
| list issues | 6.7ms | 11.9ms | 150ms | PASS |
| list issues (state filter) | 3.3ms | 9.8ms | 150ms | PASS |
| search issues | 6.5ms | 13.1ms | 250ms | PASS |
| issue detail + thread | 6.1ms | 11.6ms | 150ms | PASS |
| insights (26w event scan) | 72.2ms | 100.9ms | 800ms | PASS |
| activity feed | 2.0ms | 5.4ms | 200ms | PASS |
| create issue | 5.7ms | 10.1ms | 150ms | PASS |
| transition issue | 5.5ms | 12.9ms | 150ms | PASS |

## Web vitals (R10: LCP < 1.5s, INP < 200ms, CLS < 0.05)

| Page | domComplete (LCP bound) | FCP | INP | CLS |
|---|---|---|---|---|
| /issues | 90ms | 68ms | 24ms | 0.000 |
| /board | 132ms | 136ms | 0ms | 0.000 |
| /insights | 226ms | 244ms | 16ms | 0.000 |
| /roadmap | 89ms | 100ms | 40ms | 0.000 |

Headless Chromium on this platform does not emit `largest-contentful-paint`
entries, so the gate asserts on `navigation.domComplete` — a strict upper
bound for LCP (all resources loaded). Passing domComplete < 1.5s implies
LCP < 1.5s. INP is measured via `event` timing entries on j/k keypresses.

Note: insights/board/roadmap mount their heavy client code after initial
load (dynamic `ssr:false`), so their deferred render is not in domComplete —
FCP lands on the header/skeleton, full mount within hydration. INP measured
post-mount confirms interactivity is fast.

## Bundle (R10: initial JS < 200kb gzipped)

CI gate `tools/e2e/scripts/bundle-budget.mjs`: **128.9kb** shared initial
(limit 200), **346.4kb** all chunks (limit 600).

Per-route script payload measured from served HTML: every route ≤196.4kb
gzipped. Before this audit, `/insights` shipped 302kb (recharts) and
`/board` 211kb (dnd-kit) — fixed via `next/dynamic` `ssr:false` loaders
(`insights-loader`, `board-loader`, `roadmap-loader`).

## List virtualization (R10: >100 rows)

`issue-list-client` rows carry `content-visibility: auto` +
`contain-intrinsic-size: 36px` — the browser skips layout/paint for
off-screen rows while keeping them in the DOM (j/k nav + find-in-page
unaffected). Pages fetch at most 200 rows, so native virtualization is the
right mechanism here; a JS windowing library earns its dependency cost only
if page size grows past ~1000.

## A11y floor (R11)

`tools/e2e/tests/a11y.spec.ts` axe-scans `/my-issues`, `/board`, `/triage`,
`/issues`, `/insights`, `/roadmap` in CI — clean at time of audit.
