import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/session";
import { upstreamFetch } from "@/lib/upstream";

// shared upstream forwarder for the settings bridges — session + tly_ws
// from the web jar; path is built by the caller, never the client
export async function proxy(
  req: Request,
  upstreamPath: string,
  init?: { method?: string; workspace?: boolean },
): Promise<NextResponse> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "no session" } },
      { status: 401 },
    );
  }
  let path = upstreamPath;
  if (init?.workspace !== false) {
    const ws = jar.get(WORKSPACE_COOKIE)?.value;
    if (!ws) {
      return NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "no active workspace" } },
        { status: 400 },
      );
    }
    path = `/v1/workspaces/${ws}${upstreamPath}`;
  }
  const method = init?.method ?? req.method;
  const body = ["GET", "HEAD", "DELETE"].includes(method)
    ? undefined
    : await req.text();
  const upstream = await upstreamFetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${session}`,
    },
    ...(body !== undefined ? { body } : {}),
  });
  const data = (await upstream.json().catch(() => null)) as unknown;
  return NextResponse.json(data, { status: upstream.status });
}
