import { proxy } from "@/lib/proxy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return proxy(req, `/notifications${url.search}`);
}
