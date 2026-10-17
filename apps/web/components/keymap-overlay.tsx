"use client";

import dynamic from "next/dynamic";
import { ModalFrame } from "./app/dialog-frames";
import { useEffect, useState } from "react";

// the shortcut sheet loads on first `?`; only the listener ships in the shell
const KeymapDialog = dynamic(() => import("./keymap-dialog").then((m) => m.KeymapDialog), { ssr: false, loading: () => <ModalFrame /> });

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

export function KeymapOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return <KeymapDialog onClose={() => setOpen(false)} />;
}
