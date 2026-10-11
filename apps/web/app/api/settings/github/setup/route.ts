import { NextResponse } from "next/server";
import { proxy } from "@/lib/proxy";

// Binds a GitHub installation (state-changing). CSRF: JSON body only, plus the
// request must originate from this site (Origin/Sec-Fetch-Site) — a cross-site
// page can neither send application/json without a preflight nor forge Origin.
// Session cookies are SameSite=Lax as a further layer.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && !!host && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  const json = (req.headers.get("content-type") ?? "").startsWith("application/json");
  if (!sameOrigin || !json || req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: { code: "CSRF", message: "cross-site request refused" } },
      { status: 403 },
    );
  }
  return proxy(req, "/github/setup");
}
