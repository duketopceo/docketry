import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { closeDb, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  agentKeys,
  agents,
  comments,
  cycleVelocity,
  cycles,
  dispatches,
  events,
  githubInstallations,
  githubIssueLinks,
  githubRepos,
  githubWebhookEvents,
  issueExternalRefs,
  issues,
  labels,
  projects,
  sessions,
  teams,
  users,
  userTokens,
  views,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "../db/schema.js";
import { importGithubIssues, importLinearCsv } from "./import.js";

const SLUG = `imp-test-${Date.now()}`;
let sessionCookie = "";
let wsId = "";
let teamId = "";

async function req(path: string, init?: RequestInit) {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
        ...(init?.headers as Record<string, string>),
      },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const GH_PAGE = [
  {
    id: 5001,
    number: 10,
    title: "open bug",
    body: "broken",
    html_url: "https://github.com/acme/widgets/issues/10",
    state: "open",
    labels: [{ name: "bug" }],
  },
  {
    id: 5002,
    number: 11,
    title: "shipped feature",
    body: null,
    html_url: "https://github.com/acme/widgets/issues/11",
    state: "closed",
    state_reason: "completed",
  },
  {
    id: 5003,
    number: 12,
    title: "wontfix",
    body: null,
    html_url: "https://github.com/acme/widgets/issues/12",
    state: "closed",
    state_reason: "not_planned",
  },
  {
    id: 5004,
    number: 13,
    title: "a pull request",
    html_url: "https://github.com/acme/widgets/pull/13",
    state: "open",
    pull_request: { url: "…" },
  },
];

beforeAll(async () => {
  await runMigrations();
  for (const t of [
    comments,
    events,
    githubIssueLinks,
    issueExternalRefs,
    dispatches,
    webhookDeliveries,
    webhookEndpoints,
    issues,
    labels,
    agentKeys,
    agents,
    userTokens,
    views,
    cycleVelocity,
    cycles,
    projects,
    sessions,
    githubWebhookEvents,
    githubRepos,
    githubInstallations,
    users,
    teams,
  ] as const) {
    await db.delete(t);
  }
  await db.delete(workspaces);

  const res = await app.fetch(
    new Request("http://api.test/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: SLUG,
        workspaceName: "Imp Test",
        teamKey: "IM",
        email: "i@test.dev",
        name: "I User",
        password: "pw-long-enough",
      }),
    }),
  );
  expect(res.status).toBe(201);
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const [ws] = await db.select().from(workspaces);
  wsId = ws!.id;
  const [team] = await db.select().from(teams);
  teamId = team!.id;
});

afterAll(async () => {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SLUG));
  if (ws) {
    for (const t of [
      comments,
      events,
      githubIssueLinks,
      issueExternalRefs,
      issues,
      githubRepos,
      sessions,
      users,
      teams,
    ] as const) {
      await db.delete(t).where(eq(t.workspaceId, ws.id));
    }
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
  }
  await closeDb();
});

describe("github import (#36)", () => {
  const fakeFetch = (() => {
    const calls: string[] = [];
    const fn = async (url: string): Promise<Response> => {
      calls.push(url);
      return new Response(JSON.stringify(GH_PAGE), {
        headers: { "content-type": "application/json" },
      });
    };
    fn.calls = calls;
    return fn;
  })();

  it("imports issues state-mapped, skips PRs, preserves refs", async () => {
    const r = await importGithubIssues({
      workspaceId: wsId,
      fullName: "acme/widgets",
      token: "ghp_test",
      target: "triage",
      teamId,
      fetchImpl: fakeFetch,
    });
    expect(r.errors).toHaveLength(0);
    expect(r.created).toBe(3); // PR filtered out

    const rows = await db.select().from(issues).where(eq(issues.workspaceId, wsId));
    const byTitle = Object.fromEntries(rows.map((i) => [i.title, i]));
    expect(byTitle["open bug"]!.state).toBe("triage");
    expect(byTitle["shipped feature"]!.state).toBe("done");
    expect(byTitle["wontfix"]!.state).toBe("canceled");
    expect(byTitle["open bug"]!.description).toContain(
      "github.com/acme/widgets/issues/10",
    );

    const links = await db.select().from(githubIssueLinks);
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.ghIssueNumber).sort()).toEqual([10, 11, 12]);
  });

  it("re-run creates no duplicates", async () => {
    const r = await importGithubIssues({
      workspaceId: wsId,
      fullName: "acme/widgets",
      token: "ghp_test",
      target: "backlog",
      fetchImpl: fakeFetch,
    });
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(3);
    const rows = await db.select().from(issues);
    expect(rows.filter((i) => i.title === "open bug")).toHaveLength(1);
  });
});

describe("linear csv import (#36)", () => {
  const CSV = `ID,Title,Description,Status,Priority,Labels,URL
LIN-101,"Fix login, redirect loop","users loop back",In Progress,High,"bug, auth",https://linear.app/acme/issue/LIN-101
LIN-102,Ship dark mode,,Done,Urgent,,https://linear.app/acme/issue/LIN-102
LIN-103,Investigate flake,,Backlog,Low,,https://linear.app/acme/issue/LIN-103
LIN-104,"Multi
line
desc",,Canceled,,,
`;

  it("creates issues with mapped states, priority, and external refs", async () => {
    const r = await importLinearCsv({
      workspaceId: wsId,
      teamId,
      csv: CSV,
      target: "backlog",
    });
    expect(r.created).toBe(4);

    const rows = await db.select().from(issues).where(eq(issues.workspaceId, wsId));
    const byTitle = Object.fromEntries(rows.map((i) => [i.title, i]));
    expect(byTitle["Fix login, redirect loop"]!.state).toBe("in_progress");
    expect(byTitle["Fix login, redirect loop"]!.priority).toBe("high");
    expect(byTitle["Ship dark mode"]!.state).toBe("done");
    expect(byTitle["Ship dark mode"]!.priority).toBe("urgent");
    expect(byTitle["Investigate flake"]!.state).toBe("backlog");
    expect(byTitle["Multi\nline\ndesc"]!.state).toBe("canceled");
    expect(byTitle["Fix login, redirect loop"]!.description).toContain("LIN-101");

    const refs = await db
      .select()
      .from(issueExternalRefs)
      .where(eq(issueExternalRefs.system, "linear"));
    expect(refs).toHaveLength(4);
    expect(refs.find((x) => x.externalId === "LIN-102")!.url).toContain(
      "linear.app",
    );
  });

  it("re-run is idempotent", async () => {
    const r = await importLinearCsv({
      workspaceId: wsId,
      teamId,
      csv: CSV,
      target: "triage",
    });
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(4);
  });

  it("route accepts csv + teamKey through HTTP", async () => {
    const res = await req(`/v1/workspaces/${SLUG}/import/linear`, {
      method: "POST",
      body: JSON.stringify({
        teamKey: "IM",
        csv: "ID,Title,Status\nLIN-200,via route,Todo",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { created: number }).created).toBe(1);
    const rows = await db
      .select()
      .from(issues)
      .where(eq(issues.title, "via route"));
    expect(rows[0]!.state).toBe("todo");
  });
});
