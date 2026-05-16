"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, Trash2, X, Zap } from "lucide-react";
import { useState } from "react";
import { Schedule, schedules } from "@/lib/api";

// Friendly schedule recipes the operator can pick by default
const RECIPES = [
  { label: "Every weekday at 9:00 AM", value: "0 9 * * 1-5" },
  { label: "Every hour", value: "every 1h" },
  { label: "Every 15 minutes", value: "every 15m" },
  { label: "Every day at noon", value: "0 12 * * *" },
  { label: "Mondays at 8:00 AM", value: "0 8 * * 1" },
  { label: "Once in 5 minutes", value: "5m" },
];

export default function SchedulesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["schedules"], queryFn: schedules.list, refetchInterval: 5000 });
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: schedules.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      schedules.patch(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });
  const triggerNow = useMutation({
    mutationFn: schedules.trigger,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted mt-1">
            Run agents on a schedule — every day at 9am, every hour, once in 5 minutes.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New schedule
        </button>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
        {q.isError && (
          <div className="p-6 text-sm text-red-600">
            Bridge unreachable. Make sure the FastAPI service is up.
          </div>
        )}
        {q.data && q.data.items.length === 0 && (
          <div className="p-6 text-sm text-muted">
            No schedules yet. Click <strong>New schedule</strong> to create one.
          </div>
        )}
        {q.data && q.data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg)] text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name / Prompt</th>
                <th className="text-left px-4 py-3">Schedule</th>
                <th className="text-left px-4 py-3">Next run</th>
                <th className="text-left px-4 py-3">Last status</th>
                <th className="text-left px-4 py-3">Deliver</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.items.map((s) => (
                <ScheduleRow
                  key={s.id}
                  s={s}
                  onToggle={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}
                  onTrigger={() => triggerNow.mutate(s.id)}
                  onDelete={() => {
                    if (confirm(`Delete schedule "${s.name}"?`)) remove.mutate(s.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <NewScheduleSheet
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["schedules"] })}
        />
      )}
    </div>
  );
}

function ScheduleRow({
  s,
  onToggle,
  onTrigger,
  onDelete,
}: {
  s: Schedule;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const next = s.next_run_at ? new Date(s.next_run_at).toLocaleString() : "—";
  const last = s.last_status ?? "—";
  return (
    <tr className={s.enabled ? "" : "opacity-60"}>
      <td className="px-4 py-3 max-w-[320px]">
        <div className="font-medium truncate">{s.name}</div>
        <div className="text-xs text-muted truncate">{s.prompt}</div>
      </td>
      <td className="px-4 py-3">
        <code className="text-xs">{s.schedule_display}</code>
      </td>
      <td className="px-4 py-3 text-xs text-muted">{next}</td>
      <td className="px-4 py-3 text-xs">{last}</td>
      <td className="px-4 py-3 text-xs">{s.deliver ?? "local"}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onTrigger}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
            title="Run now"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
            title={s.enabled ? "Pause" : "Resume"}
          >
            {s.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-600"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function NewScheduleSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * 1-5");
  const [deliver, setDeliver] = useState("local");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await schedules.create({ name, prompt, schedule, deliver });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[500px] h-full bg-[var(--surface)] border-l border-line p-6 flex flex-col gap-4 overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New schedule</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Morning Gmail digest"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Prompt</span>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="What should the agent do on each run?"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">When</span>
          <select
            value={RECIPES.find((r) => r.value === schedule)?.value ?? "__custom"}
            onChange={(e) => {
              if (e.target.value !== "__custom") setSchedule(e.target.value);
            }}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          >
            {RECIPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
            <option value="__custom">Custom (cron or interval)</option>
          </select>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * 1-5  /  every 30m  /  5m"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-xs font-mono"
          />
          <span className="text-[10px] text-muted">
            Accepts cron (0 9 * * 1-5), interval (every 30m), one-shot (30m), or ISO timestamp.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deliver output to</span>
          <select
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          >
            <option value="local">Local (saved to disk + Activity feed)</option>
            <option value="telegram">Telegram (requires gateway)</option>
            <option value="slack">Slack (requires gateway)</option>
            <option value="discord">Discord (requires gateway)</option>
          </select>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-line rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            disabled={busy || !name || !prompt}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}
