"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  UndoToast,
  ErrorLine,
  Notice,
  Panel,
  errorMessage,
  Time,
  ghostBtn,
  primaryBtn,
} from "./ui";

interface Installation {
  installationId: number;
  accountLogin: string;
  createdAt: string;
}
interface Overview {
  configured: { app: boolean; slug: boolean };
  installations: Installation[];
}

export type GithubNotice =
  | { kind: "connected" }
  | { kind: "requested" }
  | { kind: "error"; code: number }
  | null;

// Copy for each way the install callback can fail — the API's 404/409 are the
// PLAN-006 negative cases, 503 is an unconfigured operator install.
export function callbackErrorCopy(code: number): { title: string; body: string } {
  switch (code) {
    case 404:
      return {
        title: "That installation does not belong to this GitHub App",
        body: "GitHub reported an installation this Tallyline instance's App does not own, so nothing was linked. Use Connect GitHub below to install the App from here, rather than a link from another deployment.",
      };
    case 409:
      return {
        title: "That GitHub installation is linked to another workspace",
        body: "An installation can belong to one workspace. Unlink it from the other workspace (Settings, Integrations, Unlink there), then connect again.",
      };
    case 503:
      return {
        title: "The GitHub App is not configured on this API",
        body: "The server cannot verify installations until the App credentials are set. Follow the operator steps below, then try again.",
      };
    case 502:
      return {
        title: "GitHub could not verify the installation",
        body: "The request to GitHub failed. Wait a moment and use Connect GitHub to try again.",
      };
    case 400:
      return {
        title: "GitHub did not send an installation",
        body: "The return link was missing the installation id. Start again with Connect GitHub.",
      };
    default:
      return {
        title: "Could not link the installation",
        body: `Unexpected response (${code}). Try Connect GitHub again; if it keeps failing, check the API logs.`,
      };
  }
}

