import type { IssueState } from "@tallyline/types";

export type CollapsePref = "collapsed" | "expanded" | undefined;

export type ColumnPrefs = Partial<Record<IssueState, "collapsed" | "expanded">>;

export const COLUMN_PREFS_KEY = "tly:board:columns";

// Empty columns collapse unless the user pinned them open; non-empty columns
// expand unless pinned shut (DESIGN: "hide empty board columns by default").
export function resolveCollapsed(pref: CollapsePref, empty: boolean): boolean {
  return pref === "collapsed" || (pref !== "expanded" && empty);
}

export function readColumnPrefs(): ColumnPrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(COLUMN_PREFS_KEY) ?? "{}",
    ) as ColumnPrefs;
  } catch {
    return {};
  }
}

export function writeColumnPrefs(prefs: ColumnPrefs): void {
  try {
    window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — session-only pref is fine
  }
}
