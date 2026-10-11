import type { Context } from "hono";
import type { ActorType } from "@tallyline/types";
import type { Actor } from "../services/issues.js";
import { HttpError } from "./errors.js";

// Terminal provenance rule (U2.8): the actor id is always derived from the
// authenticated credential — x-actor-id is never honored from any caller.
// x-actor-type may only select a type the credential class permits:
// "human" for cookie/PAT sessions (or omit), "agent" for agent keys.
// "system" is rejected for all callers in v1 — no internal emitter exists.
export function actorFromHeaders(c: Context): Actor {
  const raw = c.req.header("x-actor-type");
  const agentAuth = c.get("agentAuth");
  if (agentAuth) {
    if (raw && raw !== "agent") {
      throw new HttpError(
        403,
        "FORBIDDEN_ACTOR",
        "agent credentials may only assert x-actor-type: agent",
      );
    }
    return { type: "agent", id: agentAuth.agentId };
  }
  const type = (raw ?? "human") as ActorType;
  if (type !== "human") {
    throw new HttpError(
      403,
      "FORBIDDEN_ACTOR",
      "user credentials may only assert x-actor-type: human",
    );
  }
  const session = c.get("session");
  return { type: "human", id: session?.userId ?? null };
}
