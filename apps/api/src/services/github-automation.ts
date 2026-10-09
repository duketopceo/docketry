import { and, asc, eq } from "drizzle-orm";
import {
  findPath,
  type IssueState,
} from "@docketry/types";
import { db } from "../db/client.js";
import {
  events,
  githubIssueLinks,
  githubInstallations,
  githubRepos,
  issues,
  teams,
} from "../db/schema.js";
import { createIssue, transitionIssue, type Actor } from "./issues.js";

const SYSTEM: Actor = { type: "system", id: null };
const KEY_PREFIX = /^([A-Z][A-Z0-9]*-\d+)/;

interface GhRepoRef {
  full_name: string;
}

interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user?: { login: string };
}

interface GhPullRequest {
  number: number;
  merged?: boolean;
  draft?: boolean;
  title: string;
  html_url: string;
  head: { ref: string };
  user?: { login: string };
}

type Payload = Record<string, unknown>;

// find the enabled repo link for a delivery; null → repo not tracked
async function repoFor(payload: Payload) {
  const repo = payload.repository as GhRepoRef | undefined;
  if (!repo?.full_name) return null;
  const [row] = await db
    .select()
    .from(githubRepos)
    .where(eq(githubRepos.fullName, repo.full_name))
    .limit(1);
  return row?.enabled ? row : null;
}

// issue key from a branch name like `GH-4-fix-the-thing`
async function issueForBranch(workspaceId: string, branch: string) {
  const m = KEY_PREFIX.exec(branch);
  if (!m) return null;
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.key, m[1]!)))
    .limit(1);
  return issue ?? null;
}

// walk the state machine to `target`; no-op when already there or unreachable
// backward (automation never moves issues backwards)
async function transitionTo(
  workspaceId: string,
  key: string,
  current: IssueState,
  target: IssueState,
  extra?: Record<string, unknown>,
) {
  if (current === target) return;
  const path = findPath(current, target);
  if (!path) return;
  for (const step of path) {
    await transitionIssue(
      workspaceId,
      key,
      step,
      SYSTEM,
      step === path[path.length - 1] ? extra : undefined,
    );
  }
}

async function onPush(repo: { workspaceId: string }, payload: Payload) {
  const ref = payload.ref as string | undefined;
  const branch = ref?.startsWith("refs/heads/") ? ref.slice(11) : ref;
  if (!branch) return;
  const issue = await issueForBranch(repo.workspaceId, branch);
  if (!issue) return;
  await transitionTo(repo.workspaceId, issue.key, issue.state, "in_progress", {
    github: { event: "push", branch },
  });
}

async function onPullRequest(
  repo: { workspaceId: string },
  payload: Payload,
) {
  const pr = payload.pull_request as GhPullRequest | undefined;
  const action = payload.action as string | undefined;
  if (!pr?.head?.ref || !action) return;
  const issue = await issueForBranch(repo.workspaceId, pr.head.ref);
  if (!issue) return;
  const meta = { github: { pr: pr.number, url: pr.html_url } };

  if (action === "opened" || action === "reopened" || action === "ready_for_review") {
    await transitionTo(repo.workspaceId, issue.key, issue.state, "in_progress", meta);
  } else if (action === "review_requested") {
    await transitionTo(repo.workspaceId, issue.key, issue.state, "in_review", meta);
  } else if (action === "closed" && pr.merged) {
    await transitionTo(repo.workspaceId, issue.key, issue.state, "done", meta);
  }
  // closed-unmerged and other actions: no movement
}

async function onPullRequestReview(
  repo: { workspaceId: string },
  payload: Payload,
) {
  const action = payload.action as string | undefined;
  if (action !== "submitted") return;
  const review = payload.review as
    | { state: string; html_url: string; user?: { login: string } }
    | undefined;
  const pr = payload.pull_request as GhPullRequest | undefined;
  if (!review?.state || !pr?.head?.ref) return;
  if (review.state !== "approved" && review.state !== "changes_requested") {
    return; // 'commented' and friends don't produce verdict events
  }
  const issue = await issueForBranch(repo.workspaceId, pr.head.ref);
  if (!issue) return;
  await db.insert(events).values({
    workspaceId: repo.workspaceId,
    entityType: "issue",
    entityId: issue.id,
    action: "github_review",
    actorType: "system",
    actorId: null,
    after: {
      verdict: review.state,
      reviewer: review.user?.login ?? "unknown",
      pr: pr.number,
      url: review.html_url,
    },
  });
}

