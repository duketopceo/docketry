import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { invites } from "../db/schema.js";
import { clock } from "../services/clock.js";

// Invite tokens are bearer credentials — only the sha256 is stored (R19).
// Shared by the U4 JIT rung and U5's mint/revoke/accept routes.

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintInviteToken(): { token: string; hash: string } {
  const token = `tly_inv_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashInviteToken(token) };
}

export async function inviteFromHash(hash: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hash),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, clock.now()),
      ),
    );
  return row ?? null;
}

export async function inviteFromToken(token: string) {
  return inviteFromHash(hashInviteToken(token));
}
