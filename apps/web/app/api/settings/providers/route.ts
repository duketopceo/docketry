import { proxy } from "@/lib/proxy";

// providers are instance scope — /v1/auth/providers, no workspace prefix
export function GET(req: Request) {
  return proxy(req, "/v1/auth/providers", { workspace: false });
}

export function POST(req: Request) {
  return proxy(req, "/v1/auth/providers", { workspace: false });
}
