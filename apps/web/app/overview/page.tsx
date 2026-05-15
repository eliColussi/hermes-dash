"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function OverviewPage() {
  const o = useQuery({ queryKey: ["overview"], queryFn: api.overview });

  if (o.isLoading) return <div className="text-sm text-muted">Loading…</div>;
  if (o.isError || !o.data)
    return (
      <div className="text-sm text-red-600">
        Bridge unreachable. Is the FastAPI service running on :8787?
      </div>
    );

  const d = o.data;
  const cards = [
    { label: "Agents", value: d.total_agents },
    { label: "Healthy", value: d.healthy, accent: "text-green-600" },
    { label: "Down", value: d.down, accent: "text-red-600" },
    { label: "Sessions today", value: d.sessions_today },
    { label: "Tool calls today", value: d.tasks_today },
    { label: "Cost today", value: `$${d.cost_today_usd.toFixed(4)}` },
    { label: "Cost 30d", value: `$${d.cost_30d_usd.toFixed(2)}` },
    { label: "Skills installed", value: d.skills_installed },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Real-time signal from your HERMÉS runtime.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="text-xs text-muted">{c.label}</div>
            <div className={`text-2xl font-semibold mt-2 ${c.accent ?? ""}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
