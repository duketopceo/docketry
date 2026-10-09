"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ListIssue } from "@/components/issue-list-client";

interface CommandPaletteProps {
  workspace: string;
}

export function CommandPalette({ workspace }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListIssue[]>([]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/issues/search?q=${encodeURIComponent(query)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { issues?: ListIssue[] };
        setResults(body.issues ?? []);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [open, query]);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery("");
      router.push(path);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/80 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        className="w-full max-w-lg overflow-hidden rounded-md border border-lining-bright bg-surface-1 shadow-lg"
        label="Command palette"
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search issues, jump to a view, or run an action…"
          className="w-full border-b border-lining-faint bg-transparent px-4 py-3 text-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-subtle">
            No results — try a different query.
          </Command.Empty>
          {results.length > 0 && (
            <Command.Group
              heading="Issues"
              className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary"
            >
              {results.map((issue) => (
                <Command.Item
                  key={issue.key}
                  value={`${issue.key} ${issue.title}`}
                  onSelect={() => go(`/issues/${issue.key}`)}
                  className="flex h-8 cursor-pointer items-center gap-3 rounded-sm px-2 text-[13px] text-ink-muted aria-selected:bg-surface-2 aria-selected:text-ink"
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-ink-tertiary">
                    {issue.key}
                  </span>
                  <span className="truncate">{issue.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group
            heading="Navigate"
            className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary"
          >
            {[
              { label: "My Issues", path: "/my-issues", hint: "g i" },
              { label: "Triage", path: "/triage", hint: "g t" },
              { label: "Cycle", path: "/cycle", hint: "g c" },
              { label: "All Issues", path: "/issues", hint: "g a" },
            ].map((item) => (
              <Command.Item
                key={item.path}
                value={item.label}
                onSelect={() => go(item.path)}
                className="flex h-8 cursor-pointer items-center justify-between rounded-sm px-2 text-[13px] text-ink-muted aria-selected:bg-surface-2 aria-selected:text-ink"
              >
                {item.label}
                <kbd className="font-mono text-[10px] text-ink-tertiary">
                  {item.hint}
                </kbd>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group
            heading="Actions"
            className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary"
          >
            <Command.Item
              value="create issue"
              onSelect={() => {
                setOpen(false);
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
              }}
              className="flex h-8 cursor-pointer items-center justify-between rounded-sm px-2 text-[13px] text-ink-muted aria-selected:bg-surface-2 aria-selected:text-ink"
            >
              Create issue
              <kbd className="font-mono text-[10px] text-ink-tertiary">c</kbd>
            </Command.Item>
            <Command.Item
              value="sign out"
              onSelect={() => {
                void fetch("/api/logout", { method: "POST" }).then(() => {
                  window.location.href = "/login";
                });
              }}
              className="flex h-8 cursor-pointer items-center justify-between rounded-sm px-2 text-[13px] text-ink-muted aria-selected:bg-surface-2 aria-selected:text-ink"
            >
              Sign out
              <kbd className="font-mono text-[10px] text-ink-tertiary">/</kbd>
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className="flex items-center justify-between border-t border-lining-faint px-3 py-1.5 font-mono text-[10px] text-ink-tertiary">
          <span>{workspace}</span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </Command>
    </div>
  );
}
