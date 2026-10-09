import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { workspaces } from "../db/schema.js";
import { apiError } from "../lib/errors.js";

// Credential introspection — agent keys and PATs are workspace-bound
// server-side, so clients (MCP server, CLI) resolve "who am I" from the
// token alone. Needed for self-assignment (claim) without extra config.
export const whoamiRoutes = new Hono().get("/whoami", async (c) => {
  const agentAuth = c.get("agentAuth");
  if (agentAuth) {
    const [ws] = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, agentAuth.workspaceId));
    return c.json({
      type: "agent" as const,
      id: agentAuth.agentId,
      name: agentAuth.agentName,
      scopes: agentAuth.scopes,
      workspaceId: agentAuth.workspaceId,
      workspaceSlug: ws?.slug ?? null,
    });
  }
  const session = c.get("session");
  if (!session) {
    return apiError(
      c,
      401,
      "UNAUTHENTICATED",
      "sign in or present agent credentials",
    );
  }
  return c.json({
    type: "human" as const,
    id: session.userId,
    name: session.name,
    // cookie sessions carry full user rights; delegated credentials carry
    // their minted scopes, stashed on the context by requireSession
    scopes: c.get("tokenScopes") ?? ["read", "write"],
    workspaceId: session.workspaceId,
    workspaceSlug: session.workspaceSlug || null,
  });
});
