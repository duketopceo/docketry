import type { Comment, Issue } from "./client.js";

// slug for `<KEY>-slug` branch convention (SKILL.md)
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "work";
}

export function branchName(key: string, title: string): string {
  return `${key}-${slugify(title)}`;
}

// canonical local-harness binaries by adapter/harness name
const HARNESS_BINS: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  local: "claude",
};

export function harnessBin(harness: string): string | undefined {
  return HARNESS_BINS[harness] ?? (harness.startsWith("cmd:") ? harness.slice(4) : undefined);
}

// the seeded context a spawned harness session starts with
export function buildWorkPrompt(input: {
  issue: Issue;
  comments: Comment[];
  agentName: string;
  workspace: string;
}): string {
  const { issue, comments, agentName, workspace } = input;
  const lines = [
    `# ${issue.key}: ${issue.title}`,
    "",
    `You are @${agentName}, a dispatched agent in the '${workspace}' docketry workspace.`,
    "",
    "## Board rules",
    "- Work in this worktree on branch `" +
      branchName(issue.key, issue.title) +
      "` — commit as `feat(scope): msg (#<n>)` or `fix: …`",
    "- Post progress to your session timeline: `docketry session " +
      "implementing what you're doing` (kinds: reading|planning|" +
      "implementing|testing|reviewing|pr|note|error; " +
      "DOCKETRY_DISPATCH_ID is set for you)",
    "- Post milestone notes as comments via `docketry comment " + issue.key + ' "…"`',
    "- When done: `docketry done " + issue.key + "`; mark done ONLY when the change is pushed/PR'd",
    "",
    "## Issue",
    `state: ${issue.state} · priority: ${issue.priority}`,
    "",
    issue.description ?? "(no description)",
  ];
  if (comments.length > 0) {
    lines.push("", "## Thread");
    for (const c of comments) {
      lines.push(`- [${c.actorType}] ${c.body}`);
    }
  }
  return lines.join("\n");
}
