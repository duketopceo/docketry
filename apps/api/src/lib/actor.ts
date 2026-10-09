import type { Context } from "hono";
import type { ActorType } from "@docketry/types";
import type { Actor } from "../services/issues.js";

const ACTOR_TYPES = new Set(["human", "agent", "system"]);

// Session-authenticated humans get their userId as the actor. Agent/system
// callers carry x-actor-* headers (credential scoping lands with #12).
export function actorFromHeaders(c: Context): Actor {
  const raw = c.req.header("x-actor-type") ?? "human";
  const type = (ACTOR_TYPES.has(raw) ? raw : "human") as ActorType;
  if (type !== "human") {
    return { type, id: c.req.header("x-actor-id") ?? null };
  }
  const session = c.get("session");
  return { type: "human", id: session?.userId ?? null };
}
