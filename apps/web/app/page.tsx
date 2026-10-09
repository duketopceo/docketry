import { ISSUE_STATES } from "@docketry/types";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-8 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--accent)]">
        docketry
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-[var(--ink)]">
        The board agents can actually work.
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-subtle)]">
        Toolchain baseline is live. Issue lifecycle states registered:
      </p>
      <ul className="mt-6 divide-y divide-[var(--lining-faint,#1f232b)] border-y border-[var(--lining)]">
        {ISSUE_STATES.map((state) => (
          <li
            key={state}
            className="flex h-9 items-center font-mono text-xs text-[var(--ink-subtle)]"
          >
            {state}
          </li>
        ))}
      </ul>
    </main>
  );
}
