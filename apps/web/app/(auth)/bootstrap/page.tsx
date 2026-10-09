"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BootstrapPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: fd.get("workspaceSlug"),
        workspaceName: fd.get("workspaceName"),
        teamKey: fd.get("teamKey") || "DOK",
        email: fd.get("email"),
        name: fd.get("name"),
        password: fd.get("password"),
      }),
    });
    setPending(false);
    if (res.ok) {
      router.replace("/my-issues");
      router.refresh();
    } else {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "bootstrap failed — check the fields");
    }
  }

  const field =
    "mt-1 w-full rounded-sm border border-lining bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-lining-strong";
  const label = "mt-4 block text-xs text-ink-subtle";

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-md border border-lining bg-surface-1 p-6"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-accent">
          docketry
        </p>
        <h1 className="mt-2 text-lg font-semibold">First-run setup</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Create the workspace, its first team, and the owner account. This
          screen locks after the first run.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
          >
            {error}
          </p>
        )}

        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="workspaceName">
              Workspace name
            </label>
            <input id="workspaceName" name="workspaceName" required className={field} />
          </div>
          <div>
            <label className={label} htmlFor="workspaceSlug">
              Slug
            </label>
            <input
              id="workspaceSlug"
              name="workspaceSlug"
              required
              pattern="[a-z0-9-]+"
              className={field}
            />
          </div>
        </div>

        <label className={label} htmlFor="teamKey">
          Team key (issue prefix, e.g. DOK)
        </label>
        <input
          id="teamKey"
          name="teamKey"
          pattern="[A-Z][A-Z0-9]*"
          maxLength={6}
          placeholder="DOK"
          className={field}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="name">
              Your name
            </label>
            <input id="name" name="name" required className={field} />
          </div>
          <div>
            <label className={label} htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" required className={field} />
          </div>
        </div>

        <label className={label} htmlFor="password">
          Password (10+ chars)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          className={field}
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-sm bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </main>
  );
}
