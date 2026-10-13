import {
  NotificationsClient,
  type InboxRow,
} from "@/components/notifications-client";
import { EmptyState } from "@/components/primitives";
import { api } from "@/lib/api";

interface Me {
  workspaceSlug: string;
}

export default async function NotificationsPage() {
  const me = await api<Me>("/v1/auth/me");
  if (!me.data) {
    return <main className="p-8 text-sm text-ink-subtle">Not signed in.</main>;
  }
  const res = await api<{ notifications?: InboxRow[] }>(
    `/v1/workspaces/${me.data.workspaceSlug}/notifications`,
  );
  const rows = res.data?.notifications ?? [];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
          {rows.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <EmptyState
          title="All clear"
          detail="Mentions, assignments, review-pending items, and dispatch failures land here."
        />
      ) : (
        <NotificationsClient rows={rows} />
      )}
    </main>
  );
}
