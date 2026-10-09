import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const data = (await upstream.json().catch(() => null)) as unknown;

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const setCookie = upstream.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/dok_session=([^;]+)/);
  if (match) {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, match[1]!, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return NextResponse.json({ ok: true });
}
