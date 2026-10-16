import { cache } from "react";
import { api } from "@/lib/api";

// Actor directory — one members+agents read per request, shared across
// server components via React cache(). assigneeId is a users.id for humans
// and an agents.id for agents (the API's validateAssignee contract).
export type ActorKind = "human" | "agent";

export interface ActorRef {
  id: string;
  name: string;
  kind: ActorKind;
  initials: string;
}

export type ActorDirectory = Record<string, ActorRef>;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1
    ? `${parts[0]![0]}${parts.at(-1)![0]}`
    : name.slice(0, 2)
  ).toUpperCase();
}

export const getActorDirectory = cache(
  async (slug: string): Promise<ActorDirectory> => {
    const [membersRes, agentsRes] = await Promise.all([
      api<{ members?: { userId: string; name: string | null; email: string }[] }>(
        `/v1/workspaces/${slug}/members`,
      ),
      api<{ agents?: { id: string; name: string }[] }>(
        `/v1/workspaces/${slug}/agents`,
      ),
    ]);
    const dir: ActorDirectory = {};
    for (const m of membersRes.data?.members ?? []) {
      const name = m.name ?? m.email.split("@")[0]!;
      dir[m.userId] = { id: m.userId, name, kind: "human", initials: initials(name) };
    }
    for (const a of agentsRes.data?.agents ?? []) {
      dir[a.id] = { id: a.id, name: a.name, kind: "agent", initials: initials(a.name) };
    }
    return dir;
  },
);
