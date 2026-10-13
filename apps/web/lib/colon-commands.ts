import { findPath, ISSUE_STATES, type IssueState } from "@tallyline/types";

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

interface MemberLite {
  userId: string;
  name: string;
  email: string;
}

interface LabelLite {
  id: string;
  name: string;
}

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

async function getLabels(): Promise<LabelLite[]> {
  const res = await fetch("/api/labels");
  if (!res.ok) return [];
  const d = (await res.json()) as { labels?: LabelLite[] };
  return d.labels ?? [];
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
        return { ok: false, message: "usage: :assign KEY me|member|agent" };
      }
      let assigneeType: "human" | "agent";
      let assigneeId: string;
      if (who === "me") {
        const me = (await (await fetch("/api/me")).json()) as MeLite;
        if (!me.userId) return { ok: false, message: "whoami failed" };
        assigneeType = "human";
        assigneeId = me.userId;
      } else {
        // member resolution first — humans are the common assignee; fall
        // back to agent names when no member matches
        const membersRes = await fetch("/api/settings/members");
        const { members } = (await membersRes
          .json()
          .catch(() => ({}))) as { members?: MemberLite[] };
        const needle = who.toLowerCase();
        const member = members?.find(
          (m) =>
            m.name.toLowerCase() === needle ||
            m.email.toLowerCase() === needle ||
            m.email.split("@")[0]!.toLowerCase() === needle,
        );
        if (member) {
          assigneeType = "human";
          assigneeId = member.userId;
        } else {
          const res = await fetch("/api/agents");
          const { agents } = (await res.json()) as { agents: AgentLite[] };
          const agent = agents?.find((a) => a.name === who);
          if (!agent) {
            return { ok: false, message: `member or agent '${who}' not found` };
          }
          assigneeType = "agent";
          assigneeId = agent.id;
        }
      }
      const r = await patchIssue(arg0, { assigneeType, assigneeId });
      return r.ok
        ? { ok: true, message: `${arg0} assigned to ${who}` }
        : { ok: false, message: r.message ?? "assign failed" };
    }
    case "priority":
    case "p": {
      const p = rest[1]?.toLowerCase();
      if (!arg0 || !p) {
        return { ok: false, message: `usage: :priority KEY ${PRIORITIES.join("|")}` };
      }
      if (!(PRIORITIES as readonly string[]).includes(p)) {
        return { ok: false, message: `priority must be one of ${PRIORITIES.join(", ")}` };
      }
      const r = await patchIssue(arg0, { priority: p });
      return r.ok
        ? { ok: true, message: `${arg0} → ${p}` }
        : { ok: false, message: r.message ?? "priority failed" };
    }
    case "unassign": {
      if (!arg0) return { ok: false, message: "usage: :unassign KEY" };
      const r = await patchIssue(arg0, { assigneeType: null, assigneeId: null });
      return r.ok
        ? { ok: true, message: `${arg0} unassigned` }
        : { ok: false, message: r.message ?? "unassign failed" };
    }
    case "label": {
      const op = rest[1]?.toLowerCase();
      const name = rest.slice(2).join(" ").trim();
      if (!arg0 || !op || (op !== "clear" && !name)) {
        return { ok: false, message: "usage: :label KEY add|remove|clear NAME…" };
      }
      const issue = (await fetch(`/api/issues/${encodeURIComponent(arg0)}`)
        .then((r) => (r.ok ? r.json() : null))) as {
        labels?: LabelLite[];
      } | null;
      if (!issue) return { ok: false, message: `${arg0} not found` };
      const current = new Set((issue.labels ?? []).map((l) => l.id));
      if (op === "clear") {
        const r = await patchIssue(arg0, { labelIds: [] });
        return r.ok
          ? { ok: true, message: `${arg0} labels cleared` }
          : { ok: false, message: r.message ?? "failed" };
      }
      const labels = await getLabels();
      const match = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        return { ok: false, message: `label '${name}' not found` };
      }
      if (op === "add") current.add(match.id);
      else if (op === "remove") current.delete(match.id);
      else {
        return { ok: false, message: "usage: :label KEY add|remove|clear NAME…" };
      }
      const r = await patchIssue(arg0, { labelIds: [...current] });
      return r.ok
        ? { ok: true, message: `${arg0} ${op === "add" ? "+" : "−"}${match.name}` }
        : { ok: false, message: r.message ?? "failed" };
    }
    case "due": {
      const when = rest[1];
      if (!arg0 || !when) {
        return { ok: false, message: "usage: :due KEY YYYY-MM-DD|none" };
      }
      const dueDate =
        when === "none"
          ? null
          : /^\d{4}-\d{2}-\d{2}$/.test(when)
            ? new Date(`${when}T00:00:00Z`).toISOString()
            : undefined;
      if (dueDate === undefined) {
        return { ok: false, message: "date must be YYYY-MM-DD or 'none'" };
      }
      const r = await patchIssue(arg0, { dueDate });
      return r.ok
        ? { ok: true, message: `${arg0} due ${when}` }
        : { ok: false, message: r.message ?? "due failed" };
    }
    case "estimate": {
      const n = rest[1];
      if (!arg0 || !n) {
        return { ok: false, message: "usage: :estimate KEY points|none" };
      }
      const estimate =
        n === "none" ? null : /^\d{1,2}$/.test(n) ? Number(n) : undefined;
      if (estimate === undefined) {
        return { ok: false, message: "estimate must be 0-99 or 'none'" };
      }
      const r = await patchIssue(arg0, { estimate });
      return r.ok
        ? { ok: true, message: `${arg0} estimate ${n}` }
        : { ok: false, message: r.message ?? "estimate failed" };
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
        message: `unknown command '${verb}' — try :state :done :start :assign :unassign :priority :label :due :estimate :comment :open`,
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
    case "unassign":
      return `unassign ${rest[0]?.toUpperCase() ?? "KEY"}`;
    case "priority":
    case "p":
      return `set ${rest[0]?.toUpperCase() ?? "KEY"} priority ${rest[1] ?? "…"}`;
    case "label":
      return `${rest[1] ?? "add|remove|clear"} label on ${rest[0]?.toUpperCase() ?? "KEY"}`;
    case "due":
      return `set ${rest[0]?.toUpperCase() ?? "KEY"} due ${rest[1] ?? "YYYY-MM-DD"}`;
    case "estimate":
      return `set ${rest[0]?.toUpperCase() ?? "KEY"} estimate ${rest[1] ?? "…"}`;
    case "comment":
      return `comment on ${rest[0]?.toUpperCase() ?? "KEY"}`;
    case "open":
      return `open ${rest[0]?.toUpperCase() ?? "KEY"}`;
    default:
      return "commands: state done start assign unassign priority label due estimate comment open";
  }
}
