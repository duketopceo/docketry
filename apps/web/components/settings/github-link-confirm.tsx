"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, Panel, primaryBtn } from "./ui";

export function GithubLinkConfirm({
  installationId,
  workspace,
  canAdmin,
}: {
  installationId: number;
  workspace: string;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function link() {
    setBusy(true);
    const res = await fetch("/api/settings/github/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId }),
    });
    router.replace(
      res.ok
        ? "/settings/integrations?github=connected"
        : `/settings/integrations?github=error&code=${res.status}`,
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl p-4">
      <Panel
        id="link-confirm"
        title={`Link installation ${installationId}?`}
        hint="GitHub sent you back after installing the App."
      >
        {canAdmin ? (
          <>
            <p className="mt-3 text-sm text-ink-muted">
              This links the GitHub installation to the{" "}
              <span className="font-mono text-ink">{workspace}</span> workspace so its
              repositories can sync. Nothing is linked until you confirm.
            </p>
            <button type="button" onClick={link} disabled={busy} className={`${primaryBtn} mt-4`}>
              {busy ? "Linking…" : "Link installation"}
            </button>
          </>
        ) : (
          <div className="mt-3">
            <Notice tone="attention" title="An admin has to link this">
              Only workspace owners and admins can link a GitHub installation. Ask one
              to open this page again from GitHub, or to use Connect GitHub in Settings.
            </Notice>
          </div>
        )}
      </Panel>
    </div>
  );
}
