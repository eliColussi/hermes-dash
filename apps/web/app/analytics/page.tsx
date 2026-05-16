"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { analytics } from "@/lib/api";

const WINDOWS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["analytics", days],
    queryFn: () => analytics.fetch(days),
    refetchInterval: 30_000,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted mt-1">
            What your agents did this week, and what it cost.
          </p>
        </div>
        <div className="flex p-1 bg-[var(--bg)] border border-line rounded-lg text-sm">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`px-3 py-1.5 rounded-md ${
                days === w.days
                  ? "bg-white dark:bg-[var(--surface)] shadow-sm"
                  : "text-muted"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {q.data?.state_db === "not_found" && (
        <div className="card p-4 mb-4 text-sm text-muted">
          Once your agents start running, their usage shows up here.
        </div>
      )}

      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="Cost (today)" value={fmtUsd(q.data?.totals.today.cost)} />
        <Card label={`Cost (${days}d)`} value={fmtUsd(q.data?.totals.window.cost)} />
        <Card label={`Sessions (${days}d)`} value={q.data?.totals.window.sessions ?? 0} />
        <Card label={`Tool calls (${days}d)`} value={q.data?.totals.window.tool_calls ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={`Spend by day (last ${days}d)`}>
          <ByDay data={q.data?.by_day ?? []} />
        </Section>
        <Section title="By model">
          <ByModel data={q.data?.by_model ?? []} />
        </Section>
        <Section title="By source">
          <ByList data={q.data?.by_source.map((s) => ({ key: s.source, sessions: s.sessions, cost: s.cost })) ?? []} />
        </Section>
        <Section title="By agent">
          <ByList data={q.data?.by_agent.map((a) => ({ key: a.agent_id, sessions: a.sessions, cost: null })) ?? []} />
        </Section>
      </div>
    </div>
  );
}

function fmtUsd(v: number | undefined): string {
  if (v == null) return "—";
  return v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function ByDay({ data }: { data: { day: string; cost: number; sessions: number }[] }) {
  if (data.length === 0) return <Empty>No data yet.</Empty>;
  const max = Math.max(...data.map((d) => d.cost), 0.0001);
  return (
    <div className="space-y-1.5">
      {data.slice().reverse().map((d) => (
        <div key={d.day} className="flex items-center gap-2 text-xs">
          <div className="w-20 text-muted shrink-0">{d.day.slice(5)}</div>
          <div className="flex-1 h-4 bg-[var(--bg)] rounded overflow-hidden">
            <div
              className="h-full bg-blue-500/70"
              style={{ width: `${(d.cost / max) * 100}%` }}
            />
          </div>
          <div className="w-16 text-right shrink-0 font-mono">{fmtUsd(d.cost)}</div>
          <div className="w-10 text-right shrink-0 text-muted">{d.sessions}</div>
        </div>
      ))}
    </div>
  );
}

function ByModel({ data }: { data: { model: string; cost: number; sessions: number; tokens: number }[] }) {
  if (data.length === 0) return <Empty>No data yet.</Empty>;
  const max = Math.max(...data.map((d) => d.cost), 0.0001);
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.model} className="flex items-center gap-2 text-xs">
          <div className="w-40 truncate text-muted shrink-0" title={d.model}>{d.model}</div>
          <div className="flex-1 h-4 bg-[var(--bg)] rounded overflow-hidden">
            <div
              className="h-full bg-purple-500/70"
              style={{ width: `${(d.cost / max) * 100}%` }}
            />
          </div>
          <div className="w-16 text-right shrink-0 font-mono">{fmtUsd(d.cost)}</div>
        </div>
      ))}
    </div>
  );
}

function ByList({ data }: { data: { key: string; sessions: number; cost: number | null }[] }) {
  if (data.length === 0) return <Empty>No data yet.</Empty>;
  return (
    <ul className="text-sm divide-y divide-line">
      {data.map((d) => (
        <li key={d.key} className="py-2 flex justify-between">
          <span className="font-mono">{d.key}</span>
          <span className="text-muted">
            {d.sessions} sessions
            {d.cost != null && <> · {fmtUsd(d.cost)}</>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted py-3">{children}</div>;
}
