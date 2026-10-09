import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE } from "@/lib/api";

export const WORKSPACE_COOKIE = "dok_ws";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export async function forwardSessionCookies(
  upstream: Response,
  workspaceSlug?: string,
): Promise<void> {
  const setCookie = upstream.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/dok_session=([^;]+)/);
  const jar = await cookies();
  if (match) {
    jar.set(SESSION_COOKIE, match[1]!, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  let slug = workspaceSlug;
  if (!slug && match) {
    const me = await fetch(`${API_URL}/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${match[1]}` },
    });
    if (me.ok) {
      slug = ((await me.json()) as { workspaceSlug: string }).workspaceSlug;
    }
  }
  if (slug) {
    jar.set(WORKSPACE_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
}
