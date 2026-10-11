import { proxy } from "@/lib/proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxy(req, `/v1/auth/providers/${id}/test`, { workspace: false });
}
