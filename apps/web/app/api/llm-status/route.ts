import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/session";

export async function GET() {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const workspace = jar.get(WORKSPACE_COOKIE)?.value;
  if (!session || !workspace) {
    return NextResponse.json({ enabled: false, model: null });
  }
  const upstream = await fetch(
    `${API_URL}/v1/workspaces/${workspace}/llm/status`,
    {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
    },
  );
  const data = (await upstream.json().catch(() => null)) as unknown;
  return NextResponse.json(data, { status: upstream.status });
}
