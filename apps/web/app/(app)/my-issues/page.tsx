import {
  IssueListClient,
  type ListIssue,
} from "@/components/issue-list-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
  userId: string;
}

interface IssueList {
  issues?: ListIssue[];
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export default async function MyIssuesPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<IssueList>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues?state=todo,in_progress,in_review&limit=100`,
  );
  const rows = [...(res.data?.issues ?? [])].sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4),
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">My Issues</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length} active
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-12 text-center">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden>
            <rect x="4" y="7" width="24" height="19" rx="3" fill="none" stroke="#39404c" strokeWidth="1.5" />
            <path d="M8.5 7h15" stroke="#c9cdd4" strokeWidth="1.6" strokeLinecap="round" />
            <rect x="8.5" y="11.5" width="10" height="2.6" rx="1.3" fill="#39404c" />
          </svg>
          <p className="mt-4 text-sm font-medium text-ink">
            Nothing assigned to you
          </p>
          <p className="mt-1 text-[13px] text-ink-subtle">
            Active issues assigned to you appear here. Press{" "}
            <kbd className="rounded-sm border border-lining px-1 font-mono text-[11px]">c</kbd>{" "}
            to create one, or pull from the backlog.
          </p>
        </div>
      ) : (
        <IssueListClient issues={rows} />
      )}
    </main>
  );
}
