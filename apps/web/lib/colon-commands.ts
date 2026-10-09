import { findPath, ISSUE_STATES, type IssueState } from "@docketry/types";

// `:…` command mode — parses and executes typed commands against the
// existing /api bridges. Kept framework-free so it stays unit-testable.

export interface CommandResult {
  ok: boolean;
  message: string;
  navigate?: string;
}

interface IssueDetailLite {
  key: string;
  state: IssueState;
}

interface AgentLite {
  id: string;
  name: string;
}

interface MeLite {
  userId?: string;
  workspaceSlug?: string;
}

async function getIssue(key: string): Promise<IssueDetailLite | null> {
  const res = await fetch(`/api/issues/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  return (await res.json()) as IssueDetailLite;
}

async function patchIssue(
  key: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/issues/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return { ok: false, message: err?.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

async function walkState(key: string, target: IssueState): Promise<CommandResult> {
  const issue = await getIssue(key);
  if (!issue) return { ok: false, message: `${key} not found` };
  const path = findPath(issue.state, target);
  if (!path) {
    return { ok: false, message: `no legal path ${issue.state} → ${target}` };
  }
  for (const step of path) {
    const r = await patchIssue(key, { state: step });
    if (!r.ok) return { ok: false, message: r.message ?? `failed at ${step}` };
  }
  return { ok: true, message: `${key} → ${target}` };
}

// parses and runs a `:` command line (without the leading colon)
export async function runColonCommand(line: string): Promise<CommandResult> {
  const [verb, ...rest] = line.trim().split(/\s+/);
  const arg0 = rest[0]?.toUpperCase();

  switch (verb) {
    case "open": {
      if (!arg0) return { ok: false, message: "usage: :open KEY" };
      return { ok: true, message: arg0, navigate: `/issues/${arg0}` };
    }
    case "state": {
      const target = rest[1];
      if (!arg0 || !target) {
        return { ok: false, message: "usage: :state KEY STATE" };
      }
      if (!(ISSUE_STATES as readonly string[]).includes(target)) {
        return {
          ok: false,
          message: `state must be one of ${ISSUE_STATES.join(", ")}`,
        };
      }
      return walkState(arg0, target as IssueState);
    }
    case "done":
      return arg0 ? walkState(arg0, "done") : { ok: false, message: "usage: :done KEY" };
    case "start":
      return arg0
        ? walkState(arg0, "in_progress")
        : { ok: false, message: "usage: :start KEY" };
    case "assign": {
      const who = rest[1];
      if (!arg0 || !who) {
        return { ok: false, message: "usage: :assign KEY me|agent-name" };
      }
      let assigneeType: "human" | "agent";
      let assigneeId: string;
      if (who === "me") {
        const me = (await (await fetch("/api/me")).json()) as MeLite;
        if (!me.userId) return { ok: false, message: "whoami failed" };
        assigneeType = "human";
        assigneeId = me.userId;
      } else {
        const res = await fetch("/api/agents");
        const { agents } = (await res.json()) as { agents: AgentLite[] };
        const agent = agents?.find((a) => a.name === who);
        if (!agent) return { ok: false, message: `agent '${who}' not found` };
        assigneeType = "agent";
        assigneeId = agent.id;
      }
      const r = await patchIssue(arg0, { assigneeType, assigneeId });
      return r.ok
        ? { ok: true, message: `${arg0} assigned to ${who}` }
        : { ok: false, message: r.message ?? "assign failed" };
    }
    case "comment": {
      const text = rest.slice(1).join(" ").trim();
      if (!arg0 || !text) {
        return { ok: false, message: "usage: :comment KEY text…" };
      }
      const res = await fetch(`/api/issues/${encodeURIComponent(arg0)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      return res.ok
        ? { ok: true, message: `commented on ${arg0}` }
        : { ok: false, message: `comment failed (HTTP ${res.status})` };
    }
    default:
      return {
        ok: false,
        message: `unknown command '${verb}' — try :state :done :start :assign :comment :open`,
      };
  }
}

// one-line plan preview shown under the input while typing a `:` command
export function colonHint(line: string): string {
  const [verb, ...rest] = line.trim().split(/\s+/);
  switch (verb) {
    case "state":
      return `move ${rest[0]?.toUpperCase() ?? "KEY"} to '${rest[1] ?? "…"}'`;
    case "done":
      return `move ${rest[0]?.toUpperCase() ?? "KEY"} to done`;
    case "start":
      return `move ${rest[0]?.toUpperCase() ?? "KEY"} to in_progress`;
    case "assign":
      return `assign ${rest[0]?.toUpperCase() ?? "KEY"} to ${rest[1] ?? "…"}`;
    case "comment":
      return `comment on ${rest[0]?.toUpperCase() ?? "KEY"}`;
    case "open":
      return `open ${rest[0]?.toUpperCase() ?? "KEY"}`;
    default:
      return "commands: state done start assign comment open";
  }
}
