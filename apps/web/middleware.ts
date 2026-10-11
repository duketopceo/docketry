import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildCsp,
  formActionFor,
  HSTS_VALUE,
  isHttpsRequest,
  newNonce,
  STATIC_SECURITY_HEADERS,
} from "@/lib/security-headers";

const PUBLIC_PATHS = ["/", "/login", "/bootstrap", "/join", "/link"];

function withSecurityHeaders(req: NextRequest, res: NextResponse, csp?: string) {
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
  if (csp) res.headers.set("Content-Security-Policy", csp);
  if (isHttpsRequest(req.headers.get("x-forwarded-proto"), req.url, process.env.NODE_ENV)) {
    res.headers.set("Strict-Transport-Security", HSTS_VALUE);
  }
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = newNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    formAction: formActionFor(pathname),
    connectSrc: process.env.NEXT_PUBLIC_API_URL ? [process.env.NEXT_PUBLIC_API_URL] : [],
  });
  // Next.js reads the nonce from the request's CSP header during SSR
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () =>
    withSecurityHeaders(req, NextResponse.next({ request: { headers: requestHeaders } }), csp);

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico"
  ) {
    return pass();
  }
  if (!req.cookies.get("dok_session")) {
    // the MCP consent page round-trips through login (same-origin path only)
    const login = new URL("/login", req.url);
    if (pathname.startsWith("/oauth/")) {
      login.searchParams.set("return_to", `${pathname}${req.nextUrl.search}`);
    }
    return withSecurityHeaders(req, NextResponse.redirect(login));
  }
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
