import type { IssueState, Priority } from "@tallyline/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CycleSelect,
  type CycleOption,
} from "@/components/cycle-select";
import {
  ProjectSelect,
  type ProjectOption,
} from "@/components/project-select";
import {
  AssigneeSelect,
  CommentComposer,
  DueEdit,
  EstimateEdit,
  FiledBy,
  LabelPicker,
  PrioritySelect,
  StateActions,
  SummarizeButton,
} from "@/components/issue-detail-client";
import { PriorityIcon, Sparkle, StatePill } from "@/components/primitives";
import { SessionTimeline } from "@/components/session-timeline";
import { api } from "@/lib/api";
import { getActorDirectory } from "@/lib/actors";

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
  assigneeType: "human" | "agent" | null;
  assigneeId: string | null;
  creatorType: string;
  creatorId: string | null;
  source: string;
  teamId: string;
  cycleId: string | null;
  projectId: string | null;
  createdAt: string;
  children: Child[];
  labels: Label[];
}

interface CycleRow {
  id: string;
  number: number;
  name: string | null;
  teamId: string;
  isActive: boolean;
}

interface ProjectRow {
  id: string;
  name: string;
  teamId: string | null;
}

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
  const slug = me.data.workspaceSlug;
  const base = `/v1/workspaces/${slug}/issues/${key}`;
  const [issueRes, commentsRes, eventsRes, cyclesRes, projectsRes, labelsRes] =
    await Promise.all([
      api<IssueDetail>(base),
      api<{ comments: Comment[] }>(`${base}/comments`),
      api<{ events: Event[] }>(`${base}/events`),
      api<{ cycles: CycleRow[] }>(`/v1/workspaces/${slug}/cycles`),
      api<{ projects: ProjectRow[] }>(`/v1/workspaces/${slug}/projects`),
      api<{ labels: Label[] }>(`/v1/workspaces/${slug}/labels`),
    ]);
  if (!issueRes.data) notFound();
  const issue = issueRes.data;
  const comments = commentsRes.data?.comments ?? [];
  const events = eventsRes.data?.events ?? [];
  const actors = await getActorDirectory(slug);
  const actorList = Object.values(actors);
  // cycles are team-scoped — only offer ones from the issue's own team
  const cycleOptions: CycleOption[] = (cyclesRes.data?.cycles ?? [])
    .filter((c) => c.teamId === issue.teamId)
    .map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      isActive: c.isActive,
    }));
  // team-scoped projects only accept issues from their own team (the API
  // rejects the PATCH otherwise) — workspace projects are always offered
  const projectOptions: ProjectOption[] = (projectsRes.data?.projects ?? [])
    .filter((p) => p.teamId === null || p.teamId === issue.teamId)
    .map((p) => ({ id: p.id, name: p.name }));

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
        <StatePill state={issue.state} />
        {issue.creatorType === "agent" && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-accent">
            <Sparkle size={12} label="agent created" />
            agent-created · via {issue.source}
          </span>
        )}
        <div className="ml-auto">
          <StateActions issueKey={issue.key} state={issue.state} />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="text-xl font-semibold leading-snug">{issue.title}</h1>

        <div className="mt-1.5">
          <FiledBy
            creatorName={
              issue.creatorId ? (actors[issue.creatorId]?.name ?? null) : null
            }
            creatorType={issue.creatorType}
            source={issue.source}
            createdAt={issue.createdAt}
          />
        </div>

        <dl className="mt-4 grid grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-2.5 rounded-md border border-lining-faint bg-surface-1 p-4 font-mono text-[11px]">
          <dt className="text-ink-tertiary">assignee</dt>
          <dd>
            <AssigneeSelect
              issueKey={issue.key}
              actors={actorList}
              currentType={issue.assigneeType}
              currentId={issue.assigneeId}
            />
          </dd>
          <dt className="text-ink-tertiary">priority</dt>
          <dd className="flex items-center gap-2">
            <PriorityIcon priority={issue.priority as Priority} />
            <PrioritySelect
              issueKey={issue.key}
              current={issue.priority as Priority}
            />
          </dd>
          <dt className="text-ink-tertiary">labels</dt>
          <dd>
            <LabelPicker
              issueKey={issue.key}
              all={labelsRes.data?.labels ?? []}
              current={issue.labels}
            />
          </dd>
          <dt className="text-ink-tertiary">estimate</dt>
          <dd>
            <EstimateEdit issueKey={issue.key} current={issue.estimate} />
          </dd>
          <dt className="text-ink-tertiary">due</dt>
          <dd>
            <DueEdit issueKey={issue.key} current={issue.dueDate} />
          </dd>
          <dt className="text-ink-tertiary">cycle</dt>
          <dd>
            <CycleSelect
              issueKey={issue.key}
              cycles={cycleOptions}
              current={issue.cycleId}
            />
          </dd>
          <dt className="text-ink-tertiary">project</dt>
          <dd>
            <ProjectSelect
              issueKey={issue.key}
              projects={projectOptions}
              current={issue.projectId}
            />
          </dd>
        </dl>

        <div className="mt-5 rounded-md border border-lining bg-surface-1 p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
            {issue.description || "No description."}
          </p>
        </div>
        <SummarizeButton issueKey={issue.key} />

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
                    <span className="ml-auto font-mono text-[11px] uppercase text-ink-tertiary">
                      {child.state.replace("_", " ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <SessionTimeline issueKey={issue.key} />

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
                <div className="flex items-center gap-2 font-mono text-[11px] text-ink-tertiary">
                  <span className="capitalize">{c.actorType}</span>
                  {c.actorType === "agent" && (
                    <Sparkle size={12} label="agent" />
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
                  <Sparkle size={12} label="" />
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
