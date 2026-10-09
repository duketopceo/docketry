import {
  IssueListClient,
  type ListIssue,
} from "@/components/issue-list-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function AllIssuesPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<{ issues?: ListIssue[] }>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues?limit=200`,
  );
  const rows = res.data?.issues ?? [];
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">All Issues</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-8 py-12 text-center text-sm text-ink-subtle">
          No issues yet — press <kbd className="rounded-sm border border-lining px-1 font-mono text-[11px]">c</kbd> to create one.
        </p>
      ) : (
        <IssueListClient issues={rows} />
      )}
    </main>
  );
}