export function GithubConnect({
  canAdmin,
  notice,
}: {
  canAdmin: boolean;
  notice: GithubNotice;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // unlink is reversible (the install can be linked again): hide now, commit
  // after 8s unless Undo is pressed
  const [unlinking, setUnlinking] = useState<Installation | null>(null);
  const unlinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/github/installations");
    if (!res.ok) {
      setError(await errorMessage(res, "could not load GitHub status"));
      setOverview({ configured: { app: true, slug: true }, installations: [] });
      return;
    }
    const data = (await res.json()) as Overview;
    setOverview(data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setError(null);
    const res = await fetch("/api/settings/github/install-url");
    if (res.status === 503) {
      setConnecting(false);
      setNotConfigured(true);
      return;
    }
    if (!res.ok) {
      setConnecting(false);
      setError(await errorMessage(res, "could not start the GitHub install"));
      return;
    }
    const { installUrl } = (await res.json()) as { installUrl: string };
    window.location.assign(installUrl);
  }

  const commitUnlink = useCallback(
    async (i: Installation) => {
      const res = await fetch(`/api/settings/github/installations/${i.installationId}`, {
        method: "DELETE",
      });
      setUnlinking(null);
      if (!res.ok) setError(await errorMessage(res, "Could not unlink the installation. Try again."));
      await load();
      router.refresh(); // repo catalog is server-rendered
    },
    [load, router],
  );

  function unlink(i: Installation) {
    if (unlinkTimer.current) clearTimeout(unlinkTimer.current);
    setUnlinking(i);
    unlinkTimer.current = setTimeout(() => void commitUnlink(i), 8000);
  }

  function undoUnlink() {
    if (unlinkTimer.current) clearTimeout(unlinkTimer.current);
    unlinkTimer.current = null;
    setUnlinking(null);
  }

  // leaving the page commits what the operator asked for
  const pendingRef = useRef<Installation | null>(null);
  pendingRef.current = unlinking;
  useEffect(
    () => () => {
      if (unlinkTimer.current && pendingRef.current) {
        clearTimeout(unlinkTimer.current);
        void fetch(`/api/settings/github/installations/${pendingRef.current.installationId}`, {
          method: "DELETE",
          keepalive: true,
        });
      }
    },
    [],
  );

  const visibleInstalls = (overview?.installations ?? []).filter(
    (i) => i.installationId !== unlinking?.installationId,
  );
  const unconfigured =
    notConfigured ||
    (overview !== null && (!overview.configured.app || !overview.configured.slug));

  return (
    <div className="space-y-4 px-4 pt-4">
      {notice?.kind === "connected" && (
        <Notice tone="healthy" title="GitHub installation linked">
          Repositories from the installation appear below. Enable the ones whose
          issues and pull requests should sync.
        </Notice>
      )}
      {notice?.kind === "requested" && (
        <Notice tone="attention" title="Install request sent">
          A GitHub organization owner has to approve the request. Once they do, come
          back here and press Connect GitHub again to finish linking.
        </Notice>
      )}
      {notice?.kind === "error" && (
        <Notice tone="error" title={callbackErrorCopy(notice.code).title}>
          {callbackErrorCopy(notice.code).body}
        </Notice>
      )}
      <ErrorLine message={error} />

      {overview === null && (
        <p role="status" className="text-sm text-ink-subtle">
          Loading GitHub status…
        </p>
      )}

      {overview && unconfigured && <OperatorSteps canAdmin={canAdmin} />}

      {overview && !unconfigured && (
        <Panel
          id="gh-connect"
          title="GitHub"
          hint="Link a GitHub App installation so issues, pull requests and branches stay in step with Tallyline."
        >
          {visibleInstalls.length === 0 ? (
            <p className="mt-3 text-sm text-ink-subtle">
              No GitHub account is linked to this workspace.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-lining-faint" aria-label="Linked installations">
              {visibleInstalls.map((i) => (
                <li
                  key={i.installationId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{i.accountLogin}</span>
                    <span className="mt-0.5 block break-words font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
                      installation {i.installationId} · linked <Time value={i.createdAt} />
                    </span>
                  </div>
                  {canAdmin && (
                    <button
                      type="button"
      onClick={() => unlink(i)}
                      aria-label={`Unlink ${i.accountLogin}`}
                      className={ghostBtn}
                    >
                      Unlink
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canAdmin ? (
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              className={`${primaryBtn} mt-4`}
            >
              {connecting
                ? "Opening GitHub…"
                : visibleInstalls.length === 0
                  ? "Connect GitHub"
                  : "Connect another account"}
            </button>
          ) : (
            <p className="mt-4 text-sm text-ink-subtle">
              Connecting GitHub requires an admin.
            </p>
          )}
        </Panel>
      )}

      {unlinking && (
        <UndoToast
          message={`Unlinked ${unlinking.accountLogin}. Its repositories stop syncing.`}
          onUndo={undoUnlink}
        />
      )}
    </div>
  );
}

// Shown when the API has no GitHub App credentials (and for install-url 503).
// The operator creates the App once per deployment from a manifest.
function OperatorSteps({ canAdmin }: { canAdmin: boolean }) {
  const [manifest, setManifest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setError(null);
    const res = await fetch("/api/settings/github/manifest");
    if (!res.ok) {
      setError(await errorMessage(res, "could not build the App manifest"));
      return;
    }
    setManifest(JSON.stringify(await res.json()));
  }

  return (
    <Panel
      id="gh-setup"
      title="GitHub App not configured"
      hint="This server has no GitHub App yet, so it cannot link installations. Someone with access to the API environment does this once."
    >
      <div className="mt-3 rounded-sm border border-l-4 border-lining-bright border-l-attention bg-surface-2 px-3 py-2 text-[13px] text-ink">
        Recommended action: create the App with the steps below.
      </div>
      <ErrorLine message={error} />
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-ink-muted">
        <li>
          Create the App on GitHub from a prepared manifest.
          {canAdmin ? (
            manifest === null ? (
              <div className="mt-2">
                <button type="button" onClick={prepare} className={primaryBtn}>
                  Prepare GitHub App
                </button>
              </div>
            ) : (
              <form
                method="post"
                action="https://github.com/settings/apps/new"
                className="mt-2"
              >
                <input type="hidden" name="manifest" value={manifest} />
                <button type="submit" className={primaryBtn}>
                  Create GitHub App on github.com
                </button>
              </form>
            )
          ) : (
            <span className="block text-ink-subtle">Requires a workspace admin.</span>
          )}
        </li>
        <li>
          GitHub returns to a page that shows the App credentials{" "}
          <strong className="font-medium text-ink">once</strong>. Tallyline stores
          none of them. Copy them into the API environment:{" "}
          <code className="font-mono text-xs text-ink">GITHUB_APP_ID</code>,{" "}
          <code className="font-mono text-xs text-ink">GITHUB_APP_SLUG</code>,{" "}
          <code className="font-mono text-xs text-ink">GITHUB_WEBHOOK_SECRET</code>,{" "}
          <code className="font-mono text-xs text-ink">GITHUB_APP_PRIVATE_KEY</code>.
        </li>
        <li>
          In the App’s settings on GitHub, set the Setup URL to{" "}
          <code className="break-all font-mono text-xs text-ink">
            https://&lt;this-host&gt;/integrations/github/callback
          </code>{" "}
          and tick Redirect on update.
        </li>
        <li>Restart the API, then reload this page. Connect GitHub appears here.</li>
      </ol>
    </Panel>
  );
}
