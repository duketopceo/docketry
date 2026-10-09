import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cycleVelocity, cycles, events, teams } from "../db/schema.js";

// Insights are computed from the append-only event log — never from mutable
// issue rows — so the charts are auditable against what actually happened.

export interface Insights {
  cycleTime: {
    avgDays: number;
    p50Days: number;
    p90Days: number;
    completed: number;
    weekly: { week: string; avgDays: number; count: number }[];
  };
  burnup: { week: string; total: number; done: number }[];
  velocity: {
    team: string;
    cycle: string;
    done: number;
    issueCount: number;
    estimateDone: number;
    estimateTotal: number;
  }[];
  throughput: { week: string; human: number; agent: number; system: number }[];
}

interface EventRow {
  entityId: string;
  action: string;
  actorType: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

function weekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7; // Monday-start weeks
  day.setUTCDate(day.getUTCDate() - dow + 1);
  return day.toISOString().slice(0, 10);
}

const DAY = 86_400_000;
// Weekly series cover a rolling window; the append-only log is still the
// source of truth, but dashboard requests must not materialize all of it —
// pre-window burnup baselines come from cheap DB counts over the same log.
const WINDOW_WEEKS = 26;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i]!;
}

export async function computeInsights(workspaceId: string): Promise<Insights> {
  const windowStart = new Date(Date.now() - WINDOW_WEEKS * 7 * DAY);
  const scope = [
    eq(events.workspaceId, workspaceId),
    eq(events.entityType, "issue"),
  ];

  const [[createdBefore], [doneBefore], evts] = await Promise.all([
    db
      .select({ n: count() })
      .from(events)
      .where(
        and(...scope, eq(events.action, "created"), lt(events.createdAt, windowStart)),
      ),
    // `done` is terminal — each issue reaches it at most once, so row count
    // is the distinct-issue count
    db
      .select({ n: count() })
      .from(events)
      .where(
        and(
          ...scope,
          eq(events.action, "state_changed"),
          lt(events.createdAt, windowStart),
          sql`${events.after}->>'state' = 'done'`,
        ),
      ),
    db
      .select({
        entityId: events.entityId,
        action: events.action,
        actorType: events.actorType,
        before: events.before,
        after: events.after,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(
        and(
          ...scope,
          inArray(events.action, ["created", "state_changed"]),
          gte(events.createdAt, windowStart),
        ),
      )
      .orderBy(asc(events.createdAt)),
  ]);

  const weeks = new Set<string>();
  const byIssue = new Map<string, EventRow[]>();
  for (const e of evts as EventRow[]) {
    weeks.add(weekStart(e.createdAt));
    const list = byIssue.get(e.entityId) ?? [];
    list.push(e);
    byIssue.set(e.entityId, list);
  }

  // ── cycle time: first in_progress → first done, per issue ──
  const cycleDurations: { days: number; week: string }[] = [];
  for (const list of byIssue.values()) {
    const start = list.find(
      (e) =>
        e.action === "state_changed" &&
        (e.after as { state?: string }).state === "in_progress",
    );
    const end = list.find(
      (e) =>
        e.action === "state_changed" &&
        (e.after as { state?: string }).state === "done" &&
        (!start || e.createdAt >= start.createdAt),
    );
    if (start && end) {
      cycleDurations.push({
        days: (end.createdAt.getTime() - start.createdAt.getTime()) / DAY,
        week: weekStart(end.createdAt),
      });
    }
  }
  const durations = cycleDurations.map((d) => d.days).sort((a, b) => a - b);
  const weeklyCycle = new Map<string, { sum: number; n: number }>();
  for (const d of cycleDurations) {
    const w = weeklyCycle.get(d.week) ?? { sum: 0, n: 0 };
    w.sum += d.days;
    w.n++;
    weeklyCycle.set(d.week, w);
  }

  // ── burnup: cumulative created vs cumulative done, weekly ──
  const createdPerWeek = new Map<string, number>();
  const donePerWeek = new Map<string, number>();
  const seenDone = new Set<string>();
  for (const e of evts as EventRow[]) {
    const w = weekStart(e.createdAt);
    if (e.action === "created") {
      createdPerWeek.set(w, (createdPerWeek.get(w) ?? 0) + 1);
    }
    if (
      e.action === "state_changed" &&
      (e.after as { state?: string }).state === "done" &&
      !seenDone.has(e.entityId)
    ) {
      seenDone.add(e.entityId);
      donePerWeek.set(w, (donePerWeek.get(w) ?? 0) + 1);
    }
  }
  const sortedWeeks = [...weeks].sort();
  // burnup starts from the pre-window baseline so the cumulative line stays
  // all-time correct without scanning history
  let runningTotal = createdBefore?.n ?? 0;
  let runningDone = doneBefore?.n ?? 0;
  const burnup = sortedWeeks.map((w) => {
    runningTotal += createdPerWeek.get(w) ?? 0;
    runningDone += donePerWeek.get(w) ?? 0;
    return { week: w, total: runningTotal, done: runningDone };
  });

  // ── throughput: done transitions per week split by actor ──
  const tpMap = new Map<string, { human: number; agent: number; system: number }>();
  const counted = new Set<string>();
  for (const e of evts as EventRow[]) {
    if (
      e.action === "state_changed" &&
      (e.after as { state?: string }).state === "done"
    ) {
      const k = `${e.entityId}:${e.createdAt.getTime()}`;
      if (counted.has(k)) continue;
      counted.add(k);
      const w = weekStart(e.createdAt);
      const row = tpMap.get(w) ?? { human: 0, agent: 0, system: 0 };
      if (e.actorType === "agent") row.agent++;
      else if (e.actorType === "system") row.system++;
      else row.human++;
      tpMap.set(w, row);
    }
  }
  const throughput = sortedWeeks
    .filter((w) => tpMap.has(w))
    .map((w) => ({ week: w, ...tpMap.get(w)! }));

  // ── velocity: cycle_velocity snapshots joined to cycles+teams ──
  const velRows = await db
    .select({
      teamKey: teams.key,
      number: cycles.number,
      name: cycles.name,
      doneCount: cycleVelocity.doneCount,
      issueCount: cycleVelocity.issueCount,
      estimateDone: cycleVelocity.estimateDone,
      estimateTotal: cycleVelocity.estimateTotal,
    })
    .from(cycleVelocity)
    .innerJoin(cycles, eq(cycles.id, cycleVelocity.cycleId))
    .innerJoin(teams, eq(teams.id, cycleVelocity.teamId))
    .where(eq(cycleVelocity.workspaceId, workspaceId))
    .orderBy(asc(cycles.startsAt));
  const velocity = velRows.map((r) => ({
    team: r.teamKey,
    cycle: `C${r.number}${r.name ? ` ${r.name}` : ""}`,
    done: r.doneCount,
    issueCount: r.issueCount,
    estimateDone: r.estimateDone,
    estimateTotal: r.estimateTotal,
  }));

  return {
    cycleTime: {
      avgDays:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
      p50Days: pct(durations, 50),
      p90Days: pct(durations, 90),
      completed: durations.length,
      weekly: [...weeklyCycle.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, v]) => ({
          week,
          avgDays: v.sum / v.n,
          count: v.n,
        })),
    },
    burnup,
    velocity,
    throughput,
  };
}
