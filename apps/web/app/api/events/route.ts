import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/session";

// Workspace event list — used by the activity feed's polling fallback when
// the SSE stream is unavailable.
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
  const qs = new URLSearchParams();
  for (const k of ["cursor", "limit"] as const) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const upstream = await fetch(
    `${API_URL}/v1/workspaces/${workspace}/events?${qs}`,
    {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
    },
  );
  const data = (await upstream.json().catch(() => null)) as unknown;
  return NextResponse.json(data, { status: upstream.status });
}
