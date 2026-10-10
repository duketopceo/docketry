import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/session";

// invite claim/accept bridge — forwards the session cookie so the API can
// resolve the caller server-side; replays the minted session on claim
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    name?: string;
    password?: string;
  } | null;
  if (!body?.token) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "invite token required" } },
      { status: 400 },
    );
  }
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${API_URL}/v1/auth/accept-invite`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
    },
    body: JSON.stringify({
      token: body.token,
      ...(body.name ? { name: body.name } : {}),
      ...(body.password ? { password: body.password } : {}),
    }),
  });
  const data = (await upstream.json().catch(() => null)) as unknown;
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }
  // a successful claim mints a fresh session (new account path)
  await forwardSessionCookies(upstream);
  return NextResponse.json(data, { status: upstream.status });
}
