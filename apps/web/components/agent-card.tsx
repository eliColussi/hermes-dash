"use client";

import { MoreHorizontal, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { Agent, api } from "@/lib/api";
import { cn } from "@/lib/cn";

export function AgentCard({ agent, onChange }: { agent: Agent; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      if (agent.status === "down") await api.startAgent(agent.id);
      else await api.stopAgent(agent.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    await api.deleteAgent(agent.id);
    onChange();
  }

  return (
    <div className="card p-5 flex flex-col gap-3 relative">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-lg">
            {agent.icon}
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold">
              {agent.name}
              <span className={cn("dot", agent.status)} />
            </div>
            <div className="text-xs text-muted">{agent.slug}</div>
          </div>
        </div>
        <button
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setMenu((m) => !m)}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div className="absolute right-3 top-12 z-10 card py-1 min-w-[140px] shadow-lg">
            <button
              onClick={remove}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

      <div className="text-sm text-[var(--ink)]/80 min-h-[40px] line-clamp-2">
        {agent.description || agent.role}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg)] border border-line">
          {agent.organization}
        </span>
      </div>

      <div className="text-xs text-muted capitalize">
        {agent.status === "down" ? "Offline" : agent.status}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-line">
        <div className="text-xs text-muted">📋 {agent.tasks_today} tasks today</div>
        <button
          onClick={toggle}
          disabled={busy}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border",
            agent.status === "down"
              ? "border-green-500/30 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
              : "border-red-500/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-950",
            busy && "opacity-50 cursor-not-allowed",
          )}
        >
          {agent.status === "down" ? (
            <>
              <Play className="w-3 h-3" /> Start
            </>
          ) : (
            <>
              <Square className="w-3 h-3" /> Stop
            </>
          )}
        </button>
      </div>
    </div>
  );
}
