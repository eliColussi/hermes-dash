"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, capabilities, composio } from "@/lib/api";

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
  const [toolsets, setToolsets] = useState<string[]>(["composio"]);
  // Per-agent Composio scoping: which connected apps this agent can touch.
  // Empty = all of them (legacy behaviour). Scoped = the agent's briefing
  // and tool surface only mention the picked toolkits → cleaner reasoning,
  // fewer wasted tokens on irrelevant integrations.
  const [composioToolkits, setComposioToolkits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const capsQ = useQuery({ queryKey: ["capabilities"], queryFn: capabilities.list });
  const capMap = new Map((capsQ.data?.items ?? []).map((c) => [c.id, c]));

  // Pull the operator's currently-connected Composio apps so the multi-
  // select shows their real options, not the full 1000+ Composio catalogue.
  const cstatus = useQuery({ queryKey: ["composio-status"], queryFn: composio.status });
  const cconns = useQuery({
    queryKey: ["composio-connections"],
    queryFn: composio.connections,
    enabled: cstatus.data?.configured === true,
  });
  const connectedSlugs = useMemo(() => {
    const seen = new Set<string>();
    (cconns.data?.items ?? []).forEach((c) => seen.add(c.toolkit));
    return Array.from(seen).sort();
  }, [cconns.data]);
  const composioEnabled = toolsets.includes("composio");

  const TOOLSET_OPTIONS = [
    { id: "composio", label: "Composio (250+ apps via OAuth)" },
    { id: "memory", label: "Memory tools" },
    { id: "web", label: "Web search & fetch" },
    { id: "code_execution", label: "Code execution" },
    { id: "browser", label: "Browser automation" },
    { id: "terminal", label: "Terminal" },
  ];

  function toggleToolset(id: string) {
    setToolsets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

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
        toolsets: toolsets.length ? toolsets : undefined,
        composio_toolkits:
          composioEnabled && composioToolkits.length ? composioToolkits : undefined,
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
            <optgroup label="Recommended (default)">
              <option value="anthropic/claude-sonnet-4.6">Claude Sonnet 4.6 — the right balance for almost any agent</option>
              <option value="anthropic/claude-opus-4.7">Claude Opus 4.7 — the smartest option, worth it for hard problems</option>
              <option value="openai/gpt-5">GPT-5 — strongest closed competitor, great at structured tasks</option>
            </optgroup>
            <optgroup label="Faster, cheaper (when speed/cost actually matters)">
              <option value="anthropic/claude-haiku-4.5">Claude Haiku 4.5 — fast, cheap, decent at tools</option>
              <option value="google/gemini-2.5-flash">Gemini 2.5 Flash — fastest, very cheap</option>
              <option value="openai/gpt-5-mini">GPT-5 mini — cheap GPT-5 family</option>
            </optgroup>
            <optgroup label="Frontier (massive context, deepest reasoning)">
              <option value="google/gemini-2.5-pro">Gemini 2.5 Pro — long context, strong tools</option>
              <option value="x-ai/grok-4">Grok 4 — strong tool calling, fast</option>
            </optgroup>
            <optgroup label="Sleeper picks (cheap + great tool calling)">
              <option value="minimax/minimax-m2">MiniMax M2 — excellent agentic orchestration, very cheap</option>
              <option value="deepseek/deepseek-v3.2">DeepSeek V3.2 — strong tools, lowest cost per turn</option>
              <option value="qwen/qwen3-max">Qwen3 Max — strong multi-step tool chains</option>
              <option value="moonshotai/kimi-k2">Kimi K2 — agentic specialist, good at long workflows</option>
              <option value="mistralai/mistral-large-2411">Mistral Large 2 — EU-hosted, solid function calling</option>
            </optgroup>
            <optgroup label="Reasoning (slower, costs more — only when needed)">
              <option value="openai/gpt-5-pro">GPT-5 Pro — deep reasoning</option>
              <option value="deepseek/deepseek-r1">DeepSeek R1 — open-weights reasoning</option>
            </optgroup>
            <optgroup label="Direct provider (skips OpenRouter)">
              <option value="claude-haiku-4-5">Claude Haiku 4.5 (Anthropic direct)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Anthropic direct)</option>
              <option value="claude-opus-4-7">Claude Opus 4.7 (Anthropic direct)</option>
            </optgroup>
          </select>
        </Field>

        <Field label="What this agent can do">
          <div className="flex flex-col gap-1 -mt-0.5">
            {TOOLSET_OPTIONS.map((t) => {
              const cap = capMap.get(t.id);
              const ready = cap?.ready ?? true;
              return (
                <label
                  key={t.id}
                  className="flex items-start gap-2 text-sm cursor-pointer px-2 py-1.5 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={toolsets.includes(t.id)}
                    onChange={() => toggleToolset(t.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{t.label}</span>
                      {cap && (
                        ready ? (
                          <Check className="w-3 h-3 text-ok shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-warn shrink-0" />
                        )
                      )}
                    </div>
                    {cap && (
                      <div className={`text-[10px] mt-0.5 ${ready ? "text-muted" : "text-warn"}`}>
                        {cap.detail}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
            <div className="text-[10px] text-muted mt-1">
              Empty selection = the default set. A warning means we&apos;ll need to
              enable that for you — send your team a message.
            </div>
          </div>
        </Field>

        {composioEnabled && (
          <Field label="Which connected apps can this agent touch?">
            {connectedSlugs.length === 0 ? (
              <div className="text-xs text-muted px-2 py-2 border border-dashed border-line rounded-lg">
                No apps connected yet. Head to <strong>Connections</strong> to
                wire up Gmail, Slack, Stripe and friends — then come back here
                to scope this agent to a subset.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1 -mt-0.5 max-h-48 overflow-y-auto pr-1">
                  {connectedSlugs.map((slug) => (
                    <label
                      key={slug}
                      className="flex items-center gap-2 text-sm cursor-pointer px-2 py-1 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    >
                      <input
                        type="checkbox"
                        checked={composioToolkits.includes(slug)}
                        onChange={() => {
                          setComposioToolkits((prev) =>
                            prev.includes(slug)
                              ? prev.filter((x) => x !== slug)
                              : [...prev, slug],
                          );
                        }}
                      />
                      <span className="capitalize">{slug}</span>
                    </label>
                  ))}
                </div>
                <div className="text-[10px] text-muted mt-1">
                  Empty = the agent can use any connected app. Picking a few
                  keeps it focused (and trims token cost on every turn).
                </div>
              </>
            )}
          </Field>
        )}

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
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? "Creating..." : "Create agent"}
          </button>
        </div>

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
