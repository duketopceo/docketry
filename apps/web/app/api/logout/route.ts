import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request) {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    }).catch(() => undefined);
    jar.delete(SESSION_COOKIE);
  }
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
