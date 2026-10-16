"use client";

import { BoardClient } from "./board-client";
import type { ListIssue } from "./issue-list-client";

// The board renders on the server (cards are in the first HTML, so LCP is real
// content, not a skeleton) and hydrates; dnd-kit gets a stable DndContext id.
export function BoardLoader({ issues }: { issues: ListIssue[] }) {
  return <BoardClient issues={issues} />;
}
