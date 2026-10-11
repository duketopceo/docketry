// Fire-and-forget work (GitHub mirrors) that must not block the request but
// that tests need to await deterministically instead of sleeping.

const pending = new Set<Promise<unknown>>();

export function track<T>(work: Promise<T>): void {
  const p = work.then(
    () => undefined,
    (err) => console.error("background task failed", err),
  );
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** resolves once every tracked task (including ones queued meanwhile) settled */
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
