import { api, type Me } from "@/lib/api";
import {
  ProjectsSettings,
  type ProjectRow,
} from "@/components/projects-settings";
import { SettingsTabs } from "@/components/settings-tabs";

interface ProjectsResponse {
  projects?: ProjectRow[];
}

export default async function ProjectsPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<ProjectsResponse>(
    `/v1/workspaces/${me.data.workspaceSlug}/projects`,
  );
  const rows = res.data?.projects ?? [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Projects</h1>
        <SettingsTabs />
        <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
          {rows.length}
        </span>
      </header>
      <ProjectsSettings projects={rows} />
    </main>
  );
}
