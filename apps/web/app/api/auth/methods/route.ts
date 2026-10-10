import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, PUBLIC_API_URL } from "@/lib/api";

export const LOGIN_NONCE_COOKIE = "dok_login_nonce";

interface Methods {
  password: boolean;
  providers: { key: string; type: string; label: string }[];
}

// Login-page discovery bridge — the route handler owns the HttpOnly
// dok_login_nonce (client JS cannot set it), and builds each provider's
// startUrl on the browser-reachable public origin (NEXT_PUBLIC_API_URL —
// API_INTERNAL_URL is a docker hostname browsers cannot reach).
export async function GET() {
  const jar = await cookies();
  // issued once, not rotated per fetch — the value is embedded in provider
  // start links and must survive repeated methods polls
  let nonce = jar.get(LOGIN_NONCE_COOKIE)?.value;
  if (!nonce) {
    nonce = randomBytes(24).toString("base64url");
    jar.set(LOGIN_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
  }
  const upstream = await fetch(`${API_URL}/v1/auth/methods`, {
    cache: "no-store",
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: { code: "METHODS_UNAVAILABLE", message: "auth methods unavailable" } },
      { status: upstream.status },
    );
  }
  const methods = (await upstream.json()) as Methods;
  return NextResponse.json({
    password: methods.password,
    loginNonce: nonce,
    providers: methods.providers.map((p) => ({
      ...p,
      startUrl: `${PUBLIC_API_URL}/v1/auth/oauth/${p.key}/start?login_nonce=${nonce}`,
    })),
  });
}
