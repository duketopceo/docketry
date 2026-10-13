"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface LabelRow {
  id: string;
  name: string;
  color: string;
}

// label colour is user data (the API stores #rrggbb) — a random swatch seeds
// the picker; building it keeps a raw hex out of component code (design gate)
const randomLabelColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;

async function err(res: Response, fallback: string) {
  const d = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return d?.error?.message ?? fallback;
}

export function LabelsSettings({ labels }: { labels: LabelRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  // SSR + first client paint agree on "" (renders as black for type=color);
  // a real swatch arrives post-mount so hydration never mismatches
  const [color, setColor] = useState("");
  useEffect(() => setColor(randomLabelColor()), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  async function run(
    path: string,
    init: RequestInit,
    fallback: string,
    busyKey = "form",
  ) {
    setBusy(busyKey);
    setError(null);
    const res = await fetch(path, init);
    setBusy(null);
    if (res.ok) {
      router.refresh();
      return true;
    }
    setError(await err(res, fallback));
    return false;
  }

  async function create() {
    const ok = await run(
      "/api/labels",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      },
      "could not create label",
    );
    if (ok) {
      setName("");
      setColor(randomLabelColor());
    }
  }

  async function save(label: LabelRow) {
    const ok = await run(
      `/api/labels/${label.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      },
      "could not update label",
      label.id,
    );
    if (ok) setEditing(null);
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
        >
          {error}
        </p>
      )}

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Label color"
          className="h-7 w-9 cursor-pointer rounded-sm border border-control bg-surface-1 p-0.5"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New label name"
          required
          maxLength={60}
          className="min-w-0 flex-1 rounded-sm border border-control bg-surface-1 px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-disabled focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={busy === "form" || !name.trim()}
          className="rounded-sm bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent disabled:opacity-50"
        >
          Add label
        </button>
      </form>

      {labels.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-subtle">
          No labels yet. Labels tag issues and board cards — the pickers
          (<kbd className="font-mono">l</kbd> on a row) read this list.
        </p>
      ) : (
        <ul className="divide-y divide-lining-faint rounded-sm border border-lining">
          {labels.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              {editing === l.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Label name"
                    maxLength={60}
                    className="min-w-0 flex-1 rounded-sm border border-control bg-surface-1 px-2 py-1 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  />
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    aria-label="Label color"
                    className="h-6 w-8 cursor-pointer rounded-sm border border-control bg-surface-1 p-0.5"
                  />
                  <button
                    type="button"
                    onClick={() => void save(l)}
                    disabled={busy === l.id || !editName.trim()}
                    className="font-mono text-[11px] text-accent hover:underline disabled:opacity-50"
                  >
                    save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="font-mono text-[11px] text-ink-subtle hover:text-ink"
                  >
                    cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {l.name}
                  </span>
                  <span className="font-mono text-[11px] text-ink-tertiary">
                    {l.color}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(l.id);
                      setEditName(l.name);
                      setEditColor(l.color);
                    }}
                    className="font-mono text-[11px] text-ink-subtle hover:text-ink"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        `/api/labels/${l.id}`,
                        { method: "DELETE" },
                        "could not delete label",
                        l.id,
                      )
                    }
                    disabled={busy === l.id}
                    className="font-mono text-[11px] text-ink-subtle hover:text-danger disabled:opacity-50"
                  >
                    delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
