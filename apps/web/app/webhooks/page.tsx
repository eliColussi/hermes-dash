"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bell, Copy, HelpCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Agent, Webhook, api, webhooks } from "@/lib/api";

const DELIVERIES = [
  { id: "log", label: "Just log it", hint: "Quietly record the result. Good for testing." },
  { id: "telegram", label: "Telegram", hint: "Send a message to a Telegram chat or channel." },
  { id: "slack", label: "Slack", hint: "Post into a Slack channel." },
  { id: "discord", label: "Discord", hint: "Post into a Discord channel." },
  { id: "github_comment", label: "GitHub comment", hint: "Reply on the GitHub issue or PR that fired the event." },
];

// Inline help topics — short, written for non-technical operators.
const HELP: Record<string, { title: string; body: string }> = {
  stripe: {
    title: "Finding your Stripe webhook URL",
    body:
      "In Stripe: Dashboard → Developers → Webhooks → Add endpoint. Paste the trigger URL we give you on the next screen. Pick the events you want (e.g. payment_intent.succeeded). Stripe will start posting events to your agent right away.",
  },
  github: {
    title: "Finding your GitHub webhook URL",
    body:
      "On the repo: Settings → Webhooks → Add webhook. Paste the trigger URL into 'Payload URL', set content type to application/json, and pick the events (e.g. Issues, Pull requests).",
  },
  calendly: {
    title: "Finding your Calendly webhook URL",
    body:
      "In Calendly: Integrations → Webhooks (Pro+). Click 'Create webhook subscription', paste our URL, and pick events like invitee.created.",
  },
  general: {
    title: "Pasting the URL into other apps",
    body:
      "Most apps have a 'Webhooks' or 'Integrations' settings page. Look for a field called 'Endpoint URL', 'Webhook URL', or 'Callback URL' and paste ours there. If you can't find it — send your team a message, we'll set it up for you.",
  },
};

