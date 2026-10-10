import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";

// pending-link completion — password auth or live-session proof, forwarded
// verbatim to the API (the API decides which challenge applies to the
// matched account's credential state)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    code?: string;
    password?: string;
  } | null;
  if (!body?.code) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "code required" } },
      { status: 400 },
    );
  }
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${API_URL}/v1/auth/oauth/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
    },
    body: JSON.stringify({ code: body.code, password: body.password }),
  });
  const data = (await upstream.json().catch(() => null)) as unknown;
  return NextResponse.json(data, { status: upstream.status });
}
