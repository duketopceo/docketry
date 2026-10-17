// Session status uses the fixed status colours plus a text label and shape
// (Silver Lining section 5/10); a running session shows a static dot, because
// nothing animates at rest.
import { IconCheck, IconCircle, IconX } from "./icons";
const MAP: Record<string, { label: string; tone: string; shape: "dot" | "ring" | "x" | "check" }> = {
  queued: { label: "Queued", tone: "text-ink-muted", shape: "ring" },
  claimed: { label: "Running", tone: "text-accent", shape: "dot" },
  completed: { label: "Done", tone: "text-healthy", shape: "check" },
  dispatch_failed: { label: "Failed", tone: "text-urgent", shape: "x" },
  canceled: { label: "Canceled", tone: "text-ink-subtle", shape: "ring" },
};

export function sessionStatus(status: string) {
  return MAP[status] ?? { label: status, tone: "text-ink-muted", shape: "ring" as const };
}

export function SessionBadge({ status }: { status: string }) {
  const s = sessionStatus(status);
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${s.tone}`}>
      {s.shape === "dot" && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {s.shape === "ring" && <IconCircle size={12} aria-hidden />}
      {s.shape === "x" && <IconX size={12} aria-hidden />}
      {s.shape === "check" && <IconCheck size={12} aria-hidden />}
      {s.label}
    </span>
  );
}
