"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Goal, goals } from "@/lib/api";

const STATUS_TINT: Record<string, string> = {
  active: "bg-accent-soft text-accent",
  paused: "bg-surface-3 text-ink-2",
  done: "bg-accent-soft text-accent",
  archived: "bg-surface-3 text-muted",
};

export default function GoalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["goals"], queryFn: () => goals.list() });
  const [filter, setFilter] = useState<string>("active");
  const [newOpen, setNewOpen] = useState(false);

  const items = (q.data?.items ?? []).filter(
    (g) => filter === "all" || g.status === filter,
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
          <p className="text-sm text-muted mt-1">
            Long-running objectives your agents are working toward.
          </p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New goal
        </button>
      </div>

      <div className="flex p-1 bg-[var(--bg)] border border-line rounded-lg text-xs mb-4 w-fit">
        {(["active", "paused", "done", "archived", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md capitalize ${
              filter === s
                ? "bg-white dark:bg-[var(--surface)] shadow-sm"
                : "text-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {items.length === 0 && !q.isLoading && (
          <div className="card p-6 text-sm text-muted">
            No goals in the "{filter}" view. Click <strong>New goal</strong> to add one.
          </div>
        )}
        {items.map((g) => (
          <GoalCard
            key={g.id}
            g={g}
            onChange={() => qc.invalidateQueries({ queryKey: ["goals"] })}
          />
        ))}
      </div>

      {newOpen && (
        <NewGoalSheet
          onClose={() => setNewOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["goals"] })}
        />
      )}
    </div>
  );
}

function GoalCard({ g, onChange }: { g: Goal; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const patch = useMutation({
    mutationFn: (b: Partial<Goal & { progress_note: string }>) =>
      goals.patch(g.id, b as never),
    onSuccess: () => onChange(),
  });
  const del = useMutation({
    mutationFn: () => goals.remove(g.id),
    onSuccess: () => onChange(),
  });

  function statusButton(
    label: string,
    icon: React.ReactNode,
    target: Goal["status"],
  ) {
    return (
      <button
        onClick={() => patch.mutate({ status: target })}
        disabled={g.status === target}
        className="text-xs px-2 py-1 border border-line rounded inline-flex items-center gap-1 disabled:opacity-40 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      >
        {icon} {label}
      </button>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 text-muted"
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{g.title}</div>
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TINT[g.status]}`}>
              {g.status}
            </span>
            {g.target_date && (
              <span className="text-[10px] text-muted">by {g.target_date}</span>
            )}
            {g.owner_agent_id && (
              <span className="text-[10px] text-muted">→ {g.owner_agent_id}</span>
            )}
          </div>
          {g.description && (
            <div className="text-xs text-muted mt-1">{g.description}</div>
          )}
        </div>
        <button
          onClick={() => {
            if (confirm(`Delete goal "${g.title}"?`)) del.mutate();
          }}
          className="p-1.5 rounded hover:bg-surface-3 text-bad"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="mt-3 pl-7 space-y-3">
          <div className="flex gap-1 flex-wrap">
            {statusButton("Activate", <Play className="w-3 h-3" />, "active")}
            {statusButton("Pause", <Pause className="w-3 h-3" />, "paused")}
            {statusButton("Done", <CheckCircle2 className="w-3 h-3" />, "done")}
            {statusButton("Archive", <Archive className="w-3 h-3" />, "archived")}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              patch.mutate({ progress_note: note });
              setNote("");
            }}
            className="flex gap-2"
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a progress note…"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-line bg-[var(--bg)]"
            />
            <button
              disabled={!note.trim()}
              className="btn-primary text-xs disabled:opacity-40"
            >
              Log
            </button>
          </form>

          {g.progress.length > 0 && (
            <ul className="space-y-1 text-xs">
              {g.progress.slice().reverse().map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted whitespace-nowrap">{p.ts.slice(5, 16).replace("T", " ")}</span>
                  <span>{p.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NewGoalSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await goals.create({
        title,
        description,
        target_date: targetDate || undefined,
        status: "active",
      });
      onCreated();
      onClose();
    } catch (e) {
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
          <h2 className="text-lg font-semibold">New goal</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Onboard 50 paying clients by EOY"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What does success look like? Why this goal?"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Target date (optional)</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
        </div>

        {err && <div className="text-sm text-bad">{err}</div>}

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-line rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            disabled={busy || !title}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create goal"}
          </button>
        </div>
      </form>
    </div>
  );
}
