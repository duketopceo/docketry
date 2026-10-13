import { proxy } from "@/lib/proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxy(req, `/notifications/${id}/read`, { method: "POST" });
}
