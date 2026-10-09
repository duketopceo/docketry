import { IssueRow, type IssueRowData } from "@/components/issue-row";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function AllIssuesPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<{ issues?: IssueRowData[] }>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues?limit=200`,
  );
  const rows = res.data?.issues ?? [];
  return (
    <main className="flex-1 overflow-y-auto">
      <header className="flex h-12 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">All Issues</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length}
        </span>
      </header>
      <ul>
        {rows.map((issue) => (
          <IssueRow key={issue.key} issue={issue} />
        ))}
      </ul>
    </main>
  );
}
