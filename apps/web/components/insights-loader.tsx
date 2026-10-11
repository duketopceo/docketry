"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "./primitives";
import type { Insights } from "./insights-charts";

// ssr:false keeps recharts (~108 kb gz) out of the initial bundle (R10);
// the charts mount client-side under a skeleton
const InsightsClient = dynamic(
  () => import("./insights-charts").then((m) => m.InsightsClient),
  {
    ssr: false,
    loading: () => <LoadingState label="loading charts…" />,
  },
);

export function InsightsLoader({ insights }: { insights: Insights }) {
  return <InsightsClient insights={insights} />;
}
