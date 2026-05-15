"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { useState } from "react";
import { Integration, api } from "@/lib/api";

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["integrations"], queryFn: api.integrations });
  const startGw = useMutation({
    mutationFn: api.startGateway,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
  const stopGw = useMutation({
    mutationFn: api.stopGateway,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const gw = q.data?.gateway;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Connect your agents to Slack, Telegram, and Discord via the HERMÉS gateway.
      </p>

      <div className="card p-5 mb-8 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Gateway daemon</div>
          <div className="text-xs text-muted mt-1">
            {gw?.running
              ? `Running (pid ${gw.pid}). Logs at ${gw.log}.`
              : "Stopped. Start it after configuring at least one provider."}
          </div>
        </div>
        <button
          disabled={startGw.isPending || stopGw.isPending}
          onClick={() => (gw?.running ? stopGw.mutate() : startGw.mutate())}
          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border ${
            gw?.running
              ? "border-red-500/40 text-red-600"
              : "border-green-500/40 text-green-600"
          }`}
        >
          {gw?.running ? (
            <>
              <Square className="w-4 h-4" /> Stop gateway
            </>
          ) : (
            <>
              <Play className="w-4 h-4" /> Start gateway
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(q.data?.integrations ?? []).map((i) => (
          <IntegrationCard key={i.id} integration={i} onSaved={() => q.refetch()} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  onSaved,
}: {
  integration: Integration;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.saveIntegration(integration.id, values),
    onSuccess: () => {
      setEditing(false);
      setValues({});
      onSaved();
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-2xl">{integration.icon}</div>
        <div className="flex-1">
          <div className="font-medium">{integration.label}</div>
          <div className="text-xs text-muted">
            {integration.configured ? "✓ Configured" : "Not configured"}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {integration.fields.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium">{f.label}</label>
              {f.help && <span className="text-[10px] text-muted">{f.help}</span>}
            </div>
            {editing ? (
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.secret ? "Paste new value" : ""}
                className="w-full px-3 py-2 text-sm rounded-lg border border-line bg-[var(--bg)] font-mono"
              />
            ) : (
              <div className="text-xs font-mono text-muted px-3 py-2 rounded-lg border border-line bg-[var(--bg)]">
                {integration.values[f.key] || <span className="italic">empty</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

      <div className="flex gap-2 mt-4">
        {editing ? (
          <>
            <button
              onClick={() => {
                setEditing(false);
                setValues({});
                setErr(null);
              }}
              className="flex-1 px-3 py-2 text-sm border border-line rounded-lg"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending || Object.keys(values).length === 0}
              onClick={() => save.mutate()}
              className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg"
          >
            {integration.configured ? "Update credentials" : "Configure"}
          </button>
        )}
      </div>
    </div>
  );
}
