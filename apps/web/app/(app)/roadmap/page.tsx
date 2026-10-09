import {
  RoadmapClient,
  type RoadmapCycle,
  type RoadmapIssue,
  type RoadmapMilestone,
  type RoadmapProject,
  type RoadmapTeam,
} from "@/components/roadmap-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function RoadmapPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const slug = me.data.workspaceSlug;
  const [projectsRes, cyclesRes, teamsRes, milestonesRes, issuesRes] =
    await Promise.all([
      api<{ projects?: RoadmapProject[] }>(`/v1/workspaces/${slug}/projects`),
      api<{ cycles?: RoadmapCycle[] }>(`/v1/workspaces/${slug}/cycles`),
      api<{ teams?: RoadmapTeam[] }>(`/v1/workspaces/${slug}/teams`),
      api<{ milestones?: RoadmapMilestone[] }>(
        `/v1/workspaces/${slug}/milestones`,
      ),
      api<{ issues?: RoadmapIssue[] }>(
        `/v1/workspaces/${slug}/issues?limit=200`,
      ),
    ]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Roadmap</h1>
        <span className="font-mono text-[11px] text-ink-tertiary">
          {projectsRes.data?.projects?.length ?? 0} projects ·{" "}
          {cyclesRes.data?.cycles?.length ?? 0} cycles
        </span>
      </header>
      <RoadmapClient
        projects={projectsRes.data?.projects ?? []}
        cycles={cyclesRes.data?.cycles ?? []}
        teams={teamsRes.data?.teams ?? []}
        milestones={milestonesRes.data?.milestones ?? []}
        issues={issuesRes.data?.issues ?? []}
      />
    </main>
  );
}
