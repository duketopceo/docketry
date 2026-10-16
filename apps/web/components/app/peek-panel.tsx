"use client";

import dynamic from "next/dynamic";
import { usePeek } from "./providers";

export type { IssueDetail } from "./peek-body";

// the panel (fetching, editors, session card) loads the first time it opens
const PeekBody = dynamic(() => import("./peek-body").then((m) => m.PeekBody), { ssr: false });

export function PeekPanel() {
  const peek = usePeek();
  if (!peek.key) return null;
  return <PeekBody key={peek.key} issueKey={peek.key} />;
}
