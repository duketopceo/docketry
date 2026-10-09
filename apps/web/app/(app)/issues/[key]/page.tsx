import { notFound } from "next/navigation";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface IssueDetail {
  key: string;
  title: string;
  description: string | null;
  state: string;
  priority: string;
  creatorType: string;
  createdAt: string;
  comments?: { id: string; body: string; actorType: string; createdAt: string }[];
}

export default async function IssuePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<IssueDetail>(
    `/v1/workspaces/${me.data.workspaceSlug}/issues/${key}`,
  );
  if (!res.data) notFound();
  const issue = res.data;

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="flex h-12 items-center gap-3 border-b border-lining-faint px-4">
        <span className="font-mono text-xs text-ink-tertiary">{issue.key}</span>
        <span className="rounded-full border border-lining px-2 py-0.5 font-mono text-[10px] uppercase text-ink-subtle">
          {issue.state.replace("_", " ")}
        </span>
        {issue.creatorType === "agent" && (
          <svg width="12" height="12" viewBox="0 0 24 24" className="fill-accent" aria-label="agent created" role="img">
            <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
          </svg>
        )}
      </header>
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="text-xl font-semibold leading-snug">{issue.title}</h1>
        <div className="mt-4 rounded-md border border-lining bg-surface-1 p-4">
          <p className="whitespace-pre-wrap text-sm text-ink-muted">
            {issue.description || "No description."}
          </p>
        </div>
        <p className="mt-6 font-mono text-[11px] text-ink-tertiary">
          Editing, comments, and activity timeline land with the detail-page
          slice (#8). Priority: {issue.priority}.
        </p>
      </div>
    </main>
  );
}
