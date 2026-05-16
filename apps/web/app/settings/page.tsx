"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [revealed, setRevealed] = useState(false);
  const rotate = useMutation({
    mutationFn: api.rotateToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const s = q.data;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted mt-1 mb-6">Workspace settings.</p>

      <div className="card p-5 mb-4">
        <div className="text-sm font-medium mb-2">Access key</div>
        {s?.auth_disabled ? (
          <div className="text-sm text-orange-600">
            Sign-in is disabled in this environment. Your team can turn it back on.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg border border-line bg-[var(--bg)] font-mono text-xs break-all">
                {s?.token
                  ? revealed
                    ? s.token
                    : s.token.slice(0, 6) + "•".repeat(20) + s.token.slice(-4)
                  : "—"}
              </code>
              <button
                onClick={() => setRevealed((r) => !r)}
                className="p-2 border border-line rounded-lg"
                title={revealed ? "Hide" : "Reveal"}
              >
                {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => s?.token && navigator.clipboard.writeText(s.token)}
                className="p-2 border border-line rounded-lg"
                title="Copy"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                disabled={rotate.isPending}
                onClick={() => rotate.mutate()}
                className="p-2 border border-line rounded-lg"
                title="Rotate"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-muted mt-2">
              The web app reads this from <code>STAFFROOM_AUTH_TOKEN</code> on the server side.
              After rotating, update the env var and restart the web service.
            </div>
            {rotate.data?.note && (
              <div className="text-xs text-orange-600 mt-2">{rotate.data.note}</div>
            )}
          </>
        )}
      </div>

      <div className="card p-5 mb-4">
        <div className="text-sm font-medium mb-3">Paths</div>
        <Row label="HERMÉS home" value={s?.hermes_home ?? "—"} />
        <Row label="Staff Room home" value={s?.staffroom_home ?? "—"} />
      </div>

      <div className="card p-5 mb-4">
        <div className="text-sm font-medium mb-3">Environment</div>
        {Object.entries(s?.env ?? {}).map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </div>

      <BackupCard />

      <ClaudeCodeBridge />
    </div>
  );
}

function BackupCard() {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/backup");
      if (!r.ok) {
        alert(`Backup failed: ${r.status} ${r.statusText}`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? "staffroom-backup.tar.gz";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 mb-4">
      <div className="text-sm font-medium mb-1">Backup</div>
      <p className="text-xs text-muted mb-3">
        Downloads a .tar.gz of your HERMÉS state + Staff Room config —
        agents.yaml, state.db, kanban.db, webhook subscriptions, audit log,
        skills directory, .env. Run this before upgrading HERMÉS or moving
        to a new Railway service. Excludes rotating logs and trajectory
        dumps (recoverable).
      </p>
      <button
        disabled={busy}
        onClick={download}
        className="px-3 py-2 text-sm border border-line rounded-lg"
      >
        {busy ? "Preparing…" : "Download backup"}
      </button>
    </div>
  );
}

function ClaudeCodeBridge() {
  const q = useQuery({ queryKey: ["mcp-config"], queryFn: api.mcpConfig });
  const [copied, setCopied] = useState(false);
  const snippet = q.data?.claude_code ? JSON.stringify(q.data.claude_code, null, 2) : "";
  return (
    <div className="card p-5">
      <div className="text-sm font-medium mb-1">Connect to Claude Code</div>
      <p className="text-xs text-muted mb-3">
        Bridge your HERMÉS memory into your daily Claude Code workflow. Paste
        this into your Claude Code config; restart Claude Code; ask it
        anything about what your agents are doing — it'll have full access to
        the same conversations and tools.
      </p>
      <pre className="text-[11px] font-mono p-3 rounded-lg border border-line bg-[var(--bg)] overflow-x-auto whitespace-pre">
        {snippet || "Loading…"}
      </pre>
      <div className="flex items-center gap-2 mt-2">
        <button
          disabled={!snippet}
          onClick={() => {
            navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="px-3 py-1.5 text-xs border border-line rounded-lg"
        >
          {copied ? "Copied" : "Copy snippet"}
        </button>
        <span className="text-[10px] text-muted">
          {q.data?.instructions}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-line last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <code className="text-xs font-mono">{value}</code>
    </div>
  );
}
