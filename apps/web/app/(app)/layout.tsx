import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
  name: string;
}

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) redirect("/login");
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar workspace={me.data.workspaceSlug} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
