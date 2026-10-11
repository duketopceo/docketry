"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorLine, Panel, ScopeBadges, Time, UndoToast, errorMessage } from "./ui";

interface Grant {
  id: string;
  clientName: string;
  scopes: string[];
  userName: string;
  lastUsedAt: string | null;
  createdAt: string;
}

// OAuth grants for connected MCP clients (PR #98 routes). The section hides
// itself when the API has no such endpoint (404), so it is safe on older APIs.
export function ConnectedApps({ workspace }: { workspace: string }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Grant | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Grant | null>(null);
  pendingRef.current = pending;

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/oauth-grants");
    if (res.status === 404) {
      setSupported(false);
      return;
    }
    if (!res.ok) {
      setError(await errorMessage(res, "Could not load connected apps. Reload to try again."));
      setGrants([]);
      return;
    }
    setGrants(((await res.json()) as { grants: Grant[] }).grants);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const commit = useCallback(
    async (g: Grant) => {
      const res = await fetch(`/api/settings/oauth-grants/${g.id}`, { method: "DELETE" });
      setPending(null);
      if (!res.ok) setError(await errorMessage(res, "Could not revoke the app. Try again."));
      await load();
    },
    [load],
  );

  function revoke(g: Grant) {
    if (timer.current) clearTimeout(timer.current);
    setPending(g);
    timer.current = setTimeout(() => void commit(g), 8000);
  }
  function undo() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
  }
  useEffect(
    () => () => {
      if (timer.current && pendingRef.current) {
        clearTimeout(timer.current);
        void fetch(`/api/settings/oauth-grants/${pendingRef.current.id}`, {
          method: "DELETE",
          keepalive: true,
        });
      }
    },
    [],
  );

  if (!supported || grants === null) return null;
  const visible = grants.filter((g) => g.id !== pending?.id);
  return (
    <div className="px-4 pb-6">
      <Panel
        id="connected-apps"
        title="Connected apps"
        hint="MCP clients you or teammates signed in with OAuth. Revoking ends access immediately."
      >
        <ErrorLine message={error} />
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-ink-subtle">
            No apps connected. They appear here after a client such as Claude or Cursor
            signs in to this workspace over MCP.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Connected apps</caption>
              <thead>
                <tr className="border-b border-lining-faint text-left font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
                  <th className="pb-2 pr-3 font-normal">App</th>
                  <th className="pb-2 pr-3 font-normal">Scopes</th>
                  <th className="pb-2 pr-3 font-normal">Workspace</th>
                  <th className="pb-2 pr-3 font-normal">Connected</th>
                  <th className="pb-2 pr-3 font-normal">Last used</th>
                  <th className="pb-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((g) => (
                  <tr key={g.id} className="border-b border-lining-faint">
                    <td className="py-2 pr-3 text-ink">
                      {g.clientName}
                      <span className="block text-[11px] text-ink-tertiary">by {g.userName}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <ScopeBadges scopes={g.scopes} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-muted">{workspace}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      <Time value={g.createdAt} />
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      <Time value={g.lastUsedAt} />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => revoke(g)}
                        aria-label={`Revoke ${g.clientName}`}
                        className="rounded-sm px-2 py-1 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {pending && (
        <UndoToast message={`Revoked ${pending.clientName}.`} onUndo={undo} />
      )}
    </div>
  );
}
