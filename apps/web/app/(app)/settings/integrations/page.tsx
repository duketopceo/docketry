import { api, type Me } from "@/lib/api";
import {
  GithubRepoPanel,
  type GithubRepoRow,
} from "@/components/github-repos";
import { GithubConnect, type GithubNotice } from "@/components/settings/github-connect";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/settings/ui";

interface ReposResponse {
  repos?: GithubRepoRow[];
}

function noticeFrom(sp: Record<string, string | string[] | undefined>): GithubNotice {
  const g = typeof sp.github === "string" ? sp.github : "";
  if (g === "connected") return { kind: "connected" };
  if (g === "requested") return { kind: "requested" };
  if (g === "error") {
    const code = Number(typeof sp.code === "string" ? sp.code : "");
    return { kind: "error", code: Number.isInteger(code) ? code : 0 };
  }
  return null;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data)
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  const role = me.data.memberships.find(
    (m) => m.workspaceSlug === me.data!.workspaceSlug,
  )?.role;
  const canAdmin = role === "owner" || role === "admin";
  if (!canAdmin) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Integrations" />
        <p className="p-4 text-sm text-ink-subtle">Requires admin access.</p>
      </main>
    );
  }

  const reposRes = await api<ReposResponse>(
    `/v1/workspaces/${me.data.workspaceSlug}/github/repos`,
  );
  const repos = reposRes.data?.repos ?? [];
  // an installationId on any row proves the App is installed + bound here;
  // rows with installationId === null were registered via the import path
  const installed = repos.some((r) => r.installationId != null);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-lining-faint px-4">
        <h1 className="shrink-0 text-sm font-semibold">Integrations</h1>
        <SettingsTabs />
        {installed && (
          <a
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 font-mono text-[11px] text-ink-tertiary hover:text-ink"
          >
            manage on GitHub ↗
          </a>
        )}
      </header>
      <GithubConnect canAdmin notice={noticeFrom(await searchParams)} />
      <GithubRepoPanel repos={repos} installed={installed} />
    </main>
  );
}
