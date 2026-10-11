"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "./primitives";
import type { ListIssue } from "./issue-list-client";

// ssr:false keeps dnd-kit out of the initial bundle (R10); the columns
// mount client-side under a skeleton
const BoardClient = dynamic(
  () => import("./board-client").then((m) => m.BoardClient),
  {
    ssr: false,
    loading: () => <LoadingState label="loading board…" />,
  },
);

export function BoardLoader({ issues }: { issues: ListIssue[] }) {
  return <BoardClient issues={issues} />;
}
