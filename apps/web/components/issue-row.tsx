import type { IssueState, Priority } from "@docketry/types";
import Link from "next/link";

const STATE_DOT: Record<IssueState, string> = {
  triage: "bg-attention",
  backlog: "bg-neutral",
  todo: "bg-neutral",
  in_progress: "bg-attention",
  in_review: "bg-accent",
  done: "bg-healthy",
  canceled: "bg-ink-tertiary",
  duplicate: "bg-ink-tertiary",
};

const PRIORITY_BADGE: Partial<Record<Priority, string>> = {
  urgent: "text-urgent",
  high: "text-attention",
};

export interface IssueRowData {
  key: string;
  title: string;
  state: IssueState;
  priority: Priority;
  creatorType?: string;
  assigneeType?: string | null;
}

export function IssueRow({ issue }: { issue: IssueRowData }) {
  const agentTouched =
    issue.creatorType === "agent" || issue.assigneeType === "agent";
  return (
    <li>
      <Link
        href={`/issues/${issue.key}`}
        className="flex h-9 items-center gap-3 border-b border-lining-faint px-4 text-[13px] hover:bg-surface-1 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[issue.state]}`}
          aria-label={issue.state.replace("_", " ")}
          title={issue.state.replace("_", " ")}
        />
        <span className="w-20 shrink-0 font-mono text-xs text-ink-tertiary">
          {issue.key}
        </span>
        <span className="truncate text-ink-muted">{issue.title}</span>
        {agentTouched && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            className="shrink-0 fill-accent"
            aria-label="agent involved"
            role="img"
          >
            <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
          </svg>
        )}
        <span
          className={`ml-auto font-mono text-[11px] ${PRIORITY_BADGE[issue.priority] ?? "text-ink-tertiary"}`}
        >
          {issue.priority !== "none" ? issue.priority : ""}
        </span>
      </Link>
    </li>
  );
}
