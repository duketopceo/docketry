import Link from "next/link";

const NAV = [
  { href: "/my-issues", label: "My Issues", hint: "g i" },
  { href: "/board", label: "Board", hint: "g b" },
  { href: "/triage", label: "Triage", hint: "g t" },
  { href: "/review", label: "Review", hint: "g r" },
  { href: "/cycle", label: "Cycle", hint: "g c" },
  { href: "/issues", label: "All Issues", hint: "g a" },
  { href: "/insights", label: "Insights", hint: "g s" },
  { href: "/activity", label: "Activity", hint: "g e" },
];

export function Sidebar({ workspace }: { workspace: string }) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-lining bg-surface-1">
      <div className="flex h-12 items-center gap-2 border-b border-lining-faint px-4">
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="7" width="24" height="19" rx="3" fill="#10141b" stroke="#4b5360" strokeWidth="1.5" />
          <path d="M8.5 7h15" stroke="#c9cdd4" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M26 0.5L27.5 4.5L31.5 6L27.5 7.5L26 11.5L24.5 7.5L20.5 6L24.5 4.5Z" fill="#3ea1f7" />
        </svg>
        <span className="text-sm font-semibold tracking-tight">docketry</span>
        <span className="ml-auto font-mono text-[10px] text-ink-tertiary">
          {workspace}
        </span>
      </div>
      <nav className="flex-1 px-2 py-3">
        <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
          Workspace
        </p>
        <ul>
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-8 items-center justify-between rounded-sm px-2 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                {item.label}
                <kbd className="font-mono text-[10px] text-ink-tertiary">
                  {item.hint}
                </kbd>
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
