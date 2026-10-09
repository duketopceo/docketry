"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Binding {
  keys: string;
  action: string;
  context?: string;
}

const GROUPS: { name: string; bindings: Binding[] }[] = [
  {
    name: "Global",
    bindings: [
      { keys: "⌘K / ctrl+k", action: "command palette" },
      { keys: ":", action: "command mode (in palette)" },
      { keys: "?", action: "this overlay" },
      { keys: "c", action: "quick-create issue" },
      { keys: "esc", action: "close overlay / clear selection" },
    ],
  },
  {
    name: "Navigate (g-sequences)",
    bindings: [
      { keys: "g i", action: "my issues" },
      { keys: "g t", action: "triage" },
      { keys: "g r", action: "review queue" },
      { keys: "g b", action: "board" },
      { keys: "g c", action: "cycle" },
      { keys: "g a", action: "all issues" },
      { keys: "g s", action: "insights" },
      { keys: "g p", action: "roadmap" },
      { keys: "g e", action: "activity" },
    ],
  },
  {
    name: "Lists",
    bindings: [
      { keys: "j / ↓", action: "move down" },
      { keys: "k / ↑", action: "move up" },
      { keys: "x", action: "select / toggle row" },
      { keys: "enter", action: "open issue" },
      { keys: "a", action: "accept (triage) · approve (review)" },
      { keys: "d", action: "decline (triage)" },
      { keys: "x", action: "send back (review)" },
    ],
  },
  {
    name: "Command mode (:)",
    bindings: [
      { keys: ":state KEY STATE", action: "walk issue to state (legal path)" },
      { keys: ":done KEY", action: "shortcut for state done" },
      { keys: ":start KEY", action: "shortcut for in_progress" },
      { keys: ":assign KEY me|agent", action: "assign issue" },
      { keys: ":comment KEY text…", action: "post a comment" },
      { keys: ":open KEY", action: "jump to issue" },
    ],
  },
];

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

export function KeymapOverlay() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        setFilter("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      bindings: g.bindings.filter(
        (b) =>
          b.keys.toLowerCase().includes(q) || b.action.toLowerCase().includes(q),
      ),
    })).filter((g) => g.bindings.length > 0);
  }, [filter]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/80 pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-md border border-lining-bright bg-surface-1 shadow-lg">
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter bindings…"
          aria-label="Filter keyboard shortcuts"
          className="w-full border-b border-lining-faint bg-transparent px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <div className="max-h-[55vh] overflow-y-auto p-3">
          {groups.map((g) => (
            <div key={g.name} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                {g.name}
              </p>
              <ul>
                {g.bindings.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-sm px-2 py-1 text-[12px] text-ink-muted"
                  >
                    <kbd className="font-mono text-[11px] text-ink">{b.keys}</kbd>
                    <span className="text-ink-subtle">{b.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-ink-tertiary">
              no bindings match
            </p>
          )}
        </div>
        <div className="border-t border-lining-faint px-3 py-1.5 font-mono text-[10px] text-ink-tertiary">
          <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
