"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { TallyMark } from "@/components/tally-mark";

interface Provider {
  key: string;
  type: string;
  label: string;
  startUrl: string;
}

const ERROR_COPY: Record<string, string> = {
  state: "sign-in session expired — try again",
  denied: "sign-in was cancelled at the provider",
  exchange: "sign-in code expired — try again",
  invite_required: "this workspace requires an invite",
  link_disabled: "account linking is disabled on this instance",
  no_workspace: "your account has no workspace — ask an admin for an invite",
  auth: "sign-in failed — try again",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center px-6" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [methods, setMethods] = useState<{
    password: boolean;
    providers: Provider[];
    unavailable: boolean;
  } | null>(null);

  const returnTo = params.get("return_to") ?? params.get("next") ?? "/my-issues";

  useEffect(() => {
    const code = params.get("error");
    if (code) setError(ERROR_COPY[code] ?? ERROR_COPY.auth!);
    fetch("/api/auth/methods")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // on failure render the password form optimistically — the wrong
        // default is a login card with no way in
        if (!d) {
          setMethods({ password: true, providers: [], unavailable: true });
        } else {
          setMethods({ password: d.password !== false, providers: d.providers ?? [], unavailable: false });
        }
      })
      .catch(() => setMethods({ password: true, providers: [], unavailable: true }));
  }, [params]);

  function providerUrl(p: Provider) {
    const u = new URL(p.startUrl);
    if (returnTo) u.searchParams.set("return_to", returnTo);
    return u.toString();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: fd.get("email"),
        password: fd.get("password"),
        return_to: returnTo,
      }),
    });
    setPending(false);
    if (res.ok) {
      const d = (await res.json()) as { returnTo?: string };
      router.replace(d.returnTo ?? "/my-issues");
      router.refresh();
    } else {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "sign-in failed — check credentials");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-lining bg-surface-1 p-6">
        <div className="flex items-center gap-2">
          <TallyMark size={24} />
          <span className="text-[15px] font-semibold tracking-tight">tallyline</span>
        </div>
        <h1 className="mt-2 text-lg font-semibold">Sign in</h1>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-sm border border-lining-bright px-3 py-2 text-sm text-ink-muted"
          >
            {error}
          </p>
        )}

        {methods && methods.providers.length > 0 && (
          <div className="mt-5 space-y-2">
            {methods.providers.map((p) => (
              <a
                key={p.key}
                href={providerUrl(p)}
                className="block w-full rounded-sm border border-lining bg-surface-2 px-3 py-2 text-center text-sm text-ink hover:border-lining-strong"
              >
                Continue with {p.label}
              </a>
            ))}
          </div>
        )}

        {methods?.unavailable && (
          <p className="mt-4 text-xs text-ink-subtle">
            sign-in providers unavailable — use email and password
          </p>
        )}

        {(!methods || methods.password) && (
          <form onSubmit={onSubmit}>
            <label
              className="mt-5 block text-xs text-ink-subtle"
              htmlFor="email"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              className="mt-1 w-full rounded-sm border border-control bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-lining-strong"
            />

            <label
              className="mt-4 block text-xs text-ink-subtle"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-sm border border-control bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-lining-strong"
            />

            <button
              type="submit"
              disabled={pending}
              className="mt-6 w-full rounded-sm bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
