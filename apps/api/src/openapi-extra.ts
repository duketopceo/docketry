// OpenAPI path items for the operations added after the first spec pass
// (auth, dispatch/review, github, import, webhook endpoints, public webhooks).
// Merged into the served document by openapi.ts; the route-diff test fails if
// any registered route is missing from the merged result.

type PathItem = Record<string, unknown>;

const wsParam = {
  name: "ws",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;
const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;
const keyParam = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[A-Z][A-Z0-9]*-\\d+$" },
} as const;

const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } },
});

const repoBody = jsonBody({
  type: "object",
  required: ["fullName"],
  properties: {
    fullName: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
    teamKey: { type: "string", pattern: "^[A-Z][A-Z0-9]*$" },
  },
});

const importTarget = { type: "string", enum: ["triage", "backlog"], default: "triage" };

export const extraPaths: Record<string, PathItem> = {
  "/openapi.json": {
    get: {
      summary: "This OpenAPI document",
      responses: { "200": { description: "OpenAPI 3.1 document" } },
    },
  },
  "/webhooks/github": {
    post: {
      summary:
        "GitHub App webhook receiver — HMAC-verified (X-Hub-Signature-256), deduped on X-GitHub-Delivery; unauthenticated by session",
      responses: {
        "200": { description: "Accepted (or duplicate delivery dropped)" },
        "400": { description: "Missing delivery headers or invalid JSON" },
        "401": { description: "Bad signature" },
        "503": { description: "GITHUB_WEBHOOK_SECRET not configured" },
      },
    },
  },
  "/webhooks/slack": {
    post: {
      summary:
        "Slack slash-command / interactivity / events receiver — signature-verified; unauthenticated by session",
      responses: {
        "200": { description: "Handled" },
        "401": { description: "Bad signature" },
        "503": { description: "Slack not configured" },
      },
    },
  },
  "/v1/auth/bootstrap": {
    post: {
      summary:
        "First-run: create the initial workspace, team and owner (only while the instance has no users)",
      requestBody: jsonBody({
        type: "object",
        required: ["workspaceSlug", "workspaceName", "email", "name", "password"],
        properties: {
          workspaceSlug: { type: "string", pattern: "^[a-z0-9-]+$" },
          workspaceName: { type: "string" },
          teamKey: { type: "string", default: "DOK" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          password: { type: "string", minLength: 10 },
        },
      }),
      responses: {
        "201": { description: "Bootstrapped; session cookie set" },
        "403": { description: "Password auth disabled" },
        "409": { description: "Instance already bootstrapped" },
      },
    },
  },
  "/v1/auth/login": {
    post: {
      summary: "Email + password login; sets the session cookie",
      requestBody: jsonBody({
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      }),
      responses: {
        "200": { description: "Logged in" },
        "401": { description: "Bad credentials" },
        "403": { description: "Password auth disabled" },
      },
    },
  },
  "/v1/auth/logout": {
    post: {
      summary: "Destroy the current cookie session",
      responses: { "200": { description: "Logged out" } },
    },
  },
  "/v1/auth/me": {
    get: {
      summary: "Current user, active workspace and memberships (cookie session)",
      responses: {
        "200": { description: "Session identity" },
        "401": { description: "No or expired session" },
      },
    },
  },
  "/v1/auth/session": {
    post: {
      summary:
        "Re-bind a cookie session's active workspace (workspace picker); cookie sessions only",
      requestBody: jsonBody({
        type: "object",
        required: ["workspaceSlug"],
        properties: { workspaceSlug: { type: "string" } },
      }),
      responses: {
        "200": { description: "Rebound; returns memberships" },
        "403": { description: "Not a member / not a cookie session" },
        "404": { description: "Workspace not found" },
      },
    },
  },
  "/v1/workspaces/{ws}": {
    get: {
      summary: "Get workspace",
      parameters: [wsParam],
      responses: {
        "200": { description: "Workspace" },
        "404": { description: "Not found or not a member" },
      },
    },
  },
  "/v1/workspaces/{ws}/issues/{key}/review": {
    post: {
      summary:
        "Review an in_review issue — approve (moves to done) or send_back (re-dispatches with feedback)",
      parameters: [wsParam, keyParam],
      requestBody: jsonBody({
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["approve", "send_back"] },
          feedback: { type: "string", maxLength: 5000 },
        },
      }),
      responses: {
        "200": { description: "Review recorded" },
        "409": { description: "Issue is not in_review" },
      },
    },
  },
  "/v1/workspaces/{ws}/issues/{key}/sessions": {
    get: {
      summary: "Agent session runs (dispatches) for an issue, each with its event log",
      parameters: [wsParam, keyParam],
      responses: { "200": { description: "Sessions" }, "404": { description: "Issue not found" } },
    },
  },
  "/v1/workspaces/{ws}/dispatches": {
    get: {
      summary: "List dispatches — agent keys only see their own",
      parameters: [
        wsParam,
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: ["queued", "claimed", "dispatch_failed", "completed", "canceled"],
          },
        },
        { name: "agentId", in: "query", schema: { type: "string", format: "uuid" } },
      ],
      responses: { "200": { description: "Dispatches" } },
    },
  },
  "/v1/workspaces/{ws}/review-queue": {
    get: {
      summary: "Issues waiting in in_review, grouped with their latest agent run",
      parameters: [wsParam],
      responses: { "200": { description: "Review queue" } },
    },
  },
  "/v1/workspaces/{ws}/dispatches/{id}/report": {
    post: {
      summary: "Agent session lifecycle report (completed / failed, optional branch + PR URL)",
      parameters: [wsParam, idParam],
      requestBody: jsonBody({
        type: "object",
        required: ["outcome"],
        properties: {
          outcome: { type: "string", enum: ["completed", "failed"] },
          reason: { type: "string", maxLength: 500 },
          branch: { type: "string", maxLength: 200 },
          prUrl: { type: "string", format: "uri" },
        },
      }),
      responses: {
        "200": { description: "Report recorded" },
        "403": { description: "Agent key reporting another agent's dispatch" },
        "404": { description: "Dispatch not found" },
      },
    },
  },
  "/v1/workspaces/{ws}/dispatches/{id}/events": {
    get: {
      summary: "Session event log for a dispatch",
      parameters: [wsParam, idParam],
      responses: {
        "200": { description: "Events" },
        "403": { description: "Agent key reading another agent's dispatch" },
        "404": { description: "Dispatch not found" },
      },
    },
    post: {
      summary: "Append session events (1-50) to a dispatch's log",
      parameters: [wsParam, idParam],
      requestBody: jsonBody({
        type: "object",
        required: ["events"],
        properties: {
          events: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: {
              type: "object",
              required: ["kind", "message"],
              properties: {
                kind: { type: "string" },
                message: { type: "string", maxLength: 500 },
              },
            },
          },
        },
      }),
      responses: {
        "201": { description: "Events appended" },
        "403": { description: "Agent key writing another agent's dispatch" },
        "404": { description: "Dispatch not found" },
      },
    },
  },
  "/v1/workspaces/{ws}/github/manifest": {
    get: {
      summary:
        "GitHub App manifest (POST it to github.com/settings/apps/new); redirect_url points at the web callback",
      parameters: [wsParam],
      responses: { "200": { description: "App manifest JSON" } },
    },
  },
  "/github/manifest/callback/{state}": {
    get: {
      summary:
        "Public redirect target of the GitHub App manifest flow (the manifest's redirect_url). Exchanges ?code for the new App's credentials and shows them once; nothing is stored. Send Accept: application/json for JSON.",
      parameters: [
        {
          name: "state",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Signed, 10-minute workspace-bound token from the manifest",
        },
        { name: "code", in: "query", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Credentials page (HTML) or JSON; Cache-Control: no-store" },
        "400": { description: "Invalid/expired state or code" },
        "502": { description: "GitHub rejected the conversion" },
      },
    },
  },
  "/v1/workspaces/{ws}/github/install-url": {
    get: {
      summary: "URL to install the configured GitHub App",
      parameters: [wsParam],
      responses: {
        "200": { description: "installUrl" },
        "503": { description: "GITHUB_APP_SLUG not set" },
      },
    },
  },
  "/v1/workspaces/{ws}/github/setup": {
    get: {
      summary:
        "Bind a GitHub App installation to this workspace (verifies the App owns installation_id; 409 if bound elsewhere)",
      parameters: [
        wsParam,
        {
          name: "installation_id",
          in: "query",
          required: true,
          schema: { type: "integer" },
        },
        { name: "account_login", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Bound" },
        "400": { description: "Missing/invalid installation_id" },
        "404": { description: "Installation does not belong to this GitHub App" },
        "409": { description: "Installation already bound to another workspace" },
        "503": { description: "GitHub App credentials not configured" },
      },
    },
  },
  "/v1/workspaces/{ws}/github/repos": {
    get: {
      summary: "Linked GitHub repos",
      parameters: [wsParam],
      responses: { "200": { description: "Repos" } },
    },
  },
  "/v1/workspaces/{ws}/github/repos/connect": {
    post: {
      summary: "Enable sync for a repo (optionally pinned to a team)",
      parameters: [wsParam],
      requestBody: repoBody,
      responses: { "200": { description: "Repo link" }, "404": { description: "Team not found" } },
    },
  },
  "/v1/workspaces/{ws}/github/repos/disconnect": {
    post: {
      summary: "Disable sync for a repo",
      parameters: [wsParam],
      requestBody: repoBody,
      responses: { "200": { description: "Repo link" }, "404": { description: "Repo not linked" } },
    },
  },
  "/v1/workspaces/{ws}/import/github": {
    post: {
      summary: "One-shot import of a repo's issues using a caller-supplied token",
      parameters: [wsParam],
      requestBody: jsonBody({
        type: "object",
        required: ["fullName", "token"],
        properties: {
          fullName: { type: "string" },
          token: { type: "string" },
          target: importTarget,
          teamKey: { type: "string" },
        },
      }),
      responses: {
        "200": { description: "Import result (created/skipped/errors)" },
        "404": { description: "Team not found" },
        "502": { description: "GitHub import failed" },
      },
    },
  },
  "/v1/workspaces/{ws}/import/linear": {
    post: {
      summary: "Import a Linear CSV export into a team",
      parameters: [wsParam],
      requestBody: jsonBody({
        type: "object",
        required: ["teamKey", "csv"],
        properties: {
          teamKey: { type: "string" },
          target: importTarget,
          csv: { type: "string" },
        },
      }),
      responses: { "200": { description: "Import result" }, "404": { description: "Team not found" } },
    },
  },
  "/v1/workspaces/{ws}/webhook-endpoints": {
    get: {
      summary: "List outbound webhook endpoints (secrets masked to last 4)",
      parameters: [wsParam],
      responses: { "200": { description: "Endpoints" } },
    },
    post: {
      summary: "Create an outbound webhook endpoint; the signing secret is returned once",
      parameters: [wsParam],
      requestBody: jsonBody({
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri" },
          events: { type: "array", items: { type: "string" }, default: ["*"] },
          secret: { type: "string", minLength: 16, maxLength: 128 },
        },
      }),
      responses: { "201": { description: "Endpoint created (includes secret)" } },
    },
  },
  "/v1/workspaces/{ws}/webhook-endpoints/{id}": {
    patch: {
      summary: "Update an endpoint (url, events, enabled)",
      parameters: [wsParam, idParam],
      requestBody: jsonBody({
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          events: { type: "array", items: { type: "string" } },
          enabled: { type: "boolean" },
        },
      }),
      responses: { "200": { description: "Endpoint" }, "404": { description: "Not found" } },
    },
    delete: {
      summary: "Delete an endpoint",
      parameters: [wsParam, idParam],
      responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
    },
  },
  "/v1/workspaces/{ws}/webhook-endpoints/{id}/deliveries": {
    get: {
      summary: "Last 50 delivery attempts for an endpoint",
      parameters: [wsParam, idParam],
      responses: { "200": { description: "Deliveries" } },
    },
  },
};
