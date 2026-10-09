import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  agents,
  comments,
  dispatches,
  events,
  issues,
} from "../db/schema.js";
import { queueDeliveries } from "./outbound.js";

// ── Adapter contract ─────────────────────────────────────────────
// Third-party harnesses implement this shape and register by harness
// name. launch() must return promptly; long-running work happens in
// the harness itself, which reports back over the REST API.
// See docs/adapters.md.

export interface DispatchContext {
  dispatchId: string;
  workspaceId: string;
  issue: { id: string; key: string; title: string; description: string | null };
  agent: {
    id: string;
    name: string;
    harness: string;
    endpointUrl: string | null;
  };
  trigger: "assign" | "mention";
  commentBody?: string | undefined;
}

export interface DispatchResult {
  sessionId?: string | undefined;
}

export interface DispatchAdapter {
  name: string;
  launch(ctx: DispatchContext): Promise<DispatchResult>;
}

const localAdapter: DispatchAdapter = {
  name: "local",
  // claimed immediately — a human runs `docketry claim` / MCP on this box
  async launch() {
    return {};
  },
};

const webhookAdapter: DispatchAdapter = {
  name: "webhook",
  async launch(ctx) {
    if (!ctx.agent.endpointUrl) {
      throw new Error(`agent '${ctx.agent.name}' has no endpointUrl configured`);
    }
    const res = await fetch(ctx.agent.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dispatchId: ctx.dispatchId,
        issue: ctx.issue,
        agent: { id: ctx.agent.id, name: ctx.agent.name },
        trigger: ctx.trigger,
        comment: ctx.commentBody,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`endpoint returned ${res.status}`);
    }
    return {};
  },
};

// harness name → adapter. 'claude-code'/'codex'/'opencode' are local
// harnesses: claiming happens in-repo via CLI/MCP, not over HTTP.
const ADAPTERS: Record<string, DispatchAdapter> = {
  local: localAdapter,
  "claude-code": localAdapter,
  codex: localAdapter,
  opencode: localAdapter,
  webhook: webhookAdapter,
};

async function systemComment(
  workspaceId: string,
  issueId: string,
  body: string,
) {
  await db.insert(comments).values({
    workspaceId,
    issueId,
    actorType: "system",
    actorId: null,
    body,
  });
}

async function fail(
  dispatch: { id: string; workspaceId: string; issueId: string },
  reason: string,
) {
  await db
    .update(dispatches)
    .set({ status: "dispatch_failed", reason, updatedAt: new Date() })
    .where(eq(dispatches.id, dispatch.id));
  await db.insert(events).values({
    workspaceId: dispatch.workspaceId,
    entityType: "issue",
    entityId: dispatch.issueId,
    action: "dispatch_failed",
    actorType: "system",
    actorId: null,
    after: { dispatchId: dispatch.id, reason },
  });
  await queueDeliveries({
    workspaceId: dispatch.workspaceId,
    entityType: "issue",
    entityId: dispatch.issueId,
    action: "dispatch_failed",
    actorType: "system",
    actorId: null,
    after: { dispatchId: dispatch.id, reason },
  });
  await systemComment(
    dispatch.workspaceId,
    dispatch.issueId,
    `dispatch_failed: ${reason}`,
  );
}

async function processDispatch(dispatchId: string): Promise<void> {
  const [dispatch] = await db
    .select()
    .from(dispatches)
    .where(eq(dispatches.id, dispatchId))
    .limit(1);
  if (!dispatch || dispatch.status !== "queued") return;

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, dispatch.agentId))
    .limit(1);
  const [issue] = await db
    .select()
    .from(issues)
    .where(eq(issues.id, dispatch.issueId))
    .limit(1);
  if (!agent || !issue) {
    await fail(dispatch, "agent or issue no longer exists");
    return;
  }

  const adapter = ADAPTERS[agent.harness];
  if (!adapter) {
    await db
      .update(dispatches)
      .set({ adapter: agent.harness, updatedAt: new Date() })
      .where(eq(dispatches.id, dispatch.id));
    await fail(dispatch, `no adapter registered for harness '${agent.harness}'`);
    return;
  }

  try {
    await adapter.launch({
      dispatchId: dispatch.id,
      workspaceId: dispatch.workspaceId,
      issue: {
        id: issue.id,
        key: issue.key,
        title: issue.title,
        description: issue.description,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        harness: agent.harness,
        endpointUrl: agent.endpointUrl,
      },
      trigger: dispatch.trigger,
      commentBody: dispatch.commentBody ?? undefined,
    });
    await db
      .update(dispatches)
      .set({ status: "claimed", adapter: adapter.name, updatedAt: new Date() })
      .where(eq(dispatches.id, dispatch.id));
    await systemComment(
      dispatch.workspaceId,
      dispatch.issueId,
      `@${agent.name} picked up via ${adapter.name} adapter`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(dispatches)
      .set({ adapter: adapter.name, updatedAt: new Date() })
      .where(eq(dispatches.id, dispatch.id));
    await fail(dispatch, reason);
  }
}

export async function createDispatch(input: {
  workspaceId: string;
  issueId: string;
  agentId: string;
  trigger: "assign" | "mention";
  commentBody?: string;
}) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return null;

  const [dispatch] = await db
    .insert(dispatches)
    .values({
      workspaceId: input.workspaceId,
      issueId: input.issueId,
      agentId: input.agentId,
      trigger: input.trigger,
      commentBody: input.commentBody ?? null,
    })
    .returning();

  await db.insert(events).values({
    workspaceId: input.workspaceId,
    entityType: "issue",
    entityId: input.issueId,
    action: "dispatched",
    actorType: "system",
    actorId: null,
    after: {
      dispatchId: dispatch!.id,
      agent: agent.name,
      trigger: input.trigger,
    },
  });
  await queueDeliveries({
    workspaceId: input.workspaceId,
    entityType: "issue",
    entityId: input.issueId,
    action: "dispatched",
    actorType: "system",
    actorId: null,
    after: {
      dispatchId: dispatch!.id,
      agent: agent.name,
      trigger: input.trigger,
    },
  });
  await systemComment(
    input.workspaceId,
    input.issueId,
    `dispatching to @${agent.name} (${input.trigger})…`,
  );

  await processDispatch(dispatch!.id);
  return dispatch!;
}
