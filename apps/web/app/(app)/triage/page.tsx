import {
  IssueListClient,
  type ListIssue,
} from "@/components/issue-list-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface IssueList {
  issues?: ListIssue[];
}

export default async function TriagePage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<IssueList>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues?state=triage&limit=200`,
  );
  const rows = res.data?.issues ?? [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Triage</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length} incoming
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-12 text-center">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden>
            <rect x="4" y="7" width="24" height="19" rx="3" fill="none" stroke="#39404c" strokeWidth="1.5" />
            <path d="M8.5 7h15" stroke="#c9cdd4" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M26 0.5L27.5 4.5L31.5 6L27.5 7.5L26 11.5L24.5 7.5L20.5 6L24.5 4.5Z" fill="#3ea1f7" />
          </svg>
          <p className="mt-4 text-sm font-medium text-ink">Triage is empty</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-subtle">
            Intake from GitHub, Slack, and agents lands here for accept/decline.
            Connect a source under settings when integrations ship.
          </p>
        </div>
      ) : (
        <IssueListClient issues={rows} triage />
      )}
    </main>
  );
}
