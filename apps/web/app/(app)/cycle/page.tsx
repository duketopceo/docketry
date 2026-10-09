export default function CyclePage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <header className="flex h-12 items-center border-b border-lining-faint px-4">
        <h1 className="text-sm font-semibold">Cycle</h1>
      </header>
      <div className="flex flex-col items-center px-8 py-12 text-center">
        <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="7" width="24" height="19" rx="3" fill="none" stroke="#39404c" strokeWidth="1.5" />
          <path d="M8.5 7h15" stroke="#c9cdd4" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="8.5" y="11.5" width="10" height="2.6" rx="1.3" fill="#39404c" />
          <rect x="8.5" y="15.8" width="7" height="2.6" rx="1.3" fill="#4c5362" />
        </svg>
        <p className="mt-4 text-sm font-medium text-ink">No active cycle</p>
        <p className="mt-1 max-w-sm text-[13px] text-ink-subtle">
          Cycles land in v0.3 (issue #21) — time-boxed iterations with
          automatic rollover at the boundary.
        </p>
      </div>
    </main>
  );
}
