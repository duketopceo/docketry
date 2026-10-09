import type { IssueState } from "@docketry/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CommentComposer,
  StateActions,
} from "@/components/issue-detail-client";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

interface Child {
  key: string;
  title: string;
  state: IssueState;
}

interface Comment {
  id: string;
  body: string;
  actorType: string;
  createdAt: string;
}

interface Event {
  id: number;
  action: string;
  actorType: string;
  createdAt: string;
}

interface IssueDetail {
  key: string;
  title: string;
  description: string | null;
  state: IssueState;
  priority: string;
  estimate: number | null;
  dueDate: string | null;
  creatorType: string;
  source: string;
  createdAt: string;
  children: Child[];
  labels: Label[];
}

const STATE_PILL: Record<IssueState, string> = {
  triage: "border-attention text-attention",
  backlog: "border-lining text-ink-subtle",
  todo: "border-lining text-ink-subtle",
  in_progress: "border-attention text-attention",
  in_review: "border-accent text-accent",
  done: "border-healthy text-healthy",
  canceled: "border-lining-faint text-ink-tertiary",
  duplicate: "border-lining-faint text-ink-tertiary",
};

function ts(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const base = `/v1/workspaces/${me.data.workspaceSlug}/issues/${key}`;
  const [issueRes, commentsRes, eventsRes] = await Promise.all([
    api<IssueDetail>(base),
    api<{ comments: Comment[] }>(`${base}/comments`),
    api<{ events: Event[] }>(`${base}/events`),
  ]);
  if (!issueRes.data) notFound();
  const issue = issueRes.data;
  const comments = commentsRes.data?.comments ?? [];
  const events = eventsRes.data?.events ?? [];

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="flex h-12 items-center gap-3 border-b border-lining-faint px-4">
        <Link
          href="/issues"
          className="font-mono text-[11px] text-ink-tertiary hover:text-ink-muted"
        >
          ← issues
        </Link>
        <span className="font-mono text-xs text-ink-muted">{issue.key}</span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${STATE_PILL[issue.state]}`}
        >
          {issue.state.replace("_", " ")}
        </span>
        {issue.creatorType === "agent" && (
          <span className="flex items-center gap-1 font-mono text-[10px] text-accent">
            <svg width="11" height="11" viewBox="0 0 24 24" className="fill-accent" aria-hidden>
              <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
            </svg>
            agent-created · via {issue.source}
          </span>
        )}
        <div className="ml-auto">
          <StateActions issueKey={issue.key} state={issue.state} />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="text-xl font-semibold leading-snug">{issue.title}</h1>

        <div className="mt-2 flex items-center gap-4 font-mono text-[11px] text-ink-tertiary">
          <span>priority: {issue.priority}</span>
          {issue.estimate !== null && <span>est: {issue.estimate}</span>}
          {issue.dueDate && <span>due: {ts(issue.dueDate)}</span>}
          <span>created: {ts(issue.createdAt)}</span>
        </div>

        {issue.labels.length > 0 && (
          <div className="mt-3 flex gap-1.5">
            {issue.labels.map((l) => (
              <span
                key={l.id}
                className="rounded-full border border-lining px-2 py-0.5 text-[11px] text-ink-muted"
                style={{ borderColor: l.color }}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-md border border-lining bg-surface-1 p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
            {issue.description || "No description."}
          </p>
        </div>

        {issue.children.length > 0 && (
          <section className="mt-6">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
              Sub-issues
            </h2>
            <ul className="mt-2 divide-y divide-lining-faint rounded-md border border-lining bg-surface-1">
              {issue.children.map((child) => (
                <li key={child.key}>
                  <Link
                    href={`/issues/${child.key}`}
                    className="flex h-8 items-center gap-3 px-3 text-[13px] text-ink-muted hover:bg-surface-2"
                  >
                    <span className="font-mono text-xs text-ink-tertiary">
                      {child.key}
                    </span>
                    <span className="truncate">{child.title}</span>
                    <span className="ml-auto font-mono text-[10px] uppercase text-ink-tertiary">
                      {child.state.replace("_", " ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
            Comments ({comments.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {comments.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-lining bg-surface-1 p-3"
              >
                <div className="flex items-center gap-2 font-mono text-[10px] text-ink-tertiary">
                  <span className="capitalize">{c.actorType}</span>
                  {c.actorType === "agent" && (
                    <svg width="10" height="10" viewBox="0 0 24 24" className="fill-accent" aria-label="agent" role="img">
                      <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
                    </svg>
                  )}
                  <span>{ts(c.createdAt)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
          <CommentComposer issueKey={issue.key} />
        </section>

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
            Activity
          </h2>
          <ol className="mt-3 space-y-1 border-l border-lining-faint pl-4">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-3 font-mono text-[11px] text-ink-subtle"
              >
                <span className="w-20 shrink-0 text-ink-tertiary">
                  {ts(e.createdAt)}
                </span>
                <span className="capitalize text-ink-tertiary">
                  {e.actorType}
                </span>
                <span>{e.action.replace(/_/g, " ")}</span>
                {e.actorType === "agent" && (
                  <svg width="9" height="9" viewBox="0 0 24 24" className="fill-accent" aria-hidden>
                    <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
                  </svg>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
