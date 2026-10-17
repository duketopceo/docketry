"use client";

import dynamic from "next/dynamic";
import { ModalFrame } from "./app/dialog-frames";
import { useEffect, useState } from "react";

// the form loads on first use; only the `c` listener ships in the shell
const QuickCreateDialog = dynamic(() => import("./quick-create-dialog").then((m) => m.QuickCreateDialog), { ssr: false, loading: () => <ModalFrame /> });

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function QuickCreate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.qcReady = "1";
    return () => {
      delete document.documentElement.dataset.qcReady;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "c" && !open && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return <QuickCreateDialog onClose={() => setOpen(false)} />;
}
