import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { setWorkspaceCookie } from "@/lib/session";
import { cookies } from "next/headers";
import { upstreamFetch } from "@/lib/upstream";

// workspace switch — rebinding dok_ws only happens through this bridge,
// which proves membership via the API's session endpoint first
export async function POST(req: Request) {
  const { workspaceSlug } = (await req.json().catch(() => ({}))) as {
    workspaceSlug?: string;
  };
  if (!workspaceSlug) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "workspaceSlug required" } },
      { status: 400 },
    );
  }
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const upstream = await upstreamFetch(`${API_URL}/v1/auth/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
    },
    body: JSON.stringify({ workspaceSlug }),
  });
  const data = (await upstream.json().catch(() => null)) as unknown;
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }
  await setWorkspaceCookie(workspaceSlug, req);
  return NextResponse.json({ ok: true });
}
