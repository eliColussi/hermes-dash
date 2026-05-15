"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function ActivityPage() {
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(100) });

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
      <p className="text-sm text-muted mt-1 mb-6">Recent HERMÉS sessions.</p>

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
              <tr key={a.session_id}>
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
                  No sessions yet. Start an agent or run `hermes chat` to populate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
