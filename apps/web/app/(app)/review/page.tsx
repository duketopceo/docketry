import { ReviewQueue } from "@/components/review-queue";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

interface QueueRow {
  id: string;
  key: string;
  title: string;
  priority: string;
  dispatchStatus: string;
  agentName: string;
  sessionAt: string;
}

export default async function ReviewPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<{ queue: QueueRow[] }>(
    `/v1/workspaces/${me.data.workspaceSlug}/review-queue`,
  );
  const queue = res.data?.queue ?? [];

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="flex h-12 items-center gap-3 border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Review</h1>
        <span className="font-mono text-[11px] text-ink-tertiary">
          {queue.length} pending · j/k move · a approve · x send back
        </span>
      </header>
      <ReviewQueue queue={queue} />
    </main>
  );
}
