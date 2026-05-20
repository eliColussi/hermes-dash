"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  // Holds the freshly rotated token. We show it exactly once, then clear it
  // on navigation. The token is never persisted to query cache.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rotate = useMutation({
    mutationFn: api.rotateToken,
    onSuccess: (data) => {
      if (data?.token) setFreshToken(data.token);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
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
                {s?.token_present
                  ? "•".repeat(40) + (s.token_fingerprint || "")
                  : "—"}
              </code>
              <button
                disabled={rotate.isPending}
                onClick={() => {
                  if (
                    confirm(
                      "Rotate the access key now? The old key will stop working immediately. " +
                        "Any external integrations using it will need to be updated.",
                    )
                  ) {
                    rotate.mutate();
                  }
                }}
                className="p-2 border border-line rounded-lg"
                title="Rotate"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-muted mt-2">
              For security, the full key is never returned by the API after creation.
              Only the last 4 characters are shown above. Rotate to generate a new one.
            </div>
            {freshToken && (
              <div className="mt-3 p-3 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/30">
                <div className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-2">
                  New key — copy now, will not be shown again
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded border border-orange-300 bg-white dark:bg-black/30 font-mono text-xs break-all">
                    {freshToken}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(freshToken);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="p-2 border border-orange-300 rounded-lg"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setFreshToken(null)}
                    className="px-2 py-1 text-xs border border-orange-300 rounded-lg"
                  >
                    {copied ? "Copied — dismiss" : "I've saved it"}
                  </button>
                </div>
                <div className="text-[11px] text-orange-700 dark:text-orange-400 mt-2">
                  {rotate.data?.note}
                </div>
              </div>
            )}
          </>
        )}
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
        skills directory. Run this before upgrading HERMÉS or moving to a
        new Railway service. Excludes rotating logs, trajectory dumps, and
        all credential files (.env, vault key, session secret, access key)
        — those must be re-supplied via Railway env vars on restore.
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
