/**
 * Pure mapping between n8n parameter values and docketry API payloads.
 * Kept free of n8n imports so it can be unit-tested without the runtime.
 */

export type LooseFields = Record<string, unknown>;

/**
 * Extracts the ID out of a resourceLocator-shaped parameter value
 * (`{__rl: true, mode, value}`) — list mode and free-id mode both carry the
 * id under `value`.
 */
export function rlcValue(param: unknown): string {
	if (typeof param === "string") return param;
	if (typeof param === "object" && param !== null && "value" in param) {
		const value = (param as { value: unknown }).value;
		return typeof value === "string" ? value : "";
	}
	return "";
}

const ISSUE_STATES = [
	"triage",
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"done",
	"canceled",
	"duplicate",
] as const;

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

function isSet(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

function take(fields: LooseFields, name: string): string | undefined {
	const value = fields[name];
	return isSet(value) ? value : undefined;
}

/**
 * POST /issues body. Only non-empty fields are sent so the API defaults
 * apply (state defaults to `backlog`; source is always `api` from n8n).
 */
export function buildIssueCreateBody(fields: LooseFields): LooseFields {
	const body: LooseFields = {
		teamKey: fields.teamKey,
		title: fields.title,
		source: "api",
	};
	for (const key of [
		"description",
		"priority",
		"state",
		"cycleId",
		"projectId",
		"parentId",
	] as const) {
		const value = take(fields, key);
		if (value !== undefined) body[key] = value;
	}
	// An assignee requires both halves — the node validates the pair.
	if (isSet(fields.assigneeType) && isSet(fields.assigneeId)) {
		body.assigneeType = fields.assigneeType;
		body.assigneeId = fields.assigneeId;
	}
	if (Array.isArray(fields.labelIds) && fields.labelIds.length > 0) {
		body.labelIds = fields.labelIds;
	}
	return body;
}

/**
 * Fields that PATCH accepts as `null` to clear. `assignee` expands to the
 * assigneeType+assigneeId pair.
 */
export const CLEARABLE_FIELDS = {
	description: ["description"],
	dueDate: ["dueDate"],
	estimate: ["estimate"],
	assignee: ["assigneeType", "assigneeId"],
	cycle: ["cycleId"],
	project: ["projectId"],
	parent: ["parentId"],
} as const;

export type ClearableFieldName = keyof typeof CLEARABLE_FIELDS;

/**
 * PATCH /issues/{key} body. Non-empty values are sent as-is; names listed
 * under `clearFields` are sent as `null` so operators can un-set values.
 */
export function buildIssueUpdateBody(fields: LooseFields): LooseFields {
	const body: LooseFields = {};

	const title = take(fields, "title");
	if (title !== undefined) body.title = title;

	const description = take(fields, "description");
	if (description !== undefined) body.description = description;

	const state = take(fields, "state");
	if (state !== undefined && (ISSUE_STATES as readonly string[]).includes(state)) {
		body.state = state;
	}

	const priority = take(fields, "priority");
	if (priority !== undefined && (PRIORITIES as readonly string[]).includes(priority)) {
		body.priority = priority;
	}

	const estimate = fields.estimate;
	if (typeof estimate === "number" && Number.isFinite(estimate)) {
		body.estimate = Math.trunc(estimate);
	}

	const dueDate = take(fields, "dueDate");
	if (dueDate !== undefined) body.dueDate = dueDate;

	if (isSet(fields.assigneeType) && isSet(fields.assigneeId)) {
		body.assigneeType = fields.assigneeType;
		body.assigneeId = fields.assigneeId;
	}

	for (const key of ["cycleId", "projectId", "parentId"] as const) {
		const value = take(fields, key);
		if (value !== undefined) body[key] = value;
	}

	if (Array.isArray(fields.clearFields)) {
		for (const name of fields.clearFields) {
			const mapped = CLEARABLE_FIELDS[name as ClearableFieldName];
			if (mapped) {
				for (const apiField of mapped) body[apiField] = null;
			}
		}
	}

	return body;
}

/**
 * Query params for GET /issues — drops empty values, keeps `limit` when
 * `returnAll` is off.
 */
export function buildIssueListQuery(
	filters: LooseFields,
	limit?: number,
): Record<string, string | number> {
	const qs: Record<string, string | number> = {};
	for (const key of [
		"state",
		"priority",
		"team",
		"assignee",
		"cycle",
		"project",
		"label",
		"source",
		"search",
	] as const) {
		const value = take(filters, key);
		if (value !== undefined) qs[key] = value;
	}
	if (limit !== undefined) qs.limit = limit;
	return qs;
}
