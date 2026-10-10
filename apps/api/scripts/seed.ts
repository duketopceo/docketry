/**
 * Perf-fixture seeder for #37 audit gates.
 *
 *   DATABASE_URL=... tsx scripts/seed.ts [count]
 *
 * Creates a dedicated `SEED` workspace + team and bulk-inserts issues,
 * comments, and events so the perf harness measures on realistic data.
 * Idempotent: re-running wipes the SEED workspace's issues first.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  comments,
  events,
  issues,
  teams,
  users,
  workspaces,
} from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const COUNT = Number(process.argv[2] ?? 10_000);
const BATCH = 500;
const WS_SLUG = "seed";

const STATES = [
  "triage",
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
  "duplicate",
] as const;
const STATE_WEIGHTS = [0.06, 0.3, 0.15, 0.12, 0.07, 0.22, 0.05, 0.03];
const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
const PRIORITY_WEIGHTS = [0.05, 0.2, 0.35, 0.2, 0.2];

function pick<T>(items: readonly T[], weights: number[]): T {
  let r = Math.random();
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

const TITLE_WORDS =
  "sync webhook retry latency flaky login dark mode regression crash render memory leak auth rate limit scroll keyboard palette import export label cycle board triage review".split(
    " ",
  );
const title = (i: number) =>
  `${TITLE_WORDS[i % TITLE_WORDS.length]} ${TITLE_WORDS[(i * 7) % TITLE_WORDS.length]} #${i}`;

async function main() {
  await runMigrations();

  let [ws] = await db
    .select()
    .from(workspaces)
    .where(sql`${workspaces.slug} = ${WS_SLUG}`)
    .limit(1);
  if (!ws) {
    [ws] = await db
      .insert(workspaces)
      .values({ slug: WS_SLUG, name: "Seed Workspace" })
      .returning();
  }
  const wsId = ws!.id;

  // a `seed` slug match doesn't prove fixture ownership — refuse to wipe a
  // workspace that holds anything besides the SEED team
  const foreignTeams = await db
    .select({ key: teams.key })
    .from(teams)
    .where(sql`${teams.workspaceId} = ${wsId} AND ${teams.key} <> 'SEED'`);
  if (foreignTeams.length > 0) {
    console.error(
      `workspace '${WS_SLUG}' contains non-fixture teams (${foreignTeams
        .map((t) => t.key)
        .join(", ")}) — refusing to wipe; use a dedicated database`,
    );
    process.exit(1);
  }

  let [team] = await db
    .select()
    .from(teams)
    .where(sql`${teams.workspaceId} = ${wsId} AND ${teams.key} = 'SEED'`)
    .limit(1);
  if (!team) {
    [team] = await db
      .insert(teams)
      .values({ workspaceId: wsId, key: "SEED", name: "Seed" })
      .returning();
  }
  const teamId = team!.id;

  // wipe prior fixture so reruns measure a clean 10k — scoped to the SEED
  // team's own issues, never the workspace at large
  await db.delete(comments).where(
    sql`${comments.issueId} IN (SELECT id FROM issues WHERE team_id = ${teamId})`,
  );
  await db.delete(events).where(sql`${events.workspaceId} = ${wsId}`);
  await db.delete(issues).where(sql`${issues.teamId} = ${teamId}`);

  let [user] = await db
    .select()
    .from(users)
    .where(
      sql`${users.workspaceId} = ${wsId} AND ${users.email} = 'seed@example.com'`,
    )
    .limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        workspaceId: wsId,
        email: "seed@example.com",
        name: "Seed Human",
      })
      .returning();
  }

  console.log(`seeding ${COUNT} issues into ${WS_SLUG}/SEED...`);
  const t0 = Date.now();

  for (let base = 0; base < COUNT; base += BATCH) {
    const rows = Array.from({ length: Math.min(BATCH, COUNT - base) }, (_, i) => {
      const n = base + i + 1;
      const state = pick(STATES, STATE_WEIGHTS);
      const created = new Date(Date.now() - Math.random() * 180 * 86400e3);
      return {
        workspaceId: wsId,
        teamId,
        key: `SEED-${n}`,
        number: n,
        title: title(n),
        description:
          n % 5 === 0
            ? `Seeded issue ${n}.\n\nRepro: step one, step two, observe.`
            : null,
        state,
        priority: pick(PRIORITIES, PRIORITY_WEIGHTS),
        estimate: state === "backlog" ? null : 1 + (n % 8),
        assigneeType: n % 4 === 0 ? ("human" as const) : null,
        assigneeId: n % 4 === 0 ? user!.id : null,
        creatorType: n % 10 === 0 ? ("agent" as const) : ("human" as const),
        creatorId: user!.id,
        sortOrder: n,
        createdAt: created,
        updatedAt: created,
      };
    });
    const inserted = await db.insert(issues).values(rows).returning({
      id: issues.id,
      key: issues.key,
      createdAt: issues.createdAt,
      state: issues.state,
    });

    // events: issue.created for all; state_changed for non-backlog so the
    // activity feed + insights queries see realistic volume
    const evRows = inserted.flatMap((r) => {
      const evs = [
        {
          workspaceId: wsId,
          entityType: "issue" as const,
          entityId: r.id,
          action: "created" as const,
          actorType: "human" as const,
          actorId: user!.id,
          before: null,
          after: { title: r.key },
          createdAt: r.createdAt,
        },
      ];
      if (r.state !== "backlog" && r.state !== "triage") {
        evs.push({
          workspaceId: wsId,
          entityType: "issue" as const,
          entityId: r.id,
          action: "state_changed" as const,
          actorType: "human" as const,
          actorId: user!.id,
          before: { state: "backlog" },
          after: { state: r.state },
          createdAt: new Date(r.createdAt.getTime() + 86400e3),
        });
      }
      return evs;
    });
    await db.insert(events).values(evRows);

    // ~10% of issues get a comment so detail/activity queries aren't trivial
    const withComments = inserted.filter((_, i) => i % 10 === 0);
    if (withComments.length > 0) {
      await db.insert(comments).values(
        withComments.map((r) => ({
          workspaceId: wsId,
          issueId: r.id,
          actorType: "human" as const,
          actorId: user!.id,
          body: `Seeded comment on ${r.key} — realistic volume for perf measurement.`,
        })),
      );
    }
    process.stdout.write(`\r  ${Math.min(base + BATCH, COUNT)}/${COUNT}`);
  }

  // keep the team's issue counter ahead of the fixture keys
  await db
    .update(teams)
    .set({ nextIssueNumber: COUNT + 1 })
    .where(sql`${teams.id} = ${teamId}`);

  console.log(`\nseeded ${COUNT} issues in ${Date.now() - t0}ms`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
