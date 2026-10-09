import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/session";

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
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const upstream = await fetch(
    `${API_URL}/v1/workspaces/${workspace}/issues?search=${encodeURIComponent(q)}&limit=10`,
    { headers: { cookie: `${SESSION_COOKIE}=${session}` } },
  );
  const data = (await upstream.json().catch(() => null)) as unknown;
  return NextResponse.json(data, { status: upstream.status });
}
