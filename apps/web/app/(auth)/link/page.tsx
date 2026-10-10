"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

// NEXT_PUBLIC_* inlines into the client bundle — the browser-reachable
// API origin (lib/api.ts is server-only and can't be imported here)
const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// pending-link challenge — the OAuth identity matched an existing account
// by email; prove control of that account (password when it has one, else
// the live session) to write the auth_identities row
export default function LinkPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center px-6" />}>
      <LinkInner />
    </Suspense>
  );
}

function LinkInner() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const provider = params.get("provider") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [linked, setLinked] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, password: fd.get("password") || undefined }),
    });
    setPending(false);
    const d = (await res.json().catch(() => null)) as
      | { error?: { message?: string }; providerKey?: string }
      | null;
    if (res.ok) {
      setLinked(true);
    } else {
      setError(d?.error?.message ?? "could not link this account");
    }
  }

  if (linked) {
    // account linked — send the user back through provider start so the
    // now-resolving identity completes the normal login path
    const start = `${PUBLIC_API_URL}/v1/auth/oauth/${provider}/start`;
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-md border border-lining bg-surface-1 p-6">
          <h1 className="text-lg font-semibold">Account linked</h1>
          <p className="mt-2 text-sm text-ink-subtle">
            Your sign-in provider is connected — continue to finish signing in.
          </p>
          <a
            href={start}
            className="mt-5 block w-full rounded-sm bg-accent px-3 py-2 text-center text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Continue
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-md border border-lining bg-surface-1 p-6"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-accent">
          docketry
        </p>
        <h1 className="mt-2 text-lg font-semibold">Link your account</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          An account already exists with this email — verify it's you to
          connect the sign-in provider.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
          >
            {error}
          </p>
        )}

        <label className="mt-5 block text-xs text-ink-subtle" htmlFor="password">
          Account password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          className="mt-1 w-full rounded-sm border border-lining bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-lining-strong"
        />
        <button
          type="submit"
          disabled={pending || !code}
          className="mt-5 w-full rounded-sm bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Verifying…" : "Link account"}
        </button>
        <button
          type="button"
          onClick={() => router.replace("/login")}
          className="mt-2 w-full text-center text-xs text-ink-subtle hover:text-ink"
        >
          back to sign in
        </button>
      </form>
    </main>
  );
}
