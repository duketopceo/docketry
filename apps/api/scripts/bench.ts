/**
 * Perf harness for #37 audit gates.
 *
 *   DATABASE_URL=... tsx scripts/bench.ts
 *
 * Expects `scripts/seed.ts` to have populated the `seed` workspace.
 * Drives the real Hono app in-process (handler + DB latency, no TCP noise),
 * reports p50/p95/p99 per route, and exits non-zero if any declared budget
 * is exceeded — budgets live next to the routes they measure.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/db/client.js";
import { agentKeys, agents, workspaces } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { runMigrations } from "../src/db/migrate.js";

const SAMPLES = Number(process.env.BENCH_SAMPLES ?? 60);
const WARMUP = 8;

// declared API budgets — measured on a 10k-issue workspace
const BUDGETS: Record<string, number> = {
  "list issues": 150,
  "list issues (state filter)": 150,
  "search issues": 250,
  "issue detail + thread": 150,
  "insights (26w event scan)": 800,
  "activity feed": 200,
  "create issue": 150,
  "transition issue": 150,
};

async function mintKey(wsId: string): Promise<string> {
  let [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, wsId))
    .limit(1);
  if (!agent) {
    [agent] = await db
      .insert(agents)
      .values({ workspaceId: wsId, name: "bench", harness: "vitest" })
      .returning();
  }
  const key = `dok_agt_bench_${randomBytes(16).toString("hex")}`;
  await db.insert(agentKeys).values({
    workspaceId: wsId,
    agentId: agent!.id,
    name: "bench",
    tokenHash: createHash("sha256").update(key).digest("hex"),
    scopes: ["read", "write"],
  });
  return key;
}

async function main() {
  await runMigrations();
  const { app } = await import("../src/index.js");

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "seed"))
    .limit(1);
  if (!ws) {
    console.error("no `seed` workspace — run scripts/seed.ts first");
    process.exit(1);
  }
  const key = await mintKey(ws.id);
  const headers = { authorization: `Bearer ${key}` };

  const req = (path: string, init?: RequestInit) =>
    app.fetch(
      new Request(`http://bench/v1/workspaces/seed${path}`, {
        headers,
        ...init,
      }),
    );

  // grab a real issue key for detail, and a backlog one for legal transitions
  const list0 = await req("/issues?limit=1");
  const first = ((await list0.json()) as { issues: { key: string }[] })
    .issues[0];
  if (!first) throw new Error("seed produced no issues");
  const detailKey = first.key;
  const listBacklog = await req("/issues?state=backlog&limit=1");
  const transitionKey =
    (
      (await listBacklog.json()) as { issues: { key: string }[] }
    ).issues[0]?.key ?? detailKey;

  const routes: [string, () => Promise<Response>][] = [
    ["list issues", () => req("/issues")],
    ["list issues (state filter)", () => req("/issues?state=in_progress&limit=200")],
    ["search issues", () => req("/issues?search=sync&limit=50")],
    [
      "issue detail + thread",
      async () => {
        const r = await req(`/issues/${detailKey}`);
        const c = await req(`/issues/${detailKey}/comments`);
        const e = await req(`/issues/${detailKey}/events`);
        return r.ok && c.ok && e.ok ? r : r;
      },
    ],
    ["insights (26w event scan)", () => req("/insights")],
    ["activity feed", () => req("/events?limit=50")],
    [
      "create issue",
      () =>
        req("/issues", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            teamKey: "SEED",
            title: `bench issue ${randomBytes(4).toString("hex")}`,
          }),
        }),
    ],
    [
      "transition issue",
      async () => {
        const r = await req(`/issues/${transitionKey}`, {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ state: "todo" }),
        });
        if (r.ok) {
          // walk it back so repeated samples don't hit 409
          await req(`/issues/${transitionKey}`, {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ state: "backlog" }),
          });
        }
        return r;
      },
    ],
  ];

  console.log(`\nbench: ${SAMPLES} samples/route on 10k-issue workspace\n`);
  const failures: string[] = [];

  for (const [name, hit] of routes) {
    for (let i = 0; i < WARMUP; i++) (await hit()).body?.cancel();
    const times: number[] = [];
    let lastStatus = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      const res = await hit();
      await res.body?.cancel();
      times.push(performance.now() - t0);
      lastStatus = res.status;
    }
    times.sort((a, b) => a - b);
    const p = (q: number) =>
      times[Math.min(times.length - 1, Math.floor(times.length * q))]!;
    const [p50, p95, p99] = [p(0.5), p(0.95), p(0.99)];
    const budget = BUDGETS[name]!;
    const pass = p95 <= budget;
    if (!pass) failures.push(name);
    console.log(
      `${pass ? "PASS" : "FAIL"} ${name.padEnd(32)} p50 ${p50.toFixed(1).padStart(7)}ms  p95 ${p95.toFixed(1).padStart(7)}ms  p99 ${p99.toFixed(1).padStart(7)}ms  (budget ${budget}ms, last status ${lastStatus})`,
    );
  }

  if (failures.length > 0) {
    console.error(`\nbudget failures: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall budgets pass");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
