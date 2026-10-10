"use client";

import dynamic from "next/dynamic";
import type { Insights } from "./insights-charts";

// ssr:false keeps recharts (~108 kb gz) out of the initial bundle (R10);
// the charts mount client-side under a skeleton
const InsightsClient = dynamic(
  () => import("./insights-charts").then((m) => m.InsightsClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 animate-pulse p-6 font-mono text-[11px] text-ink-tertiary">
        loading charts…
      </div>
    ),
  },
);

export function InsightsLoader({ insights }: { insights: Insights }) {
  return <InsightsClient insights={insights} />;
}
