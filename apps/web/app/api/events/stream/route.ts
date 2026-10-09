import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

// SSE proxy — forwards the session cookie and Last-Event-ID resume token,
// then pipes the upstream event stream straight through to the browser.
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const workspace = jar.get(WORKSPACE_COOKIE)?.value;
  if (!session || !workspace) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "no session" } },
      { status: 401 },
    );
  }

  const url = new URL(
    `${API_URL}/v1/workspaces/${workspace}/events/stream`,
  );
  const after = req.nextUrl.searchParams.get("after");
  if (after) url.searchParams.set("after", after);

  const headers: Record<string, string> = {
    accept: "text/event-stream",
    cookie: `${SESSION_COOKIE}=${session}`,
  };
  const lastEventId = req.headers.get("last-event-id");
  if (lastEventId) headers["last-event-id"] = lastEventId;

  const upstream = await fetch(url, {
    headers,
    cache: "no-store",
    signal: req.signal, // client disconnect aborts the upstream poll loop
  });

  if (!upstream.ok || !upstream.body) {
    const data = (await upstream.json().catch(() => null)) as unknown;
    return NextResponse.json(data, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}
