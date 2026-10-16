import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE } from "@/lib/api";
import { redirectTo } from "@/lib/redirect";
import { upstreamFetch } from "@/lib/upstream";

export async function POST() {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session) {
    await upstreamFetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    }).catch(() => undefined);
    jar.delete(SESSION_COOKIE);
  }
  return redirectTo("/login", 303);
}
