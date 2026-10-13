import { proxy } from "@/lib/proxy";

export async function POST(req: Request) {
  return proxy(req, "/notifications/read-all", { method: "POST" });
}
