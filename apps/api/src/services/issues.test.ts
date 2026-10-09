import { InvalidTransitionError } from "@docketry/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { events, teams, workspaces } from "../db/schema.js";
import { createIssue, transitionIssue } from "./issues.js";

const human = { type: "human" as const, id: null };
const agent = { type: "agent" as const, id: null };

let workspaceId = "";
let teamId = "";
const cleanup: { issueIds: string[] } = { issueIds: [] };

beforeAll(async () => {
  await runMigrations();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `test-${Date.now()}`, name: "Test WS" })
    .returning();
  workspaceId = ws!.id;
  const [team] = await db
    .insert(teams)
    .values({ workspaceId, key: "DOK", name: "Docketry" })
    .returning();
  teamId = team!.id;
});

afterAll(async () => {
  await db.delete(events).where(eq(events.workspaceId, workspaceId));
  const { issues } = await import("../db/schema.js");
  for (const id of cleanup.issueIds) {
    await db.delete(issues).where(eq(issues.id, id));
  }
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await closeDb();
});

describe("issue service (real postgres)", () => {
  it("mints sequential team-scoped keys", async () => {
    const a = await createIssue({
      workspaceId,
      teamId,
      title: "first",
      creator: human,
    });
    const b = await createIssue({
      workspaceId,
      teamId,
      title: "second",
      creator: agent,
    });
    cleanup.issueIds.push(a.id, b.id);
    expect(a.key).toBe("DOK-1");
    expect(b.key).toBe("DOK-2");
  });

  it("enforces the state machine and writes events", async () => {
    const issue = await createIssue({
      workspaceId,
      teamId,
      title: "walk the lifecycle",
      creator: human,
      state: "todo",
    });
    cleanup.issueIds.push(issue.id);

    const started = await transitionIssue(workspaceId, issue.key, "in_progress", human);
    expect(started.state).toBe("in_progress");

    const reviewing = await transitionIssue(workspaceId, issue.key, "in_review", agent);
    expect(reviewing.state).toBe("in_review");

    await expect(
      transitionIssue(workspaceId, issue.key, "triage", human),
    ).rejects.toThrow(InvalidTransitionError);

    const done = await transitionIssue(workspaceId, issue.key, "done", agent);
    expect(done.state).toBe("done");

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.entityId, issue.id));

    expect(rows.filter((e) => e.action === "state_changed")).toHaveLength(3);
    expect(rows.some((e) => e.actorType === "agent")).toBe(true);
    expect(rows.some((e) => e.action === "created")).toBe(true);
  });

  it("rejects transitions on missing issues with a typed error", async () => {
    await expect(
      transitionIssue(workspaceId, "DOK-999", "done", human),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
