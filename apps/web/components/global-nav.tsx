"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const SEQUENCES: Record<string, string> = {
  i: "/my-issues",
  t: "/triage",
  r: "/review",
  c: "/cycle",
  a: "/issues",
  e: "/activity",
};
const SEQ_TIMEOUT_MS = 800;

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

// g-sequences — `g i` my issues, `g t` triage, `g r` review, `g c` cycle,
// `g a` all issues, `g e` activity. Mirrors the sidebar hints.
export function GlobalNav() {
  const router = useRouter();
  const pending = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (pending.current !== null) {
        const target = SEQUENCES[e.key];
        window.clearTimeout(pending.current);
        pending.current = null;
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        return;
      }
      if (e.key === "g") {
        pending.current = window.setTimeout(() => {
          pending.current = null;
        }, SEQ_TIMEOUT_MS);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
