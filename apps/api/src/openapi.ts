const wsParam = {
  name: "ws",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

const keyParam = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[A-Z][A-Z0-9]*-\\d+$" },
} as const;

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

export const openApiDoc = {
  openapi: "3.1.0",
  info: {
    title: "docketry API",
    version: "0.0.0",
    description:
      "Self-hostable, agent-native issue tracker. All resources are workspace-scoped; issue keys are TEAM-n.",
  },
  servers: [{ url: "http://localhost:4000" }],
  paths: {
    "/health": {
      get: {
        summary: "Liveness + dependency check (postgres, redis)",
        responses: {
          "200": { description: "All dependencies healthy" },
          "503": { description: "One or more dependencies down" },
        },
      },
    },
    "/v1/workspaces": {
      post: {
        summary: "Create workspace",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slug", "name"],
                properties: {
                  slug: { type: "string", pattern: "^[a-z0-9-]+$" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Workspace created" },
          "409": { description: "Slug taken" },
        },
      },
    },
    "/v1/workspaces/{ws}/teams": {
      get: {
        summary: "List teams in workspace",
        parameters: [wsParam],
        responses: { "200": { description: "Teams" } },
      },
      post: {
        summary: "Create team",
        parameters: [wsParam],
        requestBody: jsonBody({
          type: "object",
          required: ["key", "name"],
          properties: {
            key: { type: "string", pattern: "^[A-Z][A-Z0-9]*$" },
            name: { type: "string" },
            rolloverBehavior: {
              type: "string",
              enum: ["next_cycle", "backlog"],
            },
          },
        }),
        responses: {
          "201": { description: "Team created" },
          "409": { description: "Team key exists" },
        },
      },
    },
    "/v1/workspaces/{ws}/issues": {
      get: {
        summary:
          "List issues — filters: state, priority, team, assignee, cycle, label, source, search; cursor pagination",
        parameters: [
          wsParam,
          { name: "state", in: "query", schema: { type: "string" } },
          { name: "priority", in: "query", schema: { type: "string" } },
          { name: "team", in: "query", schema: { type: "string" } },
          { name: "assignee", in: "query", schema: { type: "string" } },
          { name: "cycle", in: "query", schema: { type: "string" } },
          { name: "label", in: "query", schema: { type: "string" } },
          { name: "source", in: "query", schema: { type: "string" } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, maximum: 200 },
          },
        ],
        responses: {
          "200": {
            description: "Page of issues with nextCursor",
          },
          "400": { description: "Bad cursor or query" },
        },
      },
      post: {
        summary: "Create issue (mints TEAM-n key; lands in backlog or triage)",
        parameters: [wsParam],
        requestBody: jsonBody({
          type: "object",
          required: ["teamKey", "title"],
          properties: {
            teamKey: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            priority: {
              type: "string",
              enum: ["none", "low", "medium", "high", "urgent"],
            },
            state: { type: "string", enum: ["triage", "backlog"] },
            source: {
              type: "string",
              enum: ["web", "github", "slack", "api", "voice"],
            },
            assigneeType: { type: "string", enum: ["human", "agent"] },
            assigneeId: { type: "string", format: "uuid" },
            cycleId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            parentId: { type: "string", format: "uuid" },
            labelIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
          },
        }),
        responses: { "201": { description: "Issue created" } },
      },
    },
    "/v1/workspaces/{ws}/issues/{key}": {
      get: {
        summary: "Issue detail with children + labels",
        parameters: [wsParam, keyParam],
        responses: {
          "200": { description: "Issue" },
          "404": { description: "Not found" },
        },
      },
      patch: {
        summary:
          "Update issue fields; `state` changes route through the lifecycle state machine (409 on illegal transition)",
        parameters: [wsParam, keyParam],
        requestBody: jsonBody({
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
            state: {
              type: "string",
              enum: [
                "triage",
                "backlog",
                "todo",
                "in_progress",
                "in_review",
                "done",
                "canceled",
                "duplicate",
              ],
            },
            priority: {
              type: "string",
              enum: ["none", "low", "medium", "high", "urgent"],
            },
            estimate: { type: ["integer", "null"] },
            dueDate: { type: ["string", "null"], format: "date-time" },
            assigneeType: { type: ["string", "null"] },
            assigneeId: { type: ["string", "null"], format: "uuid" },
            cycleId: { type: ["string", "null"], format: "uuid" },
            projectId: { type: ["string", "null"], format: "uuid" },
            parentId: { type: ["string", "null"], format: "uuid" },
          },
        }),
        responses: {
          "200": { description: "Updated issue" },
          "409": { description: "Invalid state transition" },
        },
      },
    },
    "/v1/workspaces/{ws}/issues/{key}/comments": {
      get: {
        summary: "List comments on an issue",
        parameters: [wsParam, keyParam],
        responses: { "200": { description: "Comments" } },
      },
      post: {
        summary: "Comment on an issue (writes a `commented` event)",
        parameters: [wsParam, keyParam],
        requestBody: jsonBody({
          type: "object",
          required: ["body"],
          properties: { body: { type: "string" } },
        }),
        responses: { "201": { description: "Comment created" } },
      },
    },
    "/v1/workspaces/{ws}/issues/{key}/events": {
      get: {
        summary: "Activity/audit feed for an issue (append-only)",
        parameters: [wsParam, keyParam],
        responses: { "200": { description: "Events" } },
      },
    },
    "/v1/workspaces/{ws}/labels": {
      get: {
        summary: "List labels",
        parameters: [wsParam],
        responses: { "200": { description: "Labels" } },
      },
      post: {
        summary: "Create label",
        parameters: [wsParam],
        requestBody: jsonBody({
          type: "object",
          required: ["name", "color"],
          properties: {
            name: { type: "string" },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            teamKey: { type: "string" },
          },
        }),
        responses: { "201": { description: "Label created" } },
      },
    },
  },
} as const;
