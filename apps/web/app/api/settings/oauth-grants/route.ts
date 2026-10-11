import { proxy } from "@/lib/proxy";

export function GET(req: Request) {
  return proxy(req, "/oauth/grants");
}
