"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

const ROLE_ORDER = ["owner", "admin", "member"] as const;

export function MemberList({
  members,
  canAdmin,
  selfId,
}: {
  members: MemberRow[];
  canAdmin: boolean;
  selfId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MemberRow | null>(null);

  async function call(
    member: MemberRow,
    init: RequestInit,
    fallback: string,
  ) {
    setBusy(member.id);
    setError(null);
    const res = await fetch(`/api/settings/members/${member.id}`, init);
    setBusy(null);
    if (res.ok) {
      router.refresh();
    } else {
      const d = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(d?.error?.message ?? fallback);
    }
  }

  async function changeRole(member: MemberRow, role: string) {
    await call(
      member,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      },
      "could not change role",
    );
  }

  async function remove(member: MemberRow) {
    setConfirmRemove(null);
    await call(member, { method: "DELETE" }, "could not remove member");
  }

  return (
    <div className="p-4">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
        >
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-lining-faint text-left font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
            <th className="pb-2 font-normal">Name</th>
            <th className="pb-2 font-normal">Email</th>
            <th className="pb-2 font-normal">Role</th>
            {canAdmin && <th className="pb-2 font-normal" />}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-lining-faint">
              <td className="py-2.5 pr-4 text-ink">
                {m.name}
                {m.userId === selfId && (
                  <span className="ml-2 font-mono text-[10px] text-ink-tertiary">
                    you
                  </span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-ink-muted">{m.email}</td>
              <td className="py-2.5 pr-4">
                {canAdmin ? (
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    disabled={busy === m.id}
                    onChange={(e) => changeRole(m, e.target.value)}
                    className="rounded-sm border border-lining bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-lining-strong"
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ink-subtle">
                    {m.role}
                  </span>
                )}
              </td>
              {canAdmin && (
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => setConfirmRemove(m)}
                    disabled={busy === m.id}
                    className="rounded-sm px-2 py-1 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {confirmRemove && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
        >
          <div className="w-full max-w-sm rounded-md border border-lining bg-surface-1 p-5">
            <h2 className="text-sm font-semibold">Remove member</h2>
            <p className="mt-2 text-sm text-ink-subtle">
              Remove {confirmRemove.name} ({confirmRemove.email}) from this
              workspace? Their sessions and tokens stop working immediately.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemove(null)}
                className="rounded-sm px-3 py-1.5 text-sm text-ink-subtle hover:bg-surface-2"
              >
                cancel
              </button>
              <button
                onClick={() => remove(confirmRemove)}
                className="rounded-sm bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
