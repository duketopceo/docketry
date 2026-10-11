import { createHmac, timingSafeEqual } from "node:crypto";
import { config_ } from "../env.js";
import { clock } from "./clock.js";

// Signed, short-lived `state` for the GitHub App manifest flow. It rides in
// the redirect_url PATH (GitHub appends ?code=), proves an admin started the
// flow for this workspace, and needs no cookie on the API host.

const TTL_MS = 10 * 60_000;

const mac = (payload: string) =>
  createHmac("sha256", `gh-manifest:${config_.jwtSecret}`)
    .update(payload)
    .digest("base64url");

export function signManifestState(workspaceId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ w: workspaceId, e: clock.ms() + TTL_MS }),
  ).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function verifyManifestState(
  state: string,
): { workspaceId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = mac(payload);
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const { w, e } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { w?: string; e?: number };
    if (typeof w !== "string" || typeof e !== "number" || e < clock.ms()) {
      return null;
    }
    return { workspaceId: w };
  } catch {
    return null;
  }
}
