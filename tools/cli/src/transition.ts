import { findPath, type IssueState } from "@docketry/types";
import { ApiError, type ApiClient, type Issue } from "./client.js";

export { findPath };

const MAX_ATTEMPTS = 8;

// Walk `key` to `target` one legal transition at a time. Re-plans when a
// PATCH comes back 409 (e.g. the issue moved under us) instead of assuming
// the machine never changed.
export async function transitionTo(
  client: ApiClient,
  key: string,
  target: IssueState,
): Promise<Issue> {
  let issue: Issue = await client.getIssue(key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (issue.state === target) return issue;
    const path = findPath(issue.state, target);
    if (!path || path.length === 0) {
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        `no legal transition path: ${issue.state} -> ${target}`,
      );
    }
    try {
      issue = await client.patchIssue(key, { state: path[0]! });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        issue = await client.getIssue(key); // drifted — recompute
        continue;
      }
      throw err;
    }
  }
  throw new ApiError(
    409,
    "INVALID_TRANSITION",
    `could not reach '${target}' from '${issue.state}'`,
  );
}
