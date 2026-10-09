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
