import { headers } from "next/headers";

// The web tier proxies browser requests to the API from its own network
// address, so without help the API's rate limiter would see every user as the
// web container. Forward the real client address (Cloudflare's
// CF-Connecting-IP, else the proxy's X-Forwarded-For) on every upstream call;
// the API only honors these when TRUSTED_PROXY=1 (see apps/api lib/rate-limit).
const FORWARDED = ["cf-connecting-ip", "x-forwarded-for"] as const;

export async function clientIpHeaders(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const out: Record<string, string> = {};
    for (const name of FORWARDED) {
      const v = h.get(name);
      if (v) out[name] = v;
    }
    return out;
  } catch {
    return {}; // outside a request scope (build, tests)
  }
}

export async function upstreamFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const merged = new Headers(await clientIpHeaders());
  new Headers(init.headers).forEach((v, k) => merged.set(k, v));
  return fetch(input, { ...init, headers: merged });
}
