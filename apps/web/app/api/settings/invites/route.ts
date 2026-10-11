import { proxy } from "@/lib/proxy";

export function GET(req: Request) {
  return proxy(req, "/invites");
}
export function POST(req: Request) {
  return proxy(req, "/invites");
}
