"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Webhook, webhooks } from "@/lib/api";

// Pre-baked templates. Each picks a sensible default prompt + delivery target
// for the named source service.
const TEMPLATES = [
  {
    id: "stripe-payment",
    label: "Stripe: payment received → onboarding agent",
    prompt:
      "A new Stripe payment came in. Customer: {payload.data.object.customer_email}. Amount: ${payload.data.object.amount_total}. Send a welcome email, create an onboarding task, and notify the team.",
    deliver: "log",
  },
  {
    id: "github-issue",
    label: "GitHub: new issue → triage agent",
    prompt:
      "A new GitHub issue was opened: {payload.issue.title} by {payload.issue.user.login}. Body: {payload.issue.body}. Suggest labels and a first response.",
    deliver: "github_comment",
  },
  {
    id: "form-submit",
    label: "Generic form submission → follow-up",
    prompt:
      "New form submission received: {payload}. Send a personalized follow-up email and log the lead.",
    deliver: "log",
  },
  {
    id: "monitoring-alert",
    label: "Monitoring alert → Slack ping (no LLM)",
    prompt:
      "🚨 ALERT: {payload.title} — {payload.summary}. Severity: {payload.severity}.",
    deliver: "slack",
    deliver_only: true,
  },
];

export default function WebhooksPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["webhooks"], queryFn: webhooks.list });
  const [open, setOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{ name: string; url: string; secret: string } | null>(null);

  const remove = useMutation({
    mutationFn: webhooks.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Triggers</h1>
          <p className="text-sm text-muted mt-1">
            Outside events that wake up an agent. A new Stripe payment, a fresh
            GitHub issue, a form submission — each one can kick off the right
            agent.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New trigger
        </button>
      </div>

      {q.data?.base_url ? null : (
        <div className="card p-4 mb-4 text-xs text-muted">
          The trigger URLs below appear without a domain prefix. Your team can
          fix this — send them a quick message.
        </div>
      )}

      <div className="card overflow-hidden">
        {q.isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
        {q.data && q.data.items.length === 0 && (
          <div className="p-6 text-sm text-muted">
            No triggers yet. Click <strong>New trigger</strong> to wire up
            Stripe, GitHub, or a custom form.
          </div>
        )}
        {q.data && q.data.items.length > 0 && (
          <div className="divide-y divide-line">
            {q.data.items.map((w) => (
              <WebhookRow
                key={w.name}
                w={w}
                onDelete={() => {
                  if (confirm(`Delete trigger "${w.name}"?`)) remove.mutate(w.name);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {open && (
        <NewWebhookSheet
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
    </div>
  );
}

function WebhookRow({ w, onDelete }: { w: Webhook; onDelete: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{w.name}</div>
          <div className="text-xs text-muted truncate">{w.description}</div>
        </div>
        <div className="flex items-center gap-1">
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
        <CopyableRow label="POST URL" value={w.url} />
        <CopyableRow label="Secret (use when configuring the source)" value={w.secret_masked} />
      </div>
      <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-muted">
        <span>Deliver: <code>{w.deliver}</code>{w.deliver_only ? " (direct, no agent)" : ""}</span>
        {w.events.length > 0 && <span>Events: {w.events.join(", ")}</span>}
      </div>
      {w.prompt && (
        <div className="mt-3 text-xs">
          <div className="text-muted mb-1">Prompt template</div>
          <pre className="text-xs font-mono p-2 bg-[var(--bg)] rounded-lg border border-line overflow-x-auto whitespace-pre-wrap">{w.prompt}</pre>
        </div>
      )}
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
      {copied && <div className="text-[10px] text-green-600 mt-1">Copied.</div>}
    </div>
  );
}

function NewWebhookSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: { name: string; url: string; secret: string }) => void;
}) {
  const [template, setTemplate] = useState<string>(TEMPLATES[0].id);
  const [name, setName] = useState("stripe-payment");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState(TEMPLATES[0].prompt);
  const [deliver, setDeliver] = useState(TEMPLATES[0].deliver);
  const [deliverOnly, setDeliverOnly] = useState(false);
  const [deliverChatId, setDeliverChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplate(id);
    setName(id);
    setPrompt(t.prompt);
    setDeliver(t.deliver);
    setDeliverOnly(Boolean((t as { deliver_only?: boolean }).deliver_only));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await webhooks.create({
        name,
        description,
        prompt,
        deliver,
        deliver_only: deliverOnly,
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
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] h-full bg-[var(--surface)] border-l border-line p-6 flex flex-col gap-4 overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New trigger</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Template</span>
          <select
            value={template}
            onChange={(e) => applyTemplate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Route slug (becomes part of URL)</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="stripe-payment"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this trigger for?"
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Prompt template</span>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-xs font-mono"
          />
          <span className="text-[10px] text-muted">
            Use <code>{"{payload}"}</code> for the whole body, or
            <code>{" {payload.field.subfield}"}</code> for specific values.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Deliver output to</span>
          <select
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
          >
            <option value="log">Local log only</option>
            <option value="telegram">Telegram</option>
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="github_comment">GitHub comment</option>
          </select>
        </div>

        {deliver !== "log" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Deliver chat/channel ID (optional)</span>
            <input
              value={deliverChatId}
              onChange={(e) => setDeliverChatId(e.target.value)}
              placeholder="e.g. @yourchannel or 12345"
              className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
            />
          </div>
        )}

        {deliver !== "log" && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={deliverOnly}
              onChange={(e) => setDeliverOnly(e.target.checked)}
            />
            Skip the agent — send the rendered prompt directly (zero LLM cost, sub-second)
          </label>
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
            disabled={busy || !name || !prompt}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create trigger"}
          </button>
        </div>
      </form>
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
        className="bg-[var(--surface)] border border-line rounded-2xl max-w-md w-full p-6"
      >
        <h2 className="font-semibold mb-2">Webhook created — save the secret</h2>
        <p className="text-xs text-muted mb-4">
          This is the only time the secret is shown. Store it in your source
          service's webhook config for HMAC-SHA256 signature validation.
        </p>
        <div className="space-y-3">
          <CopyableRow label="URL" value={data.url} />
          <CopyableRow label="Secret" value={data.secret} />
        </div>
        <button
          onClick={onClose}
          className="btn-primary mt-4 w-full"
        >
          I saved it
        </button>
      </div>
    </div>
  );
}
