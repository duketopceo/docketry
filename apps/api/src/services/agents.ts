import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentKeys, agents } from "../db/schema.js";

export interface AgentAuth {
  agentId: string;
  agentName: string;
  workspaceId: string;
  keyId: string;
  scopes: string[];
}

export async function createAgentKey(
  agentId: string,
  workspaceId: string,
  name: string,
  scopes: string[],
  expiresAt?: Date,
): Promise<{ key: string; id: string }> {
  const key = `dok_agt_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(agentKeys)
    .values({
      agentId,
      workspaceId,
      name,
      tokenHash: hashKey(key),
      scopes,
      ...(expiresAt ? { expiresAt } : {}),
    })
    .returning();
  return { key, id: row!.id };
}

export async function agentFromKey(
  key: string,
): Promise<AgentAuth | null> {
  const [row] = await db
    .select({
      keyId: agentKeys.id,
      agentId: agentKeys.agentId,
      workspaceId: agentKeys.workspaceId,
      scopes: agentKeys.scopes,
      agentName: agents.name,
    })
    .from(agentKeys)
    .innerJoin(agents, eq(agents.id, agentKeys.agentId))
    .where(
      and(
        eq(agentKeys.tokenHash, hashKey(key)),
        or(
          isNull(agentKeys.expiresAt),
          gt(agentKeys.expiresAt, new Date()),
        ),
      ),
    );
  if (!row) return null;
  // fire-and-forget usage stamp
  void db
    .update(agentKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentKeys.id, row.keyId))
    .catch(() => undefined);
  return row;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