async function onIssueOpened(
  repo: { id: string; workspaceId: string; teamId: string | null },
  payload: Payload,
) {
  const gh = payload.issue as GhIssue | undefined;
  if (!gh) return;

  // idempotent: a linked GH issue never double-intakes
  const [existing] = await db
    .select()
    .from(githubIssueLinks)
    .where(
      and(
        eq(githubIssueLinks.repoId, repo.id),
        eq(githubIssueLinks.ghIssueId, gh.id),
      ),
    )
    .limit(1);
  if (existing) return;

  // repo-linked team, else workspace's first team
  let teamId = repo.teamId;
  if (!teamId) {
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.workspaceId, repo.workspaceId))
      .orderBy(asc(teams.createdAt))
      .limit(1);
    teamId = team?.id ?? null;
  }
  if (!teamId) return;

  const issue = await createIssue({
    workspaceId: repo.workspaceId,
    teamId,
    title: gh.title,
    description: gh.body
      ? `${gh.body}\n\n---\nGitHub: ${gh.html_url}`
      : `GitHub: ${gh.html_url}`,
    source: "github",
    creator: SYSTEM,
    state: "triage",
  });

  await db.insert(githubIssueLinks).values({
    workspaceId: repo.workspaceId,
    repoId: repo.id,
    ghIssueId: gh.id,
    ghIssueNumber: gh.number,
    issueId: issue.id,
  });
}

async function onInstallationEvent(payload: Payload): Promise<boolean> {
  const p = payload as {
    action?: string;
    installation?: { id: number; account?: { login?: string } };
    repositories?: { id: number; full_name?: string; name: string }[];
    repositories_added?: { id: number; full_name?: string; name: string }[];
    repositories_removed?: { id: number; full_name?: string; name: string }[];
  };
  if (!p.installation?.id) return true;
  const installationId = p.installation.id;

  if (p.action === "deleted") {
    await db
      .delete(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId));
    return true;
  }

  const [inst] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  if (!inst) return false; // unbound — setup callback backfills later

  const added = [...(p.repositories ?? []), ...(p.repositories_added ?? [])];
  for (const repo of added) {
    const fullName = repo.full_name ?? repo.name;
    await db
      .insert(githubRepos)
      .values({
        workspaceId: inst.workspaceId,
        installationId,
        repoId: repo.id,
        fullName,
        enabled: false,
      })
      .onConflictDoUpdate({
        target: [githubRepos.workspaceId, githubRepos.fullName],
        set: { installationId, repoId: repo.id },
      });
  }
  for (const repo of p.repositories_removed ?? []) {
    const fullName = repo.full_name ?? repo.name;
    await db
      .delete(githubRepos)
      .where(
        and(
          eq(githubRepos.installationId, installationId),
          eq(githubRepos.fullName, fullName),
        ),
      );
  }
  return true;
}

// dispatch a stored delivery. Returns false when the event can't be fully
// processed yet (unbound installation) — caller leaves processedAt null.
export async function processGithubEvent(
  eventType: string,
  payload: Payload,
): Promise<boolean> {
  if (eventType === "installation" || eventType === "installation_repositories") {
    return onInstallationEvent(payload);
  }

  const repo = await repoFor(payload);
  if (!repo) return true; // untracked repo — consumed, nothing to do

  if (eventType === "push") await onPush(repo, payload);
  else if (eventType === "pull_request") await onPullRequest(repo, payload);
  else if (eventType === "pull_request_review") {
    await onPullRequestReview(repo, payload);
  } else if (eventType === "issues" && payload.action === "opened") {
    await onIssueOpened(repo, payload);
  }
  return true;
}
