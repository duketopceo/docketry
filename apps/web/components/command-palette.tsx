"use client";

import dynamic from "next/dynamic";
import { ModalFrame } from "./app/dialog-frames";
import { useEffect, useState } from "react";

export { recordRecent } from "@/lib/recent";

// cmdk and the palette UI load on first use; only this hotkey listener ships
// in the initial bundle (route JS budget, Silver Lining section 8).
const PaletteDialog = dynamic(() => import("./command-palette-dialog").then((m) => m.PaletteDialog), { ssr: false, loading: () => <ModalFrame /> });

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

export function CommandPalette({ workspace }: { workspace: string }) {
  const [state, setState] = useState<{ open: boolean; query: string }>({ open: false, query: "" });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setState((s) => ({ open: !s.open, query: "" }));
        return;
      }
      if (e.key === ":" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setState({ open: true, query: ":" });
      }
    }
    document.addEventListener("keydown", onKey);
    // e2e hydration signal tied to THIS listener (not a sibling's): a `:` or
    // ctrl+k pressed before it exists is silently lost
    document.documentElement.dataset.paletteReady = "1";
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.paletteReady;
    };
  }, []);

  if (!state.open) return null;
  return <PaletteDialog key={state.query} workspace={workspace} initialQuery={state.query} onClose={() => setState({ open: false, query: "" })} />;
}
