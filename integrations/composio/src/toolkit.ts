/**
 * docketry Composio toolkit — DOCKETRY_* tools over the public REST API.
 *
 * Built on Composio's custom-tool surface (`experimental_createTool` /
 * `experimental_createToolkit`): every tool's execute fn delegates to the
 * thin {@link DocketryClient}, so auth, scopes, and the state machine stay
 * server-side. Self-hosters pass their own baseUrl + workspace + key; no
 * Composio-managed auth is required.
 */
import { experimental_createTool, experimental_createToolkit } from "@composio/core";
import { z } from "zod";
import { DocketryClient, type DocketryClientConfig } from "./client.js";

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

const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

const keyParam = z
  .string()
  .min(1)
  .describe("Issue key, e.g. SL-12");

export function createDocketryToolkit(config: DocketryClientConfig) {
  const client = new DocketryClient(config);
  const data = (v: unknown) => v as Record<string, unknown>;

  const tools = [
    experimental_createTool("DOCKETRY_WHOAMI", {
      name: "docketry Whoami",
      description:
        "Resolve the identity behind the configured API key — agent/human, scopes, workspace. Call first to confirm connectivity.",
      inputParams: z.object({}),
      execute: async () => data(await client.whoami()),
    }),

    experimental_createTool("DOCKETRY_LIST_ISSUES", {
      name: "docketry List Issues",
      description:
        "List/search workspace issues. Filter by state, priority, team, assignee, cycle, project, label, source, or free-text search.",
      inputParams: z.object({
        state: z.enum(ISSUE_STATES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        team: z.string().optional().describe("Team key, e.g. SL"),
        assignee: z.string().optional(),
        cycle: z.string().optional(),
        project: z.string().optional(),
        label: z.string().optional(),
        source: z
          .enum(["web", "api", "github", "slack", "voice", "import"])
          .optional(),
        search: z.string().optional().describe("Full-text search"),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      execute: async (input) =>
        data(await client.apiGet("/issues", { ...input })),
    }),

    experimental_createTool("DOCKETRY_GET_ISSUE", {
      name: "docketry Get Issue",
      description:
        "Fetch one issue by key with children and labels attached.",
      inputParams: z.object({ key: keyParam }),
      execute: async ({ key }) =>
        data(await client.apiGet(`/issues/${encodeURIComponent(key)}`)),
    }),

    experimental_createTool("DOCKETRY_CREATE_ISSUE", {
      name: "docketry Create Issue",
      description:
        "Create an issue in a team. State defaults to backlog; the API enforces the state machine on any supplied state.",
      inputParams: z.object({
        teamKey: z.string().min(1).describe("Team key, e.g. SL"),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        state: z.enum(ISSUE_STATES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        estimate: z.number().int().optional(),
        projectId: z.string().uuid().optional(),
        cycleId: z.string().uuid().optional(),
        parentId: z.string().uuid().optional().describe("Parent issue id for sub-issues"),
        labelIds: z.array(z.string().uuid()).optional(),
      }),
      execute: async (input) => data(await client.apiPost("/issues", input)),
    }),

    experimental_createTool("DOCKETRY_UPDATE_ISSUE", {
      name: "docketry Update Issue",
      description:
        "Patch an issue — title, description, priority, estimate, assignee, cycle/project/parent links. State changes must go through the state machine (use DOCKETRY_TRIAGE_ISSUE for triage, or PATCH state for legal transitions).",
      inputParams: z.object({
        key: keyParam,
        title: z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
        state: z.enum(ISSUE_STATES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        estimate: z.number().int().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        assigneeType: z.enum(["human", "agent"]).nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        cycleId: z.string().uuid().nullable().optional(),
        projectId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      }),
      execute: async ({ key, ...body }) =>
        data(await client.apiPatch(`/issues/${encodeURIComponent(key)}`, body)),
    }),

    experimental_createTool("DOCKETRY_TRIAGE_ISSUE", {
      name: "docketry Triage Issue",
      description:
        "Accept or dismiss an issue currently in triage — the dedicated triage transition with an optional comment.",
      inputParams: z.object({
        key: keyParam,
        action: z.enum(["accept", "dismiss"]),
        comment: z.string().optional(),
      }),
      execute: async ({ key, ...body }) =>
        data(
          await client.apiPost(
            `/issues/${encodeURIComponent(key)}/triage`,
            body,
          ),
        ),
    }),

    experimental_createTool("DOCKETRY_COMMENT", {
      name: "docketry Comment",
      description: "Add a comment to an issue thread.",
      inputParams: z.object({
        key: keyParam,
        body: z.string().min(1),
      }),
      execute: async ({ key, body }) =>
        data(
          await client.apiPost(`/issues/${encodeURIComponent(key)}/comments`, {
            body,
          }),
        ),
    }),

    experimental_createTool("DOCKETRY_LIST_EVENTS", {
      name: "docketry List Events",
      description:
        "Read the workspace activity feed — append-only issue/dispatch/project events.",
      inputParams: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        entity: z.string().optional(),
        action: z.string().optional(),
      }),
      execute: async (input) =>
        data(await client.apiGet("/events", { ...input })),
    }),

    experimental_createTool("DOCKETRY_LIST_TEAMS", {
      name: "docketry List Teams",
      description: "List workspace teams (keys needed to create issues).",
      inputParams: z.object({}),
      execute: async () => data(await client.apiGet("/teams")),
    }),

    experimental_createTool("DOCKETRY_LIST_AGENTS", {
      name: "docketry List Agents",
      description: "List registered workspace agents for assignment/dispatch.",
      inputParams: z.object({}),
      execute: async () => data(await client.apiGet("/agents")),
    }),

    experimental_createTool("DOCKETRY_LIST_LABELS", {
      name: "docketry List Labels",
      description: "List workspace labels with ids for issue tagging.",
      inputParams: z.object({}),
      execute: async () => data(await client.apiGet("/labels")),
    }),

    experimental_createTool("DOCKETRY_LIST_PROJECTS", {
      name: "docketry List Projects",
      description: "List workspace projects (roadmap containers).",
      inputParams: z.object({}),
      execute: async () => data(await client.apiGet("/projects")),
    }),

    experimental_createTool("DOCKETRY_LIST_CYCLES", {
      name: "docketry List Cycles",
      description: "List team cycles, including the active one per team.",
      inputParams: z.object({}),
      execute: async () => data(await client.apiGet("/cycles")),
    }),
  ];

  return experimental_createToolkit("DOCKETRY", {
    name: "docketry",
    description:
      "Self-hosted agent-native issue tracker — create, triage, update, and comment on issues; list teams, labels, projects, cycles, agents, and the activity feed.",
    tools,
  });
}
