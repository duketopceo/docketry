"use client";

import { useEffect, useState } from "react";

export function SlowNote({ className = "" }: { className?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return null;
  return (
    <p className={`flex items-center gap-2 px-4 pb-3 text-2xs text-ink-3 ${className}`}>
      Still loading — the API is slow to answer.
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xs border border-lining-faint px-1.5 py-0.5 text-ink-2 hover:bg-surface-3"
      >
        Retry
      </button>
    </p>
  );
}
