import Link from "next/link";
import {
  IssueListClient,
  type IssueGroup,
  type ListIssue,
} from "@/components/issue-list-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface IssueRow extends ListIssue {
  cycleId: string | null;
}

interface Cycle {
  id: string;
  number: number;
  name: string | null;
  teamId: string;
  startsAt: string;
  isActive: boolean;
}

interface Team {
  id: string;
  key: string;
}

export default async function AllIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; group?: string }>;
}) {
  const { cycle: cycleParam, group } = await searchParams;
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const slug = me.data.workspaceSlug;
  const res = await api<{ issues?: IssueRow[] }>(
    `/v1/workspaces/${slug}/issues?limit=200${cycleParam ? `&cycle=${encodeURIComponent(cycleParam)}` : ""}`,
  );
  const rows = res.data?.issues ?? [];

  let groups: IssueGroup[] | undefined;
  if (group === "cycle") {
    const [cyclesRes, teamsRes] = await Promise.all([
      api<{ cycles?: Cycle[] }>(`/v1/workspaces/${slug}/cycles`),
      api<{ teams?: Team[] }>(`/v1/workspaces/${slug}/teams`),
    ]);
    const cycles = cyclesRes.data?.cycles ?? [];
    const teamById = new Map(
      (teamsRes.data?.teams ?? []).map((t) => [t.id, t.key]),
    );
    // active cycles first, then latest-start first; uncycled issues last
    const ordered = [...cycles].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (
        new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
      );
    });
    groups = ordered
      .map((c) => ({
        key: c.id,
        label: `${teamById.get(c.teamId) ?? "?"} · Cycle ${c.number}${c.name ? ` — ${c.name}` : ""}`,
        issues: rows.filter((i) => i.cycleId === c.id),
      }))
      .filter((g) => g.issues.length > 0);
    const uncycled = rows.filter((i) => !i.cycleId);
    if (uncycled.length > 0) {
      groups.push({ key: "none", label: "No cycle", issues: uncycled });
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">All Issues</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length}
        </span>
        {cycleParam && (
          <span className="ml-3 font-mono text-[10px] text-ink-tertiary">
            filtered by cycle — <Link href="/issues" className="text-accent">clear</Link>
          </span>
        )}
        <Link
          href={
            group === "cycle"
              ? `/issues${cycleParam ? `?cycle=${encodeURIComponent(cycleParam)}` : ""}`
              : `/issues?group=cycle${cycleParam ? `&cycle=${encodeURIComponent(cycleParam)}` : ""}`
          }
          className="ml-auto font-mono text-[10px] text-ink-tertiary hover:text-ink-muted"
        >
          {group === "cycle" ? "ungroup" : "group by cycle"}
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="px-8 py-12 text-center text-sm text-ink-subtle">
          No issues yet — press <kbd className="rounded-sm border border-lining px-1 font-mono text-[11px]">c</kbd> to create one.
        </p>
      ) : (
        <IssueListClient issues={rows} groups={groups} />
      )}
    </main>
  );
}
