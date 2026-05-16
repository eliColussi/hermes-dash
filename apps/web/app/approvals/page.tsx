"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { approvals } from "@/lib/api";

export default function ApprovalsPage() {
  const [showHistory, setShowHistory] = useState(false);
  const pending = useQuery({
    queryKey: ["approvals"],
    queryFn: approvals.list,
    refetchInterval: 2000,
  });
  const history = useQuery({
    queryKey: ["approvals-history"],
    queryFn: approvals.history,
    enabled: showHistory,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Approvals</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Tools that need human approval before an agent runs them.
      </p>

      <div className="card p-4 mb-6 bg-surface-3 border-line">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warn mt-0.5" />
          <div className="text-sm">
            <strong>v1 limitation:</strong> The dashboard shows pending
            approvals in real time, but responding still happens at the
            surface that raised the request — the CLI prompt, the Telegram
            bot's inline buttons, or the Slack message reply. Dashboard-side
            approve / deny ships in v1.1 once we wire the gateway notify
            callback through the bridge.
          </div>
        </div>
      </div>

      <h2 className="text-sm uppercase tracking-wider text-muted mb-2">
        Pending ({pending.data?.count ?? 0})
      </h2>
      <div className="card divide-y divide-line mb-8">
        {(pending.data?.items ?? []).length === 0 && (
          <div className="p-6 text-sm text-muted flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-ok" /> Nothing waiting.
          </div>
        )}
        {(pending.data?.items ?? []).map((a, i) => (
          <ApprovalRow key={i} a={a} />
        ))}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted">
          Today's history
        </h2>
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="text-xs px-2 py-1 rounded border border-line"
        >
          {showHistory ? "Hide" : "Show"}
        </button>
      </div>
      {showHistory && (
        <div className="card divide-y divide-line">
          {(history.data?.items ?? []).length === 0 && (
            <div className="p-6 text-sm text-muted">No approvals today.</div>
          )}
          {(history.data?.items ?? []).slice().reverse().map((a, i) => (
            <ApprovalRow key={i} a={a} showEvent />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  a,
  showEvent = false,
}: {
  a: {
    ts: string;
    event: string;
    command_preview?: string;
    description?: string;
    pattern_key?: string;
    surface?: string;
    [key: string]: unknown;
  };
  showEvent?: boolean;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-xs text-muted">
          {showEvent && (
            <span
              className={`text-[10px] uppercase tracking-wider mr-2 px-1.5 py-0.5 rounded ${
                a.event === "approval_requested"
                  ? "bg-surface-3 text-warn"
                  : "bg-green-100 text-ok"
              }`}
            >
              {a.event === "approval_requested" ? "REQUESTED" : "RESPONDED"}
            </span>
          )}
          <code>{a.pattern_key || "—"}</code>
          {a.surface && <span className="ml-2 text-muted">via {a.surface}</span>}
        </div>
        <span className="text-[10px] text-muted">{new Date(a.ts).toLocaleTimeString()}</span>
      </div>
      {a.description && <div className="text-sm">{a.description}</div>}
      {a.command_preview && (
        <pre className="mt-2 text-xs font-mono p-2 bg-[var(--bg)] rounded-lg border border-line overflow-x-auto whitespace-pre-wrap">
          {a.command_preview}
        </pre>
      )}
    </div>
  );
}
