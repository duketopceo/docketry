"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "./primitives";
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
    loading: () => <LoadingState label="loading roadmap…" />,
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
