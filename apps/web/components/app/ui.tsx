import type { IssueState, Priority } from "@tallyline/types";
import { initials, PRIORITY_LABEL, STATE_LABEL } from "@/lib/format";
import { PRIORITY_ICONS, STATE_ICONS } from "./icons";

// Status is never colour-only: every state has its own shape (Silver Lining
// section 5). Glyphs are 14px strokes that stay readable at 16px.
const STATE_TONE: Record<IssueState, string> = {
  triage: "text-attention",
  backlog: "text-neutral",
  todo: "text-ink-muted",
  in_progress: "text-attention",
  in_review: "text-accent",
  done: "text-healthy",
  canceled: "text-ink-tertiary",
  duplicate: "text-ink-tertiary",
};

export function StateGlyph({ state, size = 14, labelled = true }: { state: IssueState; size?: number; labelled?: boolean }) {
  const Glyph = STATE_ICONS[state];
  const a11y = labelled ? { role: "img", "aria-label": STATE_LABEL[state] } : { "aria-hidden": true };
  return <Glyph size={size} className={`shrink-0 ${STATE_TONE[state]}`} {...a11y} />;
}

export function PriorityGlyph({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const Icon = PRIORITY_ICONS[priority];
  const tone = priority === "urgent" ? "text-urgent" : priority === "high" ? "text-attention" : "text-ink-subtle";
  return <Icon size={size} role="img" aria-label={PRIORITY_LABEL[priority]} className={`shrink-0 ${tone}`} />;
}

export function Glint({ size = 12, label }: { size?: 12 | 16 | 20; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0 fill-accent" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <path d="M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6Z" />
    </svg>
  );
}

// human = initials disc; agent = squared chip with the glint, so the two are
// distinguishable without colour
export function Assignee({ type, name, size = 20 }: { type: "human" | "agent" | null | undefined; name: string | null; size?: number }) {
  if (!type || !name) {
    return (
      <span aria-label="Unassigned" role="img" style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-lining-strong text-ink-subtle" />
    );
  }
  if (type === "agent") {
    return (
      <span title={`${name} (agent)`} role="img" aria-label={`${name}, agent`} style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-xs border border-lining-strong bg-surface-3">
        <Glint size={12} label="" />
      </span>
    );
  }
  return (
    <span title={name} role="img" aria-label={name} style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-4 text-[11px] font-medium text-ink-muted">
      {initials(name)}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-current/40 px-1 font-mono text-[11px] text-current">{children}</kbd>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-xs bg-surface-3 ${className}`} />;
}
