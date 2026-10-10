"use client";

import dynamic from "next/dynamic";
import type {
  RoadmapCycle,
  RoadmapIssue,
  RoadmapMilestone,
  RoadmapProject,
  RoadmapTeam,
} from "./roadmap-client";

// ssr:false keeps the roadmap's client code out of the initial bundle (R10)
const RoadmapClient = dynamic(
  () => import("./roadmap-client").then((m) => m.RoadmapClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 animate-pulse items-center justify-center font-mono text-[11px] text-ink-tertiary">
        loading roadmap…
      </div>
    ),
  },
);

export function RoadmapLoader(props: {
  projects: RoadmapProject[];
  cycles: RoadmapCycle[];
  milestones: RoadmapMilestone[];
  issues: RoadmapIssue[];
  teams: RoadmapTeam[];
}) {
  return <RoadmapClient {...props} />;
}
