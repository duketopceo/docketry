/**
 * URL helpers shared by the action node, the trigger's webhook lifecycle
 * methods, and every loadOptions call.
 */

export interface DocketryCredentialShape {
	baseUrl: string;
	workspace: string;
}

/** Trims whitespace and strips trailing slashes from a user-entered base URL. */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Builds a workspace-scoped API URL: `{base}/v1/workspaces/{ws}{path}`.
 * `path` must start with `/`.
 */
export function workspaceUrl(
	credentials: DocketryCredentialShape,
	path: string,
): string {
	const base = normalizeBaseUrl(credentials.baseUrl);
	const ws = encodeURIComponent(credentials.workspace.trim());
	return `${base}/v1/workspaces/${ws}${path}`;
}

/**
 * Extracts a list envelope (`{teams: [...]}`, `{issues: [...]}`, …) from an
 * API response, tolerating a missing key as an empty list.
 */
export function extractList(response: unknown, key: string): unknown[] {
	if (
		typeof response === "object" &&
		response !== null &&
		key in response &&
		Array.isArray((response as Record<string, unknown>)[key])
	) {
		return (response as Record<string, unknown[]>)[key] as unknown[];
	}
	return [];
}

/** Reads a string field from a loosely-typed API row. */
export function str(row: unknown, field: string): string | undefined {
	if (typeof row !== "object" || row === null) return undefined;
	const value = (row as Record<string, unknown>)[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** Reads a numeric field from a loosely-typed API row. */
export function num(row: unknown, field: string): number | undefined {
	if (typeof row !== "object" || row === null) return undefined;
	const value = (row as Record<string, unknown>)[field];
	return typeof value === "number" ? value : undefined;
}
