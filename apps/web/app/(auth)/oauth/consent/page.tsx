import { api } from "@/lib/api";
import { ConsentForm, type ConsentView } from "./consent-form";

// MCP connector consent (PLAN-011). The API validated the client, redirect
// URI, PKCE and resource at /oauth/authorize; this page only shows the
// request and posts the decision. Middleware sends signed-out users through
// /login and back here.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  const view = request
    ? await api<ConsentView>(`/v1/oauth/consent/${encodeURIComponent(request)}`)
    : null;
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-md border border-lining bg-surface-1 p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">tallyline</p>
        {view?.data ? (
          <ConsentForm view={view.data} />
        ) : (
          <>
            <h1 className="mt-2 text-[17px] font-semibold">This request is no longer valid</h1>
            <p className="mt-2 text-sm text-ink-subtle">
              The authorization request expired or was already used. Go back to the
              app that sent you here and connect again.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
