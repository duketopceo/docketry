"use client";

import type { IssueState, Priority } from "@docketry/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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

export interface ListIssue {
  key: string;
  title: string;
  state: IssueState;
  priority: Priority;
  creatorType?: string;
  assigneeType?: string | null;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

export function IssueListClient({
  issues,
  triage = false,
}: {
  issues: ListIssue[];
  triage?: boolean;
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const transition = useCallback(
    async (keys: ReadonlySet<string>, state: IssueState) => {
      await Promise.all(
        [...keys].map((key) => {
          setBusy(key);
          return fetch(`/api/issues/${key}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state }),
          });
        }),
      );
      setSelected(new Set());
      setBusy(null);
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey)
        return;
      const issue = issues[cursor];
      const targets = selected.size > 0 ? selected : new Set(issue ? [issue.key] : []);
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, issues.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "x":
          if (!issue) break;
          setSelected((s) => {
            const next = new Set(s);
            if (next.has(issue.key)) next.delete(issue.key);
            else next.add(issue.key);
            return next;
          });
          break;
        case "Enter":
          if (issue) router.push(`/issues/${issue.key}`);
          break;
        case "Escape":
          setSelected(new Set());
          break;
        case "a":
          if (triage) void transition(targets, "backlog");
          break;
        case "d":
          if (triage) void transition(targets, "canceled");
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cursor, issues, router, selected, transition, triage]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul ref={listRef} className="flex-1 overflow-y-auto">
        {issues.map((issue, i) => {
          const agentTouched =
            issue.creatorType === "agent" || issue.assigneeType === "agent";
          const isCursor = i === cursor;
          const isSelected = selected.has(issue.key);
          return (
            <li key={issue.key}>
              <button
                type="button"
                data-index={i}
                onClick={() => router.push(`/issues/${issue.key}`)}
                onMouseEnter={() => setCursor(i)}
                className={`flex h-9 w-full items-center gap-3 border-b border-lining-faint px-4 text-left text-[13px] focus-visible:outline-none ${
                  isCursor ? "bg-surface-2" : "hover:bg-surface-1"
                } ${isSelected ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}
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
                {busy === issue.key ? (
                  <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
                    …
                  </span>
                ) : (
                  <span
                    className={`ml-auto font-mono text-[11px] ${PRIORITY_BADGE[issue.priority] ?? "text-ink-tertiary"}`}
                  >
                    {issue.priority !== "none" ? issue.priority : ""}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-lining-faint px-4 font-mono text-[10px] text-ink-tertiary">
        <span>
          <kbd>j</kbd>/<kbd>k</kbd> move
        </span>
        <span>
          <kbd>x</kbd> select
        </span>
        <span>
          <kbd>⏎</kbd> open
        </span>
        <span>
          <kbd>c</kbd> create
        </span>
        {triage && (
          <>
            <span className="text-attention">
              <kbd>a</kbd> accept → backlog
            </span>
            <span>
              <kbd>d</kbd> decline
            </span>
          </>
        )}
        {selected.size > 0 && (
          <span className="ml-auto text-ink-muted">
            {selected.size} selected
          </span>
        )}
      </footer>
    </div>
  );
}