export default function WebhooksPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["webhooks"], queryFn: webhooks.list });
  const agentsQ = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{ name: string; url: string; secret: string } | null>(null);

  const remove = useMutation({
    mutationFn: webhooks.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent>();
    (agentsQ.data ?? []).forEach((a) => map.set(a.id, a));
    return map;
  }, [agentsQ.data]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-display tracking-tight">Triggers</h1>
          <p className="text-sm text-muted mt-1">
            Outside events that wake an agent up. A new Stripe payment, a fresh
            GitHub issue, a form submission — each one can hand work to the
            right agent automatically.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-primary flex items-center gap-2"
          disabled={(agentsQ.data ?? []).length === 0}
          title={(agentsQ.data ?? []).length === 0 ? "Create an agent first" : undefined}
        >
          <Plus className="w-4 h-4" /> New trigger
        </button>
      </div>

      {(agentsQ.data ?? []).length === 0 && (
        <div className="card p-4 mb-4 text-sm text-muted">
          You need at least one agent before you can wire up a trigger. Head to
          the <strong>Agents</strong> page and create one.
        </div>
      )}

      <div className="card overflow-hidden">
        {q.isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
        {q.data && q.data.items.length === 0 && (
          <div className="p-10 text-center">
            <Bell className="w-8 h-8 mx-auto text-muted mb-3" />
            <div className="text-sm text-muted">
              No triggers yet. Click <strong>New trigger</strong> to wire up
              Stripe, GitHub, Calendly, or a custom form.
            </div>
          </div>
        )}
        {q.data && q.data.items.length > 0 && (
          <div className="divide-y divide-line">
            {q.data.items.map((w) => (
              <WebhookRow
                key={w.name}
                w={w}
                agent={w.agent_id ? agentLookup.get(w.agent_id) : undefined}
                onEdit={() => setEditing(w)}
                onDelete={() => {
                  if (confirm(`Delete trigger "${w.title || w.name}"?`)) remove.mutate(w.name);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {open && (
        <NewTriggerWizard
          agents={agentsQ.data ?? []}
          onClose={() => setOpen(false)}
          onCreated={(r) => {
            setCreatedSecret(r);
            qc.invalidateQueries({ queryKey: ["webhooks"] });
          }}
        />
      )}

      {createdSecret && (
        <SecretRevealModal data={createdSecret} onClose={() => setCreatedSecret(null)} />
      )}

      {editing && (
        <EditTriggerSheet
          trigger={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["webhooks"] });
          }}
        />
      )}
    </div>
  );
}

function WebhookRow({
  w,
  agent,
  onEdit,
  onDelete,
}: {
  w: Webhook;
  agent: Agent | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deliveryLabel = DELIVERIES.find((d) => d.id === w.deliver)?.label ?? w.deliver;
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium">{w.title || w.name}</div>
            {agent && (
              <span className="chip chip-accent text-[10px]">
                → {agent.icon} {agent.name}
              </span>
            )}
            <span className="chip text-[10px]">{deliveryLabel}</span>
          </div>
          {w.description && w.description !== w.title && (
            <div className="text-xs text-muted mt-0.5">{w.description}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-muted"
            title="Edit trigger"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-600"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <CopyableRow label="Paste this URL into the source app" value={w.url} />
        <CopyableRow label="Signing secret (use if the source app asks)" value={w.secret_masked} />
      </div>
    </div>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="flex items-center gap-1">
        <code className="flex-1 px-2 py-1.5 rounded border border-line bg-[var(--bg)] text-xs truncate">
          {value || "—"}
        </code>
        {value && (
          <button
            className="p-1.5 border border-line rounded"
            onClick={() => {
              navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
      {copied && <div className="text-[10px] text-ok mt-1">Copied.</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// New Trigger wizard — three plain-English steps, no jargon.
// ──────────────────────────────────────────────────────────────────────

function NewTriggerWizard({
  agents,
  onClose,
  onCreated,
}: {
  agents: Agent[];
  onClose: () => void;
  onCreated: (r: { name: string; url: string; secret: string }) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState<string>(agents[0]?.id ?? "");
  const [deliver, setDeliver] = useState("log");
  const [deliverChatId, setDeliverChatId] = useState("");
  const [helpTopic, setHelpTopic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canNext1 = title.trim().length > 1 && prompt.trim().length > 5;
  const canNext2 = agentId.length > 0;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const created = await webhooks.create({
        name: title,
        prompt,
        agent_id: agentId,
        deliver,
        deliver_chat_id: deliverChatId || undefined,
      });
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:w-[600px] h-full bg-surface border-l border-line flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <div className="font-display text-xl tracking-tight">New trigger</div>
            <div className="text-xs text-muted mt-0.5">
              Step {step} of 3 — {step === 1 ? "what should happen" : step === 2 ? "which agent handles it" : "where the result goes"}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-3 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1 px-5 pt-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full ${
                n <= step ? "bg-accent" : "bg-surface-3"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  What should we call this trigger?
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Stripe payments, GitHub issues, Calendly bookings"
                  className="input"
                />
                <div className="text-[11px] text-muted mt-1">
                  Just a friendly name — only you see it.
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">
                  What should the agent do when this fires?
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={7}
                  placeholder={
                    "When a new Stripe payment comes in, draft a welcome email to the customer, mention the amount they paid, and post a short summary to #sales."
                  }
                  className="input font-sans"
                />
                <div className="text-[11px] text-muted mt-1">
                  Write it like you'd brief a new teammate. The agent will see
                  the full event details automatically — you don't need to mention
                  variables or fields.
                </div>
              </div>

              <details className="text-xs text-muted">
                <summary className="cursor-pointer hover:text-ink">
                  Need help finding the webhook URL in another app?
                </summary>
                <div className="mt-2 space-y-1 pl-3">
                  {Object.entries(HELP).map(([k, h]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setHelpTopic(k)}
                      className="block text-accent hover:underline text-left"
                    >
                      {h.title} →
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="text-sm text-muted">
                Which agent should handle this? They'll inherit their normal
                personality, tools, and memory — the trigger just hands them work.
              </div>
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAgentId(a.id)}
                  className={`w-full text-left p-3 rounded-xl border transition flex items-center gap-3 ${
                    agentId === a.id
                      ? "border-accent bg-accent-soft/40"
                      : "border-line bg-surface hover:border-accent/40"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-xl">
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted truncate">
                      {a.description || a.role}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium block mb-2">
                  Where should the result go?
                </label>
                <div className="space-y-2">
                  {DELIVERIES.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDeliver(d.id)}
                      className={`w-full text-left p-3 rounded-xl border transition ${
                        deliver === d.id
                          ? "border-accent bg-accent-soft/40"
                          : "border-line bg-surface hover:border-accent/40"
                      }`}
                    >
                      <div className="font-medium text-sm">{d.label}</div>
                      <div className="text-xs text-muted mt-0.5">{d.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {deliver !== "log" && (
                <div>
                  <label className="text-sm font-medium block mb-1.5">
                    Channel or chat ID (optional)
                  </label>
                  <input
                    value={deliverChatId}
                    onChange={(e) => setDeliverChatId(e.target.value)}
                    placeholder="#sales, @yourchannel, or a numeric ID"
                    className="input"
                  />
                  <div className="text-[11px] text-muted mt-1">
                    Leave blank and the agent will pick a sensible default. Not
                    sure? Send your team a message and we'll set it up.
                  </div>
                </div>
              )}

              {err && <div className="text-sm text-bad">{err}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2 | 3))}
            className="px-4 py-2 border border-line rounded-lg text-sm flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {step === 1 ? "Cancel" : "Back"}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 1 ? !canNext1 : !canNext2}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
            >
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="btn-primary disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create trigger"}
            </button>
          )}
        </div>
      </div>

      {helpTopic && (
        <HelpModal topic={helpTopic} onClose={() => setHelpTopic(null)} />
      )}
    </div>
  );
}

function HelpModal({ topic, onClose }: { topic: string; onClose: () => void }) {
  const h = HELP[topic];
  if (!h) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-line rounded-2xl max-w-md w-full p-5"
      >
        <div className="flex items-center gap-2 mb-2">
          <HelpCircle className="w-4 h-4 text-accent" />
          <div className="font-medium">{h.title}</div>
        </div>
        <div className="text-sm text-muted leading-relaxed">{h.body}</div>
        <button onClick={onClose} className="btn-primary mt-4 w-full">
          Got it
        </button>
      </div>
    </div>
  );
}

function SecretRevealModal({
  data,
  onClose,
}: {
  data: { name: string; url: string; secret: string };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-line rounded-2xl max-w-md w-full p-6"
      >
        <h2 className="font-display text-xl tracking-tight mb-2">Your trigger is live</h2>
        <p className="text-xs text-muted mb-4">
          Paste the URL below into the source app (Stripe, GitHub, etc.). If
          the app asks for a signing secret, use this one — it's only shown
          this once.
        </p>
        <div className="space-y-3">
          <CopyableRow label="Paste this URL into the source app" value={data.url} />
          <CopyableRow label="Signing secret (only shown once)" value={data.secret} />
        </div>
        <button onClick={onClose} className="btn-primary mt-4 w-full">
          Done
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit trigger sheet — single-pane form for tweaking existing triggers.
// Slug, secret, and owning agent stay immutable so the public URL keeps
// working and the pause-cascade contract doesn't break.
// ──────────────────────────────────────────────────────────────────────

function EditTriggerSheet({
  trigger,
  onClose,
  onSaved,
}: {
  trigger: Webhook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(trigger.title || trigger.name);
  const [description, setDescription] = useState(trigger.description || "");
  const [prompt, setPrompt] = useState(trigger.prompt || "");
  const [deliver, setDeliver] = useState(trigger.deliver || "log");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await webhooks.patch(trigger.name, {
        title,
        description,
        prompt,
        deliver,
      });
      onSaved();
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
        className="w-full md:w-[520px] h-full bg-[var(--surface)] border-l border-line p-5 md:p-6 flex flex-col gap-4 overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit trigger</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted -mt-2">
          The trigger URL and signing secret stay the same — anything you&apos;ve
          already pasted into Stripe / GitHub / etc. keeps working. To change
          which agent runs this, delete and recreate.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Display name</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
          <span className="text-[10px] text-muted">
            Only the title is editable. The URL slug is locked to
            <code className="font-mono mx-1">{trigger.name}</code>
            so external services keep reaching this trigger.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
            placeholder="One line. What does this trigger do?"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            Instructions for the agent
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm font-mono"
            placeholder="When this fires, do X. Be specific about tone, who to notify, what to skip."
          />
          <span className="text-[10px] text-muted">
            The full event payload is appended invisibly — no need to write
            <code className="font-mono mx-1">{"{payload.x.y}"}</code>
            placeholders unless you want them.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deliver result to</span>
          <select
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          >
            {DELIVERIES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
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
            disabled={busy || !title}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
