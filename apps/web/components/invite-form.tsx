"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface InviteRow {
  id: string;
  email: string | null;
  role: "member" | "admin";
  teamId: string | null;
  expiresAt: string;
}

export interface TeamRow {
  id: string;
  key: string;
  name: string;
}

const field =
  "mt-1 w-full rounded-sm border border-lining bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-lining-strong";
const label = "mt-4 block text-xs text-ink-subtle";

export function InvitePanel({
  invites,
  teams,
}: {
  invites: InviteRow[];
  teams: TeamRow[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<InviteRow | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setJoinUrl(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/settings/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(fd.get("email") ? { email: fd.get("email") } : {}),
        role: fd.get("role"),
        ...(fd.get("teamId") ? { teamId: fd.get("teamId") } : {}),
        expiresInDays: Number(fd.get("expiresInDays") || 7),
      }),
    });
    setPending(false);
    const d = (await res.json().catch(() => null)) as {
      joinUrl?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && d?.joinUrl) {
      setJoinUrl(d.joinUrl);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } else {
      setError(d?.error?.message ?? "could not create invite");
    }
  }

  async function revoke(invite: InviteRow) {
    setConfirmRevoke(null);
    const res = await fetch(`/api/settings/invites/${invite.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
    } else {
      const d = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(d?.error?.message ?? "could not revoke invite");
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const teamName = (id: string | null) =>
    id ? (teams.find((t) => t.id === id)?.key ?? id.slice(0, 8)) : "—";

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-2">
      <form
        onSubmit={create}
        className="rounded-md border border-lining bg-surface-1 p-5"
      >
        <h2 className="text-sm font-semibold">Invite link</h2>
        <p className="mt-1 text-xs text-ink-subtle">
          Share the join URL — bound to an email, or open to anyone holding it.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
          >
            {error}
          </p>
        )}

        <label className={label} htmlFor="inv-email">
          Email (optional — binds the invite to one address)
        </label>
        <input id="inv-email" name="email" type="email" className={field} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="inv-role">
              Role
            </label>
            <select id="inv-role" name="role" defaultValue="member" className={field}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="inv-team">
              Team (optional)
            </label>
            <select id="inv-team" name="teamId" className={field}>
              <option value="">—</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className={label} htmlFor="inv-days">
          Expires in days
        </label>
        <input
          id="inv-days"
          name="expiresInDays"
          type="number"
          min={1}
          max={90}
          defaultValue={7}
          className={field}
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full rounded-sm bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create invite"}
        </button>

        {joinUrl && (
          <div className="mt-4 rounded-sm border border-lining-faint bg-surface-2 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
              join url — shown once
            </p>
            <p className="mt-1 break-all font-mono text-xs text-ink">{joinUrl}</p>
            <button
              type="button"
              onClick={() => copy(joinUrl)}
              className="mt-2 rounded-sm border border-lining px-2 py-1 text-xs text-ink-muted hover:bg-surface-1"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        )}
      </form>

      <div className="rounded-md border border-lining bg-surface-1 p-5">
        <h2 className="text-sm font-semibold">Pending invites</h2>
        {invites.length === 0 ? (
          <p className="mt-3 text-sm text-ink-subtle">No open invites.</p>
        ) : (
          <ul className="mt-3 divide-y divide-lining-faint">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-ink">{i.email ?? "open link"}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                    {i.role} · {teamName(i.teamId)} · exp{" "}
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => setConfirmRevoke(i)}
                  className="rounded-sm px-2 py-1 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink"
                >
                  revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmRevoke && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
        >
          <div className="w-full max-w-sm rounded-md border border-lining bg-surface-1 p-5">
            <h2 className="text-sm font-semibold">Revoke invite</h2>
            <p className="mt-2 text-sm text-ink-subtle">
              Revoke the invite for {confirmRevoke.email ?? "the open link"}?
              The join URL stops working immediately.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRevoke(null)}
                className="rounded-sm px-3 py-1.5 text-sm text-ink-subtle hover:bg-surface-2"
              >
                cancel
              </button>
              <button
                onClick={() => revoke(confirmRevoke)}
                className="rounded-sm bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
