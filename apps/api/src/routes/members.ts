import { zValidator } from "@hono/zod-validator";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { events, users, workspaceMembers } from "../db/schema.js";
import { apiError } from "../lib/errors.js";
import { requireRole, type MemberRole } from "../services/members.js";
import { isCookieSession } from "./auth.js";
import { requireWorkspace } from "./workspaces.js";

const roleSchema = z.object({ role: z.enum(["member", "admin", "owner"]) });

function memberEvent(wsId: string, actorId: string | null, action: string, entityId: string, after?: unknown) {
  return db.insert(events).values({
    workspaceId: wsId, actorType: "human", actorId,
    action, entityType: "member", entityId,
    after: after === undefined ? undefined : (after as object),
  });
}

// every :id lookup is ws-filtered — a row from another workspace is a 404,
// never a cross-workspace mutation (slug-oracle decision, U5.1)
export const memberRoutes = new Hono()
  // roster: any member reads it — assignee resolution needs it (R19).
  // agent keys + PATs reach here through requireWorkspace like anywhere.
  .get("/workspaces/:ws/members", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select({
        id: workspaceMembers.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ws.id));
    return c.json({ members: rows });
  })
  .patch(
    "/workspaces/:ws/members/:id",
    zValidator("json", roleSchema),
    async (c) => {
      // role transitions per R18 matrix: touching an owner row or granting
      // owner requires caller-is-owner; admins manage member|admin only
      if (!isCookieSession(c)) {
        return apiError(c, 403, "FORBIDDEN", "role changes require a human session");
      }
      const ws = await requireWorkspace(c);
      requireRole(c, "admin");
      const callerRole = c.get("memberRole")!;
      const [target] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.id, c.req.param("id")),
            eq(workspaceMembers.workspaceId, ws.id),
          ),
        );
      if (!target) return apiError(c, 404, "NOT_FOUND", "member not found");
      const newRole = c.req.valid("json").role as MemberRole;
      if ((newRole === "owner" || target.role === "owner") && callerRole !== "owner") {
        return apiError(c, 403, "FORBIDDEN_ROLE", "only an owner can touch owner roles");
      }
      if (target.role === "owner" && newRole !== "owner") {
        const [other] = await db
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ws.id),
              eq(workspaceMembers.role, "owner"),
              ne(workspaceMembers.id, target.id),
            ),
          )
          .limit(1);
        if (!other) {
          return apiError(c, 409, "LAST_OWNER", "cannot demote the last owner");
        }
      }
      const session = c.get("session")!;
      const [updated] = await db
        .update(workspaceMembers)
        .set({ role: newRole })
        .where(eq(workspaceMembers.id, target.id))
        .returning();
      await memberEvent(ws.id, session.userId, "member_role_changed", updated!.userId, { role: newRole });
      return c.json(updated);
    },
  )
  .delete("/workspaces/:ws/members/:id", async (c) => {
    if (!isCookieSession(c)) {
      return apiError(c, 403, "FORBIDDEN", "member removal requires a human session");
    }
    const ws = await requireWorkspace(c);
    requireRole(c, "admin");
    const callerRole = c.get("memberRole")!;
    const [target] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, c.req.param("id")),
          eq(workspaceMembers.workspaceId, ws.id),
        ),
      );
    if (!target) return apiError(c, 404, "NOT_FOUND", "member not found");
    if (target.role === "owner") {
      if (callerRole !== "owner") {
        return apiError(c, 403, "FORBIDDEN_ROLE", "only an owner can remove an owner");
      }
      const [other] = await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ws.id),
            eq(workspaceMembers.role, "owner"),
            ne(workspaceMembers.id, target.id),
          ),
        )
        .limit(1);
      if (!other) {
        return apiError(c, 409, "LAST_OWNER", "cannot remove the last owner");
      }
    }
    await db.delete(workspaceMembers).where(eq(workspaceMembers.id, target.id));
    const session = c.get("session")!;
    await memberEvent(ws.id, session.userId, "member_left", target.userId);
    return c.json({ ok: true });
  });
