/**
 * Outbound webhook event catalog — `entityType.action` names as delivered by
 * docketry (see docs/webhooks.md and apps/api/src/services/outbound.ts).
 */
export const DOCKETRY_EVENTS = [
	{ value: "issue.created", name: "Issue Created" },
	{ value: "issue.state_changed", name: "Issue State Changed" },
	{ value: "issue.commented", name: "Issue Commented" },
	{ value: "issue.github_review", name: "Issue GitHub Review" },
	{ value: "issue.dispatched", name: "Issue Dispatched" },
	{ value: "issue.dispatch_delivered", name: "Issue Dispatch Delivered" },
	{ value: "issue.dispatch_failed", name: "Issue Dispatch Failed" },
	{ value: "issue.session_update", name: "Issue Session Update" },
] as const;

export type DocketryEventAction =
	(typeof DOCKETRY_EVENTS)[number]["value"];

/**
 * Normalizes the node's multi-select into the `events` array the
 * webhook-endpoints API expects: a `*` anywhere collapses to `["*"]`,
 * otherwise the selection is deduped.
 */
export function normalizeEventSelection(selected: string[]): string[] {
	if (selected.includes("*")) return ["*"];
	return [...new Set(selected)];
}
