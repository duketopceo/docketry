import type { Context } from "hono";
import type { ActorType } from "@docketry/types";
import type { Actor } from "../services/issues.js";

const ACTOR_TYPES = new Set(["human", "agent", "system"]);

// Pre-auth placeholder: identity arrives as headers until the auth slice
// lands (#5 bootstrap, #12 scoped tokens). Then this becomes a middleware.
export function actorFromHeaders(c: Context): Actor {
  const raw = c.req.header("x-actor-type") ?? "human";
  const type = (ACTOR_TYPES.has(raw) ? raw : "human") as ActorType;
  return { type, id: c.req.header("x-actor-id") ?? null };
}
