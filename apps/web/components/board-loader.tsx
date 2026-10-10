"use client";

import dynamic from "next/dynamic";
import type { ListIssue } from "./issue-list-client";

// ssr:false keeps dnd-kit out of the initial bundle (R10); the columns
// mount client-side under a skeleton
const BoardClient = dynamic(
  () => import("./board-client").then((m) => m.BoardClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 animate-pulse items-center justify-center font-mono text-[11px] text-ink-tertiary">
        loading board…
      </div>
    ),
  },
);

export function BoardLoader({ issues }: { issues: ListIssue[] }) {
  return <BoardClient issues={issues} />;
}
