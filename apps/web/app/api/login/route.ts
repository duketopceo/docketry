import { NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/session";

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

  await forwardSessionCookies(upstream);
  return NextResponse.json({ ok: true });
}
