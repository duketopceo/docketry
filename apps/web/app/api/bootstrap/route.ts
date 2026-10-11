import { NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/session";
import { upstreamFetch } from "@/lib/upstream";

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await upstreamFetch(`${API_URL}/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const data = (await upstream.json().catch(() => null)) as unknown;

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const slug =
    data && typeof data === "object" && "workspace" in data
      ? (data as { workspace?: { slug?: string } }).workspace?.slug
      : undefined;
  await forwardSessionCookies(upstream, req, slug);
  return NextResponse.json({ ok: true });
}
