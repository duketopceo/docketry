import { BoardLoader } from "@/components/board-loader";
import type { ListIssue } from "@/components/issue-list-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface IssueList {
  issues?: ListIssue[];
}

export default async function BoardPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<IssueList>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues?state=triage,backlog,todo,in_progress,in_review&limit=200`,
  );
  const rows = res.data?.issues ?? [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Board</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length} active
        </span>
      </header>
      <BoardLoader issues={rows} />
    </main>
  );
}
