"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export function AddAgentTile({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="card p-5 flex flex-col items-center justify-center text-muted hover:bg-black/[0.02] dark:hover:bg-white/5 min-h-[200px]"
      >
        <Plus className="w-6 h-6 mb-2" />
        <span className="text-sm font-medium">Add Agent</span>
      </button>
      {open && <AddAgentSheet onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}

function AddAgentSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("🤖");
  const [model, setModel] = useState("anthropic/claude-sonnet-4.6");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createAgent({
        name,
        role,
        description,
        icon,
        model,
        system_prompt: systemPrompt,
      } as never);
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
        className="w-[480px] h-full bg-[var(--surface)] border-l border-line p-6 flex flex-col gap-4 overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Agent</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Field label="Name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="e.g. Inbox Watcher"
          />
        </Field>

        <Field label="Icon (emoji)">
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="input w-20 text-center"
          />
        </Field>

        <Field label="Role">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input"
            placeholder="e.g. Email triage"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="input"
            placeholder="One-line summary shown on the agent card."
          />
        </Field>

        <Field label="System prompt">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            className="input font-mono text-xs"
            placeholder="You are an AI employee that..."
          />
        </Field>

        <Field label="Model">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input">
            <optgroup label="OpenRouter">
              <option value="anthropic/claude-opus-4.7">Claude Opus 4.7</option>
              <option value="anthropic/claude-sonnet-4.6">Claude Sonnet 4.6</option>
              <option value="anthropic/claude-haiku-4.5">Claude Haiku 4.5</option>
              <option value="openai/gpt-5">GPT-5</option>
              <option value="openai/gpt-5-mini">GPT-5 mini</option>
              <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="deepseek/deepseek-r1">DeepSeek R1</option>
              <option value="x-ai/grok-4">Grok 4</option>
            </optgroup>
            <optgroup label="Direct (uses Anthropic key)">
              <option value="claude-opus-4-7">Claude Opus 4.7</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            </optgroup>
          </select>
        </Field>

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
            disabled={busy || !name}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create agent"}
          </button>
        </div>

        <style jsx>{`
          .input {
            width: 100%;
            padding: 8px 12px;
            border-radius: 10px;
            border: 1px solid var(--line);
            background: var(--bg);
            font-size: 14px;
            color: var(--ink);
          }
          .input:focus {
            outline: none;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
          }
        `}</style>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
