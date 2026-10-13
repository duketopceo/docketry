"use client";

import type { IssueState, Priority } from "@tallyline/types";
import { legalTransitions, PRIORITIES } from "@tallyline/types";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { ActorRef } from "@/lib/actors";
import type { ListLabel } from "@/components/issue-list-client";
import { Avatar, Sparkle } from "@/components/primitives";

const SELECT_CLS =
  "h-6 rounded-sm border border-control bg-surface-2 px-1 font-mono text-[11px] text-ink-muted focus:border-accent focus:outline-none disabled:opacity-50";

async function patchIssue(
  issueKey: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/issues/${issueKey}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const NEXT_LABEL: Partial<Record<IssueState, string>> = {
  backlog: "→ backlog",
  todo: "→ todo",
  in_progress: "start work",
  in_review: "→ review",
  done: "✓ done",
  canceled: "cancel",
  duplicate: "mark duplicate",
};

export function StateActions({
  issueKey,
  state,
}: {
  issueKey: string;
  state: IssueState;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = legalTransitions(state);

  if (next.length === 0) {
    return (
      <span className="font-mono text-[11px] text-ink-tertiary">
        terminal state
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {next.map((to) => (
        <button
          key={to}
          type="button"
          disabled={pending !== null}
          onClick={async () => {
            setPending(to);
            setError(null);
            const res = await fetch(`/api/issues/${issueKey}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ state: to }),
            });
            setPending(null);
            if (!res.ok) {
              setError("transition rejected — refresh and retry");
              return;
            }
            router.refresh();
          }}
          className={`h-7 rounded-sm px-2.5 font-mono text-[11px] transition-colors disabled:opacity-50 ${
            to === "done"
              ? "bg-healthy/20 text-healthy hover:bg-healthy/30"
              : to === "canceled" || to === "duplicate"
                ? "border border-control text-ink-subtle hover:border-urgent hover:text-urgent"
                : "border border-control text-ink-muted hover:border-accent hover:text-accent"
          }`}
        >
          {pending === to ? "…" : (NEXT_LABEL[to] ?? `→ ${to}`)}
        </button>
      ))}
      {error && (
        <span className="text-[11px] text-urgent" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function AssigneeSelect({
  issueKey,
  actors,
  currentType,
  currentId,
}: {
  issueKey: string;
  actors: ActorRef[];
  currentType: "human" | "agent" | null;
  currentId: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = currentType && currentId ? `${currentType}:${currentId}` : "";
  const current = currentId ? actors.find((a) => a.id === currentId) : undefined;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar actor={current} />
      <select
        aria-label="Assignee"
        value={value}
        disabled={pending}
        onChange={async (e) => {
          const v = e.target.value;
          setPending(true);
          setError(null);
          const body = v
            ? {
                assigneeType: v.split(":")[0],
                assigneeId: v.split(":")[1],
              }
            : { assigneeType: null, assigneeId: null };
          const ok = await patchIssue(issueKey, body);
          setPending(false);
          if (!ok) {
            setError("assignee change rejected");
            return;
          }
          router.refresh();
        }}
        className={SELECT_CLS}
      >
        <option value="">unassigned</option>
        {actors.map((a) => (
          <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>
            {a.kind === "agent" ? "✦ " : ""}
            {a.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[11px] text-urgent" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function PrioritySelect({
  issueKey,
  current,
}: {
  issueKey: string;
  current: Priority;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <select
      aria-label="Priority"
      value={current}
      disabled={pending}
      onChange={async (e) => {
        setPending(true);
        const ok = await patchIssue(issueKey, { priority: e.target.value });
        setPending(false);
        if (ok) router.refresh();
      }}
      className={SELECT_CLS}
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {p === "none" ? "no priority" : p}
        </option>
      ))}
    </select>
  );
}

export function LabelPicker({
  issueKey,
  all,
  current,
}: {
  issueKey: string;
  all: ListLabel[];
  current: ListLabel[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const currentIds = new Set(current.map((l) => l.id));
  const available = all.filter((l) => !currentIds.has(l.id));

  async function set(labelIds: string[]) {
    setPending(true);
    const ok = await patchIssue(issueKey, { labelIds });
    setPending(false);
    if (ok) router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {current.map((l) => (
        <button
          key={l.id}
          type="button"
          title={`remove ${l.name}`}
          disabled={pending}
          onClick={() => void set([...currentIds].filter((id) => id !== l.id))}
          className="inline-flex items-center gap-1 rounded-full border border-lining-faint bg-surface-2 px-1.5 py-px font-mono text-[11px] text-ink-subtle hover:border-urgent hover:text-urgent disabled:opacity-50"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: l.color }}
          />
          {l.name}
          <span aria-hidden>×</span>
        </button>
      ))}
      {available.length > 0 && (
        <select
          aria-label="Add label"
          value=""
          disabled={pending}
          onChange={(e) => {
            if (!e.target.value) return;
            void set([...currentIds, e.target.value]);
          }}
          className={SELECT_CLS}
        >
          <option value="">+ label</option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {all.length === 0 && (
        <span className="font-mono text-[11px] text-ink-tertiary">
          no labels — create them in settings
        </span>
      )}
    </span>
  );
}

export function EstimateEdit({
  issueKey,
  current,
}: {
  issueKey: string;
  current: number | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <select
      aria-label="Estimate"
      value={current === null ? "" : String(current)}
      disabled={pending}
      onChange={async (e) => {
        setPending(true);
        const v = e.target.value;
        const ok = await patchIssue(issueKey, {
          estimate: v === "" ? null : Number(v),
        });
        setPending(false);
        if (ok) router.refresh();
      }}
      className={SELECT_CLS}
    >
      <option value="">no estimate</option>
      {[1, 2, 3, 5, 8, 13].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

export function DueEdit({
  issueKey,
  current,
}: {
  issueKey: string;
  current: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <input
      type="date"
      aria-label="Due date"
      defaultValue={current ? current.slice(0, 10) : ""}
      disabled={pending}
      onChange={async (e) => {
        setPending(true);
        const v = e.target.value;
        const ok = await patchIssue(issueKey, {
          dueDate: v ? new Date(`${v}T00:00:00Z`).toISOString() : null,
        });
        setPending(false);
        if (ok) router.refresh();
      }}
      className={`${SELECT_CLS} [color-scheme:dark]`}
    />
  );
}

// provenance line per DESIGN.md — the glint precedes the actor name when
// an agent filed the issue; the words carry the fact, the glyph the mark
export function FiledBy({
  creatorName,
  creatorType,
  source,
  createdAt,
}: {
  creatorName: string | null;
  creatorType: string;
  source: string;
  createdAt: string;
}) {
  const when = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-tertiary">
      {creatorType === "agent" && (
        <Sparkle size={12} label={`filed by ${creatorName ?? "an agent"}`} />
      )}
      {creatorName ? `filed by ${creatorName}` : "filed"} · via {source} ·{" "}
      {when}
    </span>
  );
}

// LLM assist — renders nothing when the workspace has no TALLYLINE_LLM_*
// configured; the status probe keeps the UI honest instead of showing a
// button that always 503s.
export function SummarizeButton({ issueKey }: { issueKey: string }) {
  const [enabled, setEnabled] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/llm-status")
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => setEnabled(!!d.enabled))
      .catch(() => {});
  }, []);

  if (!enabled) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/issues/${issueKey}/summarize`, {
            method: "POST",
          });
          const body = (await res.json().catch(() => null)) as {
            summary?: string;
          } | null;
          setBusy(false);
          if (!res.ok || !body?.summary) {
            setError("summary unavailable — LLM assist may be misconfigured");
            return;
          }
          setSummary(body.summary);
        }}
        className="h-6 rounded-sm border border-control px-2 font-mono text-[11px] text-ink-subtle hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? "summarizing…" : "✦ summarize"}
      </button>
      {error && (
        <span className="ml-2 text-[11px] text-urgent" role="alert">
          {error}
        </span>
      )}
      {summary && (
        <p className="mt-2 max-w-prose border-l-2 border-accent/40 pl-3 text-[13px] leading-relaxed text-ink-muted">
          {summary}
        </p>
      )}
    </div>
  );
}

export function CommentComposer({ issueKey }: { issueKey: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/issues/${issueKey}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError("comment failed to post — retry");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void submit(e);
        }
      }}
      className="mt-4"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment…"
        rows={3}
        className="w-full resize-none rounded-sm border border-control bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
      />
      {error && (
        <p className="mt-1 text-[12px] text-urgent" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-ink-tertiary">
          <kbd>⌘⏎</kbd> to comment
        </span>
        <button
          type="submit"
          disabled={submitting || !body.trim()}
          className="h-7 rounded-sm bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Comment"}
        </button>
      </div>
    </form>
  );
}
