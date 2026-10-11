const RECENT_KEY = "tl:recent";

export function recordRecent(key: string) {
  try {
    const cur = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...cur.filter((k) => k !== key)].slice(0, 6)));
  } catch { /* storage unavailable */ }
}

export function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; }
}
