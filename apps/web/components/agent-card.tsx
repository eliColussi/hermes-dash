"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquare, MoreHorizontal, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { Agent, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EditAgentButton } from "@/components/add-agent";

export function AgentCard({ agent, onChange }: { agent: Agent; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);

  // Highlight which agent is the current chat-channel voice so operators can
  // see at a glance who their bot speaks as on Telegram/Slack/etc.
  const channelQ = useQuery({
    queryKey: ["channel-agent"],
    queryFn: api.getChannelAgent,
  });
  const isChannelAgent = channelQ.data?.agent_id === agent.id;

  async function toggle() {
    // When pausing, warn the operator that this also stops the agent's
    // schedules and triggers — that's the whole point of the button (so
    // a misbehaving agent stops burning money) but they should know.
    if (agent.status !== "down") {
      const ok = confirm(
        `Pause ${agent.name}? Any schedules or triggers linked to this ` +
        `agent will stop firing too. Nothing is deleted — clicking Start ` +
        `again restores everything.`,
      );
      if (!ok) return;
    }
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

  async function setAsChannelVoice() {
    setBusy(true);
    try {
      await api.setChannelAgent(agent.id);
      onChange();
      channelQ.refetch();
      alert(
        `${agent.name} is now the voice on every chat channel. ` +
        `Restart the messaging service from /connections for the change to take effect.`,
      );
    } catch (e) {
      alert(`Failed to set channel voice: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setMenu(false);
    }
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
        <div className="flex items-center gap-1">
          <EditAgentButton agent={agent} onSaved={onChange} />
          <button
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setMenu((m) => !m)}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
        {menu && (
          <div className="absolute right-3 top-12 z-10 card py-1 min-w-[180px] shadow-lg">
            {!isChannelAgent && (
              <button
                onClick={setAsChannelVoice}
                disabled={busy}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-3 disabled:opacity-50"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Set as channel voice
              </button>
            )}
            <button
              onClick={remove}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-bad hover:bg-surface-3"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

      <div className="text-sm text-[var(--ink)]/80 min-h-[40px] line-clamp-2">
        {agent.description || agent.role}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="chip">{agent.organization}</span>
        {isChannelAgent && (
          <span
            className="chip chip-accent flex items-center gap-1"
            title="This agent's system prompt is the one HERMÉS uses on every chat platform (Telegram / Slack / Discord / Mattermost / Email)"
          >
            <MessageSquare className="w-3 h-3" /> Channel voice
          </span>
        )}
        {(agent.toolsets ?? []).map((t) => (
          <span key={t} className="chip chip-accent font-mono" title="Tool">
            {t}
          </span>
        ))}
        {agent.model && (
          <span
            className="chip font-mono truncate max-w-[140px]"
            title={agent.model}
          >
            {agent.model.split("/").pop()}
          </span>
        )}
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
            "flex items-center gap-1 px-3 py-1 rounded-lg text-xs border transition",
            agent.status === "down"
              ? "border-line text-ok hover:bg-accent-soft hover:border-accent/40"
              : "border-line text-bad hover:bg-surface-3",
            busy && "opacity-50 cursor-not-allowed",
          )}
        >
          {agent.status === "down" ? (
            <>
              <Play className="w-3 h-3" /> Start
            </>
          ) : (
            <>
              <Square className="w-3 h-3" /> Pause
            </>
          )}
        </button>
      </div>
    </div>
  );
}
