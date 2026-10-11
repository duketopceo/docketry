import type { Context, Next } from "hono";
import { requestIsHttps } from "./https.js";

// The API serves JSON only: nothing here should ever be framed, sniffed or
// treated as a document, so the CSP is the most restrictive possible.
// HSTS is sent only when the request really arrived over HTTPS (directly in
// production, or via x-forwarded-proto when TRUSTED_PROXY=1) so plain-http
// self-host/LAN installs are never pinned to https.
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  c.header("Cross-Origin-Resource-Policy", "same-site");
  if (requestIsHttps(c)) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  await next();
}
