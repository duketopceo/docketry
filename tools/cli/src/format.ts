import type { Priority } from "@docketry/types";
import type {
  Comment,
  FeedEvent,
  Issue,
  IssueDetail,
} from "./client.js";

// Lower sorts first — urgent at the top of `ready`.
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function compareForReady(a: Issue, b: Issue): number {
  const d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return d !== 0 ? d : a.number - b.number;
}

// Slim issue shape for `--json` — stable keys for agent chaining.
export function slimIssue(i: Issue) {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    state: i.state,
    priority: i.priority,
    assigneeType: i.assigneeType,
    assigneeId: i.assigneeId,
    updatedAt: i.updatedAt,
  };
}

export function issueRow(i: Issue): string {
  const assignee = i.assigneeId ? ` @${i.assigneeType ?? "?"}` : "";
  return `${i.key.padEnd(10)} ${i.state.padEnd(11)} ${i.priority.padEnd(7)} ${i.title}${assignee}`;
}

function stamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z?$/, "");
}

export function issueDetail(
  i: IssueDetail,
  comments: Comment[],
): string[] {
  const lines: string[] = [
    `${i.key}  ${i.title}`,
    `state:     ${i.state}`,
    `priority:  ${i.priority}`,
    `assignee:  ${
      i.assigneeId ? `${i.assigneeType} ${i.assigneeId}` : "unassigned"
    }`,
    `creator:   ${i.creatorType}${i.creatorId ? ` ${i.creatorId}` : ""}`,
    `created:   ${stamp(i.createdAt)}`,
    `updated:   ${stamp(i.updatedAt)}`,
  ];
  if (i.labels?.length) {
    lines.push(
      `labels:    ${i.labels.map((l) => l.name).join(", ")}`,
    );
  }
  if (i.children?.length) {
    lines.push(
      `children:  ${i.children.map((c) => `${c.key} ${c.title}`).join(", ")}`,
    );
  }
  if (i.description) {
    lines.push("", i.description.trimEnd());
  }
  if (comments.length > 0) {
    lines.push("", "comments:");
    for (const c of comments) {
      lines.push(`  [${c.actorType} · ${stamp(c.createdAt)}] ${c.body}`);
    }
  }
  return lines;
}

export function eventLine(e: FeedEvent): string {
  const actor = e.actorName
    ? `${e.actorType}:${e.actorName}`
    : e.actorType;
  const what = e.issueKey ?? `${e.entityType}:${e.entityId.slice(0, 8)}`;
  return `${e.id.padStart(6)}  ${stamp(e.createdAt)}  ${actor.padEnd(18)} ${e.action.padEnd(14)} ${what}`;
}
