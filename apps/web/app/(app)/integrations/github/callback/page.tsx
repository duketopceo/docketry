import { redirect } from "next/navigation";
import { api, type Me } from "@/lib/api";
import { GithubLinkConfirm } from "@/components/settings/github-link-confirm";
import { PageHeader } from "@/components/settings/ui";

// GitHub's Setup URL for the App (PLAN-006). GitHub redirects the browser here
// with ?installation_id=&setup_action=. A GET never changes state: this page
// asks the admin to confirm, and the button POSTs through the web tier.
export default async function GithubCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const action = typeof sp.setup_action === "string" ? sp.setup_action : "";
  const raw = typeof sp.installation_id === "string" ? sp.installation_id : "";
  // org member asked an owner to approve — nothing to bind yet
  if (action === "request") redirect("/settings/integrations?github=requested");
  if (!/^\d{1,15}$/.test(raw)) redirect("/settings/integrations?github=error&code=400");

  const me = await api<Me>("/v1/auth/me");
  if (!me.data) redirect("/login");
  const role = me.data.memberships.find(
    (m) => m.workspaceSlug === me.data!.workspaceSlug,
  )?.role;
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title="Link GitHub installation" meta={me.data.workspaceSlug} />
      <GithubLinkConfirm
        installationId={Number(raw)}
        workspace={me.data.workspaceSlug}
        canAdmin={role === "owner" || role === "admin"}
      />
    </main>
  );
}
