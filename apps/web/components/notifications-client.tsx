"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RelativeTime } from "@/components/primitives";

export interface InboxRow {
  id: number;
  kind: "assigned" | "mention" | "review_pending" | "dispatch_failed";
  issueId: string | null;
  issueKey: string | null;
  issueTitle: string | null;
  actorType: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

const KIND_TEXT: Record<InboxRow["kind"], string> = {
  assigned: "assigned you",
  mention: "mentioned you on",
  review_pending: "is waiting for review",
  dispatch_failed: "dispatch failed on",
};

export function NotificationsClient({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markRead(id: number) {
    await fetch(`/api/notifications/${id}`, { method: "POST" });
    router.refresh();
  }

  async function markAll() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/notifications/read-all", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  const unread = rows.filter((r) => !r.readAt);

  return (
    <>
      {unread.length > 0 && (
        <div className="flex justify-end border-b border-lining-faint px-4 py-1.5">
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={busy}
            className="font-mono text-[11px] text-ink-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            mark all read
          </button>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto">
        {rows.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.readAt) void markRead(n.id);
                if (n.issueKey) router.push(`/issues/${n.issueKey}`);
              }}
              className={`flex w-full items-center gap-3 border-b border-lining-faint px-4 py-2.5 text-left hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-accent ${
                n.readAt ? "opacity-60" : ""
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  n.readAt ? "bg-transparent" : "bg-accent"
                }`}
              />
              {n.issueKey && (
                <span className="font-mono text-[11px] text-ink-tertiary">
                  {n.issueKey}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                {n.issueTitle ?? ""}
                <span className="text-ink-subtle"> — {KIND_TEXT[n.kind]}</span>
              </span>
              <RelativeTime iso={n.createdAt} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
