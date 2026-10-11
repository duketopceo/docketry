import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CommandPalette } from "@/components/command-palette";
import { GlobalNav } from "@/components/global-nav";
import { KeymapOverlay } from "@/components/keymap-overlay";
import { QuickCreate } from "@/components/quick-create";
import { Sidebar } from "@/components/sidebar";
import { AccountGate } from "@/components/account/account-gate";
import { api, type Me } from "@/lib/api";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) redirect("/login");
  // removed-member bounce (R15): zero memberships → out; the session's
  // active workspace gone but others remain → through the chooser
  const memberships = me.data.memberships ?? [];
  if (memberships.length === 0) redirect("/login?error=no_workspace");
  if (!memberships.some((m) => m.workspaceSlug === me.data!.workspaceSlug)) {
    redirect("/workspaces");
  }
  const active = memberships.find((m) => m.workspaceSlug === me.data!.workspaceSlug);
  const pendingDeletion =
    active?.deletedAt && active.purgeAfter
      ? { name: active.workspaceName ?? active.workspaceSlug, purgeAfter: active.purgeAfter }
      : null;
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspace={me.data.workspaceSlug}
        role={
          me.data.memberships.find(
            (m) => m.workspaceSlug === me.data!.workspaceSlug,
          )?.role
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AccountGate emailVerified={me.data.emailVerified !== false} pendingDeletion={pendingDeletion}>
          {children}
        </AccountGate>
      </div>
      <QuickCreate />
      <CommandPalette workspace={me.data.workspaceSlug} />
      <GlobalNav />
      <KeymapOverlay />
    </div>
  );
}
