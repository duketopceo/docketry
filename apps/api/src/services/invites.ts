import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { invites } from "../db/schema.js";
import { mintInviteToken } from "../auth/invite-token.js";
import { clock } from "./clock.js";

// Link invites (R19): opaque bearer token, sha256 at rest, single-use,
// expiring. The plaintext rides the join URL exactly once at mint.
export async function createInvite(opts: {
  workspaceId: string;
  email?: string | null;
  role: "member" | "admin";
  teamId?: string | null;
  createdBy: string;
  expiresAt?: Date;
}) {
  const { token, hash } = mintInviteToken();
  const [row] = await db
    .insert(invites)
    .values({
      workspaceId: opts.workspaceId,
      email: opts.email?.trim().toLowerCase() ?? null,
      tokenHash: hash,
      role: opts.role,
      teamId: opts.teamId ?? null,
      createdBy: opts.createdBy,
      expiresAt: opts.expiresAt ?? new Date(clock.ms() + 7 * 86_400_000),
    })
    .returning();
  return { invite: row!, token };
}

export async function listInvites(workspaceId: string) {
  return db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      teamId: invites.teamId,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .where(eq(invites.workspaceId, workspaceId))
    .orderBy(desc(invites.createdAt));
}

// revoke = delete the live invite (accepted ones are history, not revoked)
export async function revokeInvite(id: string, workspaceId: string) {
  const [row] = await db
    .delete(invites)
    .where(
      and(
        eq(invites.id, id),
        eq(invites.workspaceId, workspaceId),
        isNull(invites.acceptedAt),
      ),
    )
    .returning({ id: invites.id });
  return row ?? null;
}
