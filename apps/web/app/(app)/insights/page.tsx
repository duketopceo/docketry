import { InsightsClient, type Insights } from "@/components/insights-charts";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function InsightsPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<Insights>(
    `/v1/workspaces/${me.data.workspaceSlug}/insights`,
  );
  const ins = res.data;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Insights</h1>
        {ins && (
          <span className="ml-3 font-mono text-[11px] text-ink-tertiary">
            from the event log — auditable, never reconstructed
          </span>
        )}
      </header>
      {!ins ? (
        <p className="px-8 py-12 text-center text-sm text-ink-subtle">
          Failed to load insights.
        </p>
      ) : (
        <InsightsClient insights={ins} />
      )}
    </main>
  );
}
