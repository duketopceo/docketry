import { proxy } from "@/lib/proxy";

export async function GET(req: Request) {
  return proxy(req, "/labels");
}

export async function POST(req: Request) {
  return proxy(req, "/labels");
}
