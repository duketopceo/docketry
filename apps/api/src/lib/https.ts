import type { Context } from "hono";
import { config_ } from "../env.js";

// `Secure` follows the scheme the request actually arrived over —
// plain-http self-host deploys (LAN, tailnet, intranet) must not emit
// Secure cookies or the browser drops them and login silently loops.
// x-forwarded-proto is only honored behind a configured proxy.
export function requestIsHttps(c: Context): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const fwd = c.req.header("x-forwarded-proto");
  if (config_.trustedProxy && fwd) return fwd === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return true;
  }
}
