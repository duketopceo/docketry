import Link from "next/link";
import { TallyMark } from "./tally-mark";

const NAV = [
  { href: "/my-issues", label: "My Issues", hint: "g i" },
  { href: "/notifications", label: "Inbox", hint: "g n" },
  { href: "/board", label: "Board", hint: "g b" },
  { href: "/triage", label: "Triage", hint: "g t" },
  { href: "/review", label: "Review", hint: "g r" },
  { href: "/cycle", label: "Cycle", hint: "g c" },
  { href: "/issues", label: "All Issues", hint: "g a" },
  { href: "/insights", label: "Insights", hint: "g s" },
  { href: "/roadmap", label: "Roadmap", hint: "g p" },
  { href: "/activity", label: "Activity", hint: "g e" },
];

export function Sidebar({
  workspace,
  role,
  unread = 0,
}: {
  workspace: string;
  role: string | undefined;
  unread?: number;
}) {
  const items =
    role === "owner" || role === "admin"
      ? [...NAV, { href: "/settings/members", label: "Settings", hint: "g ," }]
      : NAV;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-lining bg-surface-1">
      <div className="flex h-12 items-center gap-2 border-b border-lining-faint px-4">
        <TallyMark size={16} />
        <span className="text-sm font-semibold tracking-tight">tallyline</span>
        <span className="ml-auto font-mono text-[10px] text-ink-tertiary">
          {workspace}
        </span>
      </div>
      <nav className="flex-1 px-2 py-3">
        <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
          Workspace
        </p>
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-8 items-center justify-between rounded-sm px-2 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                {item.label}
                <span className="ml-auto flex items-center gap-1.5">
                  {item.href === "/notifications" && unread > 0 && (
                    <span
                      aria-label={`${unread} unread notifications`}
                      className="min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[11px] leading-4 text-on-accent"
                    >
                      {unread}
                    </span>
                  )}
                  <kbd className="font-mono text-[10px] text-ink-tertiary">
                    {item.hint}
                  </kbd>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form action="/api/logout" method="post" className="border-t border-lining-faint p-2">
        <button
          type="submit"
          className="h-8 w-full rounded-sm px-2 text-left text-[13px] text-ink-subtle hover:bg-surface-2 hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </aside>
  );
}
