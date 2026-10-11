import { NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { forwardSessionCookies, safeReturnTo } from "@/lib/session";
import { upstreamFetch } from "@/lib/upstream";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
    return_to?: string;
  } | null;
  const upstream = await upstreamFetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body?.email, password: body?.password }),
  });
  const data = (await upstream.json().catch(() => null)) as unknown;

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  await forwardSessionCookies(upstream, req);
  // the join flow round-trips its invite through return_to — only same-
  // origin-relative paths survive
  const destination = safeReturnTo(body?.return_to);
  return NextResponse.json({ ok: true, returnTo: destination });
}
