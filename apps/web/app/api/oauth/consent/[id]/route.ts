import { proxy } from "@/lib/proxy";

// browser -> web -> API bridge for the MCP consent decision. Session cookie
// is attached by proxy(); the CSRF token and request id travel in the body/
// path and are verified by the API.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return proxy(req, `/v1/oauth/consent/${encodeURIComponent(id)}`, {
    workspace: false,
  });
}
