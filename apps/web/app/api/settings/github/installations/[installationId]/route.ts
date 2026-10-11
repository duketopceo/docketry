import { proxy } from "@/lib/proxy";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ installationId: string }> },
) {
  const { installationId } = await params;
  return proxy(req, `/github/installations/${encodeURIComponent(installationId)}`);
}
