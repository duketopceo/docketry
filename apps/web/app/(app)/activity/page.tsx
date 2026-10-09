import { ActivityFeed, type FeedEvent } from "@/components/activity-feed";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function ActivityPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  // Initial render is a plain fetch — the client upgrades to the SSE stream
  // (and falls back to polling this same endpoint if the stream dies).
  const res = await api<{ events?: FeedEvent[] }>(
    `/v1/workspaces/${me.data.workspaceSlug}/events?limit=100`,
  );
  const events = res.data?.events ?? [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Activity</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {events.length}
        </span>
      </header>
      <ActivityFeed initial={events} />
    </main>
  );
}
