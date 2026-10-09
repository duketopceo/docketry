import type { IssueState } from "./index.js";

const TRANSITIONS: Readonly<Record<IssueState, readonly IssueState[]>> = {
  triage: ["backlog", "canceled", "duplicate"],
  backlog: ["todo", "canceled", "duplicate"],
  todo: ["in_progress", "backlog", "canceled", "duplicate"],
  in_progress: ["in_review", "backlog", "canceled", "duplicate"],
  in_review: ["done", "in_progress", "canceled", "duplicate"],
  done: [],
  canceled: [],
  duplicate: [],
};

export function canTransition(from: IssueState, to: IssueState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function legalTransitions(from: IssueState): readonly IssueState[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION" as const;
  constructor(
    readonly from: IssueState,
    readonly to: IssueState,
  ) {
    super(`Invalid issue transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

// BFS shortest path [s1..to], or null when unreachable — shared by CLI/API
export function findPath(
  from: IssueState,
  to: IssueState,
): IssueState[] | null {
  if (from === to) return [];
  const seen = new Set<IssueState>([from]);
  const queue: { state: IssueState; path: IssueState[] }[] = [
    { state: from, path: [] },
  ];
  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    for (const next of legalTransitions(state)) {
      if (seen.has(next)) continue;
      const p = [...path, next];
      if (next === to) return p;
      seen.add(next);
      queue.push({ state: next, path: p });
    }
  }
  return null;
}
