"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

export default function TasksPage() {
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      api.createTask({ title, agent_id: agentId || undefined }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Delegate work to your agents. Queued tasks are picked up by the HERMÉS dispatcher.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
        className="card p-4 mb-6 flex gap-2"
      >
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
        >
          <option value="">Any agent</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Summarize the last 10 emails…"
          className="flex-1 px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
        />
        <button
          disabled={!title.trim() || create.isPending}
          className="btn-primary disabled:opacity-40"
        >
          Delegate
        </button>
      </form>

      <div className="card divide-y divide-line">
        {(tasks.data ?? []).length === 0 && (
          <div className="p-6 text-sm text-muted">No tasks yet.</div>
        )}
        {(tasks.data ?? []).map((t) => (
          <div key={t.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted">
                {t.source} · {new Date(t.created_at * 1000).toLocaleString()}
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg)] border border-line">
              {t.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
