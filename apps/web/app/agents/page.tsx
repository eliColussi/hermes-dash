"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AgentCard } from "@/components/agent-card";
import { AddAgentTile } from "@/components/add-agent";

export default function AgentsPage() {
  const q = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  const agents = q.data ?? [];
  const healthy = agents.filter((a) => a.status === "healthy").length;
  const stale = agents.filter((a) => a.status === "stale").length;
  const down = agents.filter((a) => a.status === "down").length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <select className="px-3 py-1.5 text-sm rounded-lg border border-line bg-[var(--surface)]">
          <option>all</option>
          <option>staffroom</option>
        </select>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">Agents</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        All organizations · {agents.length} agents
      </p>

      <div className="flex items-center gap-6 text-sm mb-6">
        <span className="flex items-center gap-2">
          <span className="dot healthy" /> {healthy} healthy
        </span>
        <span className="flex items-center gap-2">
          <span className="dot stale" /> {stale} stale
        </span>
        <span className="flex items-center gap-2">
          <span className="dot down" /> {down} down
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} onChange={() => q.refetch()} />
        ))}
        <AddAgentTile onCreated={() => q.refetch()} />
      </div>

      {q.isLoading && <div className="text-sm text-muted mt-6">Loading…</div>}
      {q.isError && (
        <div className="text-sm text-red-600 mt-6">
          Bridge unreachable. Is the FastAPI service running on :8787?
        </div>
      )}
    </div>
  );
}
