"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface Insights {
  cycleTime: {
    avgDays: number;
    p50Days: number;
    p90Days: number;
    completed: number;
    weekly: { week: string; avgDays: number; count: number }[];
  };
  burnup: { week: string; total: number; done: number }[];
  velocity: {
    team: string;
    cycle: string;
    done: number;
    issueCount: number;
    estimateDone: number;
    estimateTotal: number;
  }[];
  throughput: { week: string; human: number; agent: number; system: number }[];
}

const AXIS = { fontSize: 10, fontFamily: "monospace", fill: "#6b7280" };
const TIP = {
  contentStyle: {
    background: "#16181d",
    border: "1px solid #2a2f3a",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "monospace",
  },
  labelStyle: { color: "#9ca3af" },
} as const;

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col border-b border-lining-faint p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold">{title}</h2>
        {hint && (
          <span className="font-mono text-[10px] text-ink-tertiary">{hint}</span>
        )}
      </div>
      <div className="min-h-36 flex-1">{children}</div>
    </section>
  );
}

export function InsightsClient({ insights }: { insights: Insights }) {
  const { cycleTime, burnup, velocity, throughput } = insights;
  const empty =
    cycleTime.completed === 0 && burnup.length === 0 && velocity.length === 0;

  if (empty) {
    return (
      <p className="px-8 py-12 text-center text-sm text-ink-subtle">
        No activity yet — insights populate as issues move through the board.
      </p>
    );
  }

  return (
    <div className="grid flex-1 grid-cols-1 gap-px overflow-y-auto lg:grid-cols-2">
      <Panel
        title="Cycle time"
        hint={`${cycleTime.completed} done · avg ${cycleTime.avgDays.toFixed(1)}d · p50 ${cycleTime.p50Days.toFixed(1)}d · p90 ${cycleTime.p90Days.toFixed(1)}d`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={cycleTime.weekly} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1f232b" vertical={false} />
            <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="d" />
            <Tooltip {...TIP} />
            <Bar dataKey="avgDays" name="avg days" fill="#7c8cf8" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Burnup" hint="weekly cumulative · total vs done">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={burnup} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1f232b" vertical={false} />
            <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TIP} />
            <Line type="monotone" dataKey="total" stroke="#39404c" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="done" stroke="#3fb68f" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Throughput" hint="issues done per week, by actor">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={throughput} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1f232b" vertical={false} />
            <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TIP} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
            <Bar dataKey="human" stackId="a" fill="#7c8cf8" />
            <Bar dataKey="agent" stackId="a" fill="#b07cf8" />
            <Bar dataKey="system" stackId="a" fill="#39404c" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="Velocity"
        hint={velocity.length ? `${velocity.length} completed cycles` : "no completed cycles yet"}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={velocity} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1f232b" vertical={false} />
            <XAxis dataKey="cycle" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TIP} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
            <Bar dataKey="done" name="issues done" fill="#3fb68f" radius={[2, 2, 0, 0]} />
            <Bar dataKey="estimateDone" name="estimate done" fill="#39404c" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
