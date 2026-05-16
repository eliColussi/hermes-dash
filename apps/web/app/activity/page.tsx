"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AuditEntry, api, audit } from "@/lib/api";

type View = "sessions" | "audit";

const EVENT_BADGE: Record<string, string> = {
  session_start: "bg-accent-soft text-accent",
  session_end: "bg-surface-3 text-ink-2",
  tool_call: "bg-surface-3 text-ink-2",
  approval_requested: "bg-surface-3 text-warn",
  approval_responded: "bg-accent-soft text-ok",
};

export default function ActivityPage() {
  const [view, setView] = useState<View>("sessions");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted mt-1">
            {view === "sessions"
              ? "What your agents have been doing."
              : "Every step an agent took, in order."}
          </p>
        </div>
        <div className="flex p-1 bg-[var(--bg)] border border-line rounded-lg text-sm">
          <ViewToggle current={view} option="sessions" onChange={setView}>
            Conversations
          </ViewToggle>
          <ViewToggle current={view} option="audit" onChange={setView}>
            History
          </ViewToggle>
        </div>
      </div>

      {view === "sessions" ? <SessionsTable /> : <AuditTable />}
    </div>
  );
}

function ViewToggle({
  current,
  option,
  onChange,
  children,
}: {
  current: View;
  option: View;
  onChange: (v: View) => void;
  children: React.ReactNode;
}) {
  const active = current === option;
  return (
    <button
      onClick={() => onChange(option)}
      className={`px-3 py-1.5 rounded-md transition ${
        active ? "bg-white dark:bg-[var(--surface)] shadow-sm" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function SessionsTable() {
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(100) });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg)] text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3">Source</th>
              <th className="text-left px-4 py-3">Model</th>
              <th className="text-right px-4 py-3">Msgs</th>
              <th className="text-right px-4 py-3">Tools</th>
              <th className="text-right px-4 py-3">Cost</th>
              <th className="text-left px-4 py-3">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(q.data ?? []).map((a) => (
              <tr
                key={a.session_id}
                onClick={() => setOpenId(a.session_id)}
                className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3">{a.title ?? a.session_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{a.source}</td>
                <td className="px-4 py-3 text-muted">{a.model ?? "—"}</td>
                <td className="px-4 py-3 text-right">{a.message_count}</td>
                <td className="px-4 py-3 text-right">{a.tool_call_count}</td>
                <td className="px-4 py-3 text-right">
                  {a.cost_usd != null ? `$${a.cost_usd.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-3 text-muted">
                  {new Date(a.started_at * 1000).toLocaleString()}
                </td>
              </tr>
            ))}
            {(q.data ?? []).length === 0 && !q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {openId && <SessionDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SessionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["session-detail", id],
    queryFn: () => api.activitySession(id),
  });

  const session = q.data?.session as Record<string, string | number | null> | undefined;
  const messages = q.data?.messages ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] h-full bg-[var(--surface)] border-l border-line flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div className="min-w-0">
            <div className="font-semibold truncate">
              {(session?.title as string) || id}
            </div>
            <div className="text-xs text-muted mt-1">
              {session?.source as string} · {session?.model as string ?? "—"} ·{" "}
              {messages.length} messages
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="p-4 border-b border-line grid grid-cols-2 gap-2 text-xs">
          {session &&
            (["estimated_cost_usd", "actual_cost_usd", "input_tokens", "output_tokens", "tool_call_count", "message_count"] as const).map(
              (k) => (
                <div key={k}>
                  <span className="text-muted">{k}: </span>
                  <span className="font-mono">{String((session as Record<string, unknown>)[k] ?? "—")}</span>
                </div>
              ),
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {q.isLoading && <div className="text-sm text-muted">Loading…</div>}
          {messages.map((m) => (
            <div key={m.id} className="text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    m.role === "user"
                      ? "bg-accent-soft text-accent"
                      : m.role === "assistant"
                      ? "bg-surface-3 text-ink-2"
                      : m.role === "tool"
                      ? "bg-surface-3 text-warn"
                      : "bg-surface-3 text-muted"
                  }`}
                >
                  {m.role}
                </span>
                {m.tool_name && (
                  <code className="text-[10px] text-muted">{m.tool_name}</code>
                )}
                <span className="text-[10px] text-muted ml-auto">
                  {new Date(m.timestamp * 1000).toLocaleTimeString()}
                </span>
              </div>
              {m.content && (
                <pre className="whitespace-pre-wrap break-words font-mono p-2 bg-[var(--bg)] rounded border border-line">
                  {m.content}
                </pre>
              )}
              {m.reasoning && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted cursor-pointer">reasoning</summary>
                  <pre className="whitespace-pre-wrap break-words font-mono p-2 mt-1 bg-[var(--bg)] rounded border border-line text-muted">
                    {m.reasoning}
                  </pre>
                </details>
              )}
            </div>
          ))}
          {!q.isLoading && messages.length === 0 && (
            <div className="text-sm text-muted">No messages on this session.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditTable() {
  const days = useQuery({ queryKey: ["audit-days"], queryFn: audit.days });
  const [date, setDate] = useState<string | undefined>(undefined);
  const [eventFilter, setEventFilter] = useState<string>("");
  const q = useQuery({
    queryKey: ["audit", date, eventFilter],
    queryFn: () =>
      audit.list({ date, limit: 200, event: eventFilter || undefined }),
    refetchInterval: 3000,
  });

  return (
    <>
      <div className="flex gap-2 mb-3 flex-wrap">
        <select
          value={date ?? ""}
          onChange={(e) => setDate(e.target.value || undefined)}
          className="px-3 py-1.5 text-sm rounded-lg border border-line bg-[var(--surface)]"
        >
          <option value="">Today</option>
          {(days.data?.days ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-line bg-[var(--surface)]"
        >
          <option value="">All events</option>
          <option value="session_start">session_start</option>
          <option value="session_end">session_end</option>
          <option value="tool_call">tool_call</option>
          <option value="approval_requested">approval_requested</option>
          <option value="approval_responded">approval_responded</option>
        </select>
        <span className="text-xs text-muted self-center ml-auto">
          {q.data?.count ?? 0} events · auto-refresh
        </span>
      </div>
      <div className="card overflow-hidden">
        {(q.data?.items ?? []).length === 0 && !q.isLoading && (
          <div className="p-6 text-sm text-muted">
            No audit events for this day. The staffroom-audit plugin records
            every session/tool/approval lifecycle event here.
          </div>
        )}
        <ul className="divide-y divide-line">
          {(q.data?.items ?? []).slice().reverse().map((e, i) => (
            <AuditRow key={i} entry={e} />
          ))}
        </ul>
      </div>
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const badge = EVENT_BADGE[entry.event] ?? "bg-gray-50 text-gray-600";
  const time = new Date(entry.ts).toLocaleTimeString();
  const { ts, event, ...rest } = entry;
  return (
    <li className="px-4 py-3 flex items-start gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
      <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${badge} whitespace-nowrap`}>
        {event}
      </span>
      <div className="flex-1 min-w-0">
        <pre className="text-xs text-muted whitespace-pre-wrap break-words font-mono">
          {JSON.stringify(rest, null, 0)}
        </pre>
      </div>
      <span className="text-[10px] text-muted whitespace-nowrap">{time}</span>
    </li>
  );
}
