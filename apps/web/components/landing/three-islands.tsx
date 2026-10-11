"use client";

import { ParticleDrift } from "@designcodeio/threeui/components/ParticleDrift";
import { DiagnosticsPanel } from "@designcodeio/threeui/components/DiagnosticsPanel";

export function HeroField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <ParticleDrift mode="dark" opacity={0.35} className="h-full w-full" />
    </div>
  );
}

export function AgentPanel() {
  return (
    <div aria-hidden className="h-full w-full">
      <DiagnosticsPanel
        variant="flow"
        mode="dark"
        opacity={0.9}
        hue={50}
        className="h-full w-full"
      />
    </div>
  );
}
