import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../apps/api/src/index.js";
import { closeDb, db } from "../../../apps/api/src/db/client.js";
import { runMigrations } from "../../../apps/api/src/db/migrate.js";
import {
  agentKeys,
  agents,
  comments,
  cycles,
  dispatchEvents,
  dispatches,
  events,
  issues,
  labels,
  projectMilestones,
  projects,
  sessions,
  teams,
  users,
  userTokens,
  views,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "../../../apps/api/src/db/schema.js";
import { run } from "./cli.js";
import type { EnvLike } from "./config.js";

const SLUG = `cli-test-${Date.now()}`;

// Hono's app.fetch is Request-in/Response-out — the same contract the CLI's
// fetch expects, so the whole CLI runs in-process against the real API.
const appFetch = (req: Request) => app.fetch(req);

interface TestBody {
  error?: { code: string; message: string };
  [key: string]: unknown;
}

let cookie = "";
let userId = "";
let agentId = "";
let otherAgentId = "";
let agentToken = "";
let patToken = "";

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: TestBody }> {
  const res = await app.fetch(
    new Request(`http://cli.test${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie,
        ...(init?.headers as Record<string, string> | undefined),
      },
    }),
  );
  const sc = res.headers.get("set-cookie");
  if (sc?.startsWith("dok_session=")) cookie = sc.split(";")[0]!;
  return { status: res.status, body: (await res.json()) as TestBody };
}

let tmpHome = "";
let tmpCwd = "";

interface CliResult {
  code: number;
  out: string[];
  err: string[];
  json: () => unknown;
}

async function cli(
  argv: string[],
  overrides: {
    env?: EnvLike;
    cwd?: string;
    stdin?: string;
  } = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: {
      HOME: tmpHome, // keep real ~/.config/docketry out of the tests
      DOCKETRY_API_URL: "http://cli.test",
      DOCKETRY_TOKEN: agentToken,
      DOCKETRY_WORKSPACE: SLUG,
      DOCKETRY_AGENT_ID: agentId,
      ...overrides.env,
    },
    cwd: overrides.cwd ?? tmpCwd,
    fetch: appFetch,
    ...(overrides.stdin !== undefined
      ? { stdin: async () => overrides.stdin! }
      : {}),
  });
  return { code, out, err, json: () => JSON.parse(out.join("\n")) as unknown };
}

interface SlimIssue {
  id: string;
  key: string;
  title: string;
  state: string;
  priority: string;
  assigneeType: string | null;
  assigneeId: string | null;
}

async function createIssue(
  title: string,
  extra: string[] = [],
): Promise<SlimIssue> {
  const res = await cli(["create", "--title", title, "--json", ...extra]);
  expect(res.code).toBe(0);
  return res.json() as SlimIssue;
}

async function setState(key: string, state: string): Promise<number> {
  const res = await cli(["state", key, state]);
  return res.code;
}

// FK-safe delete order — mirrors apps/api/src/routes/api.test.ts
const ALL_TABLES = [
  comments,
  events,
  webhookDeliveries,
  webhookEndpoints,
  dispatchEvents,
  dispatches,
  issues,
  labels,
  agentKeys,
  agents,
  userTokens,
  views,
  cycles,
  projectMilestones,
  projects,
  sessions,
  users,
  teams,
] as const;

beforeAll(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "dok-cli-home-"));
  tmpCwd = await mkdtemp(join(tmpdir(), "dok-cli-cwd-"));

  await runMigrations();
  // mirror apps/api/src/routes/api.test.ts — wipe in FK-safe order so the
  // suite owns the bootstrap path deterministically
  for (const t of ALL_TABLES) {
    await db.delete(t);
  }
  await db.delete(workspaces);

  const boot = await api("/v1/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      workspaceSlug: SLUG,
      workspaceName: "CLI Test",
      teamKey: "ENG",
      email: "cli@t.co",
      name: "CLI Tester",
      password: "test-password-123",
    }),
  });
  expect(boot.status).toBe(201);
  userId = (boot.body.user as { id: string }).id;

  const agent = await api(`/v1/workspaces/${SLUG}/agents`, {
    method: "POST",
    body: JSON.stringify({
      name: "cli-bot",
      harness: "claude-code",
      capabilities: ["test"],
    }),
  });
  expect(agent.status).toBe(201);
  agentId = agent.body.id as string;

  const other = await api(`/v1/workspaces/${SLUG}/agents`, {
    method: "POST",
    body: JSON.stringify({ name: "other-bot", harness: "local" }),
  });
  otherAgentId = other.body.id as string;

  const mint = await api(`/v1/workspaces/${SLUG}/agents/${agentId}/keys`, {
    method: "POST",
    body: JSON.stringify({ name: "rw", scopes: ["read", "write"] }),
  });
  agentToken = mint.body.key as string;
  expect(agentToken).toMatch(/^dok_agt_/);

  const pat = await api(`/v1/workspaces/${SLUG}/tokens`, {
    method: "POST",
    body: JSON.stringify({ name: "human", scopes: ["read", "write"] }),
  });
  patToken = pat.body.token as string;
});

afterAll(async () => {
  // dedicated test DB (docketry_cli) — wiping everything is safe here
  for (const t of ALL_TABLES) {
    await db.delete(t);
  }
  await db.delete(workspaces);
  await closeDb();
  await rm(tmpHome, { recursive: true, force: true });
  await rm(tmpCwd, { recursive: true, force: true });
});

describe("docketry cli (in-process api)", () => {
  it("create mints a key and reports slim json", async () => {
    const issue = await createIssue("First CLI issue", [
      "--priority",
      "high",
      "--description",
      "made by tests",
    ]);
    expect(issue.key).toBe("ENG-1");
    expect(issue.state).toBe("backlog");
    expect(issue.priority).toBe("high");

    const shown = await cli(["show", issue.key]);
    expect(shown.code).toBe(0);
    expect(shown.out.join("\n")).toContain("First CLI issue");
    expect(shown.out.join("\n")).toContain("state:     backlog");
  });

  it("ready orders todo issues by priority and excludes others' work", async () => {
    // backlog issues are not ready — move three to todo with mixed priority
    const low = await createIssue("low prio", ["--priority", "low"]);
    const urgent = await createIssue("urgent prio", ["--priority", "urgent"]);
    const none = await createIssue("no prio");
    for (const k of [low.key, urgent.key, none.key]) {
      expect(await setState(k, "todo")).toBe(0);
    }

    // claimed by a different agent — invisible to `ready`
    const claimed = await createIssue("someone else's", [
      "--priority",
      "urgent",
    ]);
    await setState(claimed.key, "todo");
    const claimRes = await cli([
      "claim",
      claimed.key,
      "--as",
      otherAgentId,
      "--type",
      "agent",
      "--json",
    ]);
    expect(claimRes.code).toBe(0);

    const res = await cli(["ready", "--json"]);
    expect(res.code).toBe(0);
    const rows = (res.json() as { issues: SlimIssue[] }).issues;
    const keys = rows.map((i) => i.key);
    expect(keys).toEqual([urgent.key, low.key, none.key]);
    expect(keys).not.toContain(claimed.key);

    // --all shows everyone's todo work
    const all = await cli(["ready", "--all", "--json"]);
    const allKeys = (all.json() as { issues: SlimIssue[] }).issues.map(
      (i) => i.key,
    );
    expect(allKeys).toContain(claimed.key);
  });

  it("claim -> start -> done lifecycle completes from the CLI", async () => {
    const issue = await createIssue("lifecycle");
    expect(await setState(issue.key, "todo")).toBe(0);

    // claim as the configured agent identity (DOCKETRY_AGENT_ID)
    const claimed = await cli(["claim", issue.key, "--json"]);
    expect(claimed.code).toBe(0);
    const claimedIssue = claimed.json() as SlimIssue;
    expect(claimedIssue.assigneeType).toBe("agent");
    expect(claimedIssue.assigneeId).toBe(agentId);

    const started = await cli(["start", issue.key, "--json"]);
    expect(started.code).toBe(0);
    expect((started.json() as SlimIssue).state).toBe("in_progress");

    const commented = await cli([
      "comment",
      issue.key,
      "picked up by cli-bot",
    ]);
    expect(commented.code).toBe(0);

    // done chains in_progress -> in_review -> done behind one command
    const done = await cli(["done", issue.key, "--json"]);
    expect(done.code).toBe(0);
    expect((done.json() as SlimIssue).state).toBe("done");

    const shown = await cli(["show", issue.key, "--json"]);
    const detail = shown.json() as {
      issue: SlimIssue;
      comments: { body: string }[];
    };
    expect(detail.issue.state).toBe("done");
    expect(detail.comments.map((c) => c.body)).toContain(
      "picked up by cli-bot",
    );
  });

  it("next prefers my in_progress issue, else the top of ready", async () => {
    // agent already has the lifecycle issue in done; create a fresh WIP
    const wip = await createIssue("in flight", ["--priority", "low"]);
    await setState(wip.key, "todo");
    await cli(["claim", wip.key]);
    await cli(["start", wip.key]);

    const res = await cli(["next", "--json"]);
    expect(res.code).toBe(0);
    expect((res.json() as SlimIssue).key).toBe(wip.key);

    // finish it — next falls back to the top ready item (urgent prio)
    await cli(["done", wip.key]);
    const again = await cli(["next"]);
    expect(again.code).toBe(0);
    expect(again.out[0]).toContain("urgent prio");
  });

  it("comment accepts a piped body from stdin", async () => {
    const res = await cli(["comment", "ENG-1"], { stdin: "via stdin\n" });
    expect(res.code).toBe(0);
    const shown = await cli(["show", "ENG-1", "--json"]);
    const detail = shown.json() as { comments: { body: string }[] };
    expect(detail.comments.map((c) => c.body)).toContain("via stdin");
  });

  it("list filters and search find the right rows", async () => {
    const res = await cli(["list", "--state", "done", "--json"]);
    expect(res.code).toBe(0);
    const doneIssues = (res.json() as { issues: SlimIssue[] }).issues;
    expect(doneIssues.length).toBeGreaterThan(0);
    expect(doneIssues.every((i) => i.state === "done")).toBe(true);

    const mine = await cli(["list", "--assignee", "me", "--json"]);
    const mineIssues = (mine.json() as { issues: SlimIssue[] }).issues;
    expect(mineIssues.every((i) => i.assigneeId === agentId)).toBe(true);

    const searched = await cli(["search", "urgent", "--json"]);
    const hits = (searched.json() as { issues: SlimIssue[] }).issues;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe("urgent prio");
  });

  it("claim resolves agent names and supports human identity via PAT", async () => {
    const byName = await createIssue("claim by name");
    const res = await cli(["claim", byName.key, "--as", "other-bot"]);
    expect(res.code).toBe(0);
    expect(res.out[0]).toContain(`agent ${otherAgentId}`);

    // a human PAT + DOCKETRY_USER_ID claims as the bootstrap user
    const human = await createIssue("human claim");
    const resHuman = await cli(["claim", human.key, "--json"], {
      env: {
        DOCKETRY_TOKEN: patToken,
        DOCKETRY_AGENT_ID: undefined,
        DOCKETRY_USER_ID: userId,
      },
    });
    expect(resHuman.code).toBe(0);
    const body = resHuman.json() as SlimIssue;
    expect(body.assigneeType).toBe("human");
    expect(body.assigneeId).toBe(userId);
  });

  it("triage accept/decline drive the triage lane", async () => {
    const triaged = await createIssue("triage me", ["--state", "triage"]);
    const ok = await cli(["triage", triaged.key, "accept", "--json"]);
    expect(ok.code).toBe(0);
    expect((ok.json() as SlimIssue).state).toBe("backlog");

    const declined = await createIssue("decline me", ["--state", "triage"]);
    const dec = await cli(["triage", declined.key, "decline", "--json"]);
    expect((dec.json() as SlimIssue).state).toBe("canceled");

    // non-triage issue -> NOT_IN_TRIAGE -> conflict exit
    const bad = await cli(["triage", "ENG-1", "accept"]);
    expect(bad.code).toBe(5);
    expect(bad.err[0]).toContain("NOT_IN_TRIAGE");
  });

  it("events returns the feed chronologically with --after resume", async () => {
    const all = await cli(["events", "--json"]);
    expect(all.code).toBe(0);
    const feed = (all.json() as { events: { id: string; action: string }[] })
      .events;
    expect(feed.length).toBeGreaterThan(0);
    const ids = feed.map((e) => Number(e.id));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids); // ascending
    const actions = feed.map((e) => e.action);
    expect(actions).toContain("created");
    expect(actions).toContain("state_changed");
    expect(actions).toContain("commented");

    const pivot = feed[Math.floor(feed.length / 2)]!;
    const resumed = await cli(["events", "--after", pivot.id, "--json"]);
    const tail = (resumed.json() as { events: { id: string }[] }).events;
    expect(tail.every((e) => Number(e.id) > Number(pivot.id))).toBe(true);
  });

  it("exit codes: not-found=4, auth=3, conflict=5, usage=2", async () => {
    const missing = await cli(["show", "ENG-999"]);
    expect(missing.code).toBe(4);
    expect(missing.err[0]).toContain("NOT_FOUND");

    const unauthorized = await cli(["ready"], {
      env: { DOCKETRY_TOKEN: "dok_agt_bogus" },
    });
    expect(unauthorized.code).toBe(3);
    expect(unauthorized.err[0]).toContain("UNAUTHENTICATED");

    // done -> todo has no legal path
    const doneIssue = await createIssue("finish me");
    await setState(doneIssue.key, "todo");
    await cli(["start", doneIssue.key]);
    await cli(["done", doneIssue.key]);
    const conflict = await cli(["state", doneIssue.key, "triage"]);
    expect(conflict.code).toBe(5);
    expect(conflict.err[0]).toContain("INVALID_TRANSITION");

    const badFlag = await cli(["ready", "--bogus"]);
    expect(badFlag.code).toBe(2);

    const noToken = await cli(["ready"], {
      env: { DOCKETRY_TOKEN: undefined },
    });
    expect(noToken.code).toBe(2);
    expect(noToken.err[0]).toContain("DOCKETRY_TOKEN");

    const noWorkspace = await cli(["ready"], {
      env: { DOCKETRY_WORKSPACE: undefined },
    });
    expect(noWorkspace.code).toBe(2);
    expect(noWorkspace.err[0]).toContain("DOCKETRY_WORKSPACE");
  });

  it("work --dry-run plans the session; --cmd runs and reports it", async () => {
    // assigning an issue to the configured agent lands a claimed dispatch
    const issue = await createIssue("dispatch me");
    const claim = await cli(["claim", issue.key, "--json"]);
    expect(claim.code).toBe(0);

    const dry = await cli(["work", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out[0]).toContain(issue.key);
    expect(dry.out[0]).toContain(`${issue.key}-dispatch-me`);

    // real run: `true` is a harness that exits 0 — cwd isn't a git repo, so
    // the session works in place and the report carries no branch
    const ran = await cli(["work", "--cmd", "true"]);
    expect(ran.code).toBe(0);
    expect(ran.out.join("\n")).toContain(`${issue.key} session completed`);

    // dispatch reported → completion comment landed on the issue
    const shown = await cli(["show", issue.key, "--json"]);
    const detail = shown.json() as { comments: { body: string }[] };
    expect(
      detail.comments.some((c) => c.body.includes("session completed")),
    ).toBe(true);
    expect(existsSync(join(tmpCwd, ".docketry-context.md"))).toBe(true);
  });

  it("session posts a timeline event onto the dispatch", async () => {
    const issue = await createIssue("session-timeline me");
    await cli(["claim", issue.key]);
    const list = await api(
      `/v1/workspaces/${SLUG}/dispatches?status=claimed`,
      { headers: { authorization: `Bearer ${agentToken}` } },
    );
    const d = (list.body.dispatches as { id: string; issueKey: string }[]).find(
      (x) => x.issueKey === issue.key,
    )!;
    expect(d).toBeDefined();

    const posted = await cli(
      ["session", "implementing", "writing tests", "--dispatch", d.id],
    );
    expect(posted.code).toBe(0);
    expect(posted.out[0]).toContain("implementing: writing tests");

    const log = await api(
      `/v1/workspaces/${SLUG}/dispatches/${d.id}/events`,
      { headers: { authorization: `Bearer ${agentToken}` } },
    );
    const evs = log.body.events as { kind: string; message: string }[];
    expect(evs[evs.length - 1]).toMatchObject({
      kind: "implementing",
      message: "writing tests",
    });

    const noDispatch = await cli(["session", "note", "hi"], {
      env: { DOCKETRY_DISPATCH_ID: undefined },
    });
    expect(noDispatch.code).toBe(2);
  });

  it("work in a git repo isolates the session in a worktree + reports the branch", async () => {
    const { execFileSync } = await import("node:child_process");
    const repo = await mkdtemp(join(tmpdir(), "dok-repo-"));
    const git = (args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.email=t@t.co", "-c", "user.name=t", ...args],
        { cwd: repo },
      );
    git(["init", "-b", "main"]);
    git(["commit", "--allow-empty", "-m", "init"]);

    const issue = await createIssue("worktree me");
    await cli(["claim", issue.key]);

    const ran = await cli(["work", "--cmd", "true"], { cwd: repo });
    expect(ran.code).toBe(0);
    const branch = `${issue.key}-worktree-me`;
    expect(ran.out.join("\n")).toContain(branch);

    // isolated worktree exists on its own branch
    const worktreeDir = join(repo, ".docketry", issue.key);
    expect(existsSync(join(worktreeDir, ".docketry-context.md"))).toBe(true);
    const head = execFileSync("git", ["branch", "--show-current"], {
      cwd: worktreeDir,
    })
      .toString()
      .trim();
    expect(head).toBe(branch);

    // completion report links the branch back on the issue
    const shown = await cli(["show", issue.key, "--json"]);
    const detail = shown.json() as { comments: { body: string }[] };
    expect(
      detail.comments.some((c) => c.body.includes(branch)),
    ).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("init writes .docketry config + agent context file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dok-init-"));
    const res = await cli(["init", "--workspace", "acme"], { cwd: dir });
    expect(res.code).toBe(0);

    const configPath = join(dir, ".docketry", "config.json");
    const agentPath = join(dir, ".docketry", "agent.md");
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(agentPath)).toBe(true);
    const cfg = JSON.parse(await readFile(configPath, "utf8")) as {
      apiUrl: string;
      workspace: string;
      agentId?: string;
    };
    expect(cfg.workspace).toBe("acme");
    expect(cfg.agentId).toBe(agentId);

    // refuses to clobber without --force
    const again = await cli(["init", "--workspace", "acme"], { cwd: dir });
    expect(again.code).toBe(1);
    expect(again.err[0]).toContain("--force");

    // config file is picked up from ./.docketry/config.json
    const listed = await cli(["ready", "--json"], {
      cwd: dir,
      env: { DOCKETRY_WORKSPACE: undefined, DOCKETRY_AGENT_ID: undefined },
    });
    // workspace came from the file — but 'acme' doesn't exist -> 404 -> exit 4
    expect(listed.code).toBe(4);
    await rm(dir, { recursive: true, force: true });
  });

  it("help and version work without config", async () => {
    const help = await cli(["help"], {
      env: { DOCKETRY_TOKEN: undefined, DOCKETRY_WORKSPACE: undefined },
    });
    expect(help.code).toBe(0);
    expect(help.out.join("\n")).toContain("ready");
    expect(help.out.join("\n")).toContain("exit codes");

    const version = await cli(["--version"]);
    expect(version.code).toBe(0);
    expect(version.out[0]).toContain("docketry");
  });
});
