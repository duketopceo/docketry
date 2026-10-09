"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ProjectOption {
  id: string;
  name: string;
}

export function ProjectSelect({
  issueKey,
  projects,
  current,
}: {
  issueKey: string;
  projects: ProjectOption[];
  current: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={current ?? ""}
        disabled={pending}
        onChange={async (e) => {
          setPending(true);
          setError(null);
          try {
            const res = await fetch(`/api/issues/${issueKey}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ projectId: e.target.value || null }),
            });
            if (!res.ok) {
              setError("project change rejected");
              return;
            }
            router.refresh();
          } catch {
            setError("network error");
          } finally {
            setPending(false);
          }
        }}
        className="h-6 rounded-sm border border-lining bg-surface-2 px-1 font-mono text-[11px] text-ink-muted focus:border-accent focus:outline-none disabled:opacity-50"
      >
        <option value="">no project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
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
