"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Plug, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ComposioToolkit, composio } from "@/lib/api";

// Popular toolkits we promote in the "Connect a new app" picker. Anything not
// in this list is still reachable via the search field.
const POPULAR = [
  "gmail", "googlecalendar", "googledrive", "slack", "notion", "github",
  "linear", "hubspot", "stripe", "calendly", "airtable", "asana",
  "trello", "zoom", "discord", "intercom", "salesforce", "shopify",
];

export function ComposioPanel() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["composio-status"], queryFn: composio.status });
  const toolkits = useQuery({
    queryKey: ["composio-toolkits"],
    queryFn: composio.toolkits,
    enabled: status.data?.configured === true,
  });
  const connections = useQuery({
    queryKey: ["composio-connections"],
    queryFn: composio.connections,
    enabled: status.data?.configured === true,
    refetchInterval: 5000, // pick up new OAuth completions automatically
  });

  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);

  const connectMut = useMutation({
    mutationFn: composio.connect,
    onSuccess: (data) => {
      if (data.redirect_url) {
        window.open(data.redirect_url, "_blank", "noopener");
      }
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["composio-connections"] }),
        2000,
      );
    },
  });

  const disconnectMut = useMutation({
    mutationFn: composio.disconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["composio-connections"] }),
  });

  const filtered = useMemo(() => {
    const list = toolkits.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) {
      const popMap = new Map(POPULAR.map((s, i) => [s, i]));
      return [...list]
        .filter((t) => popMap.has(t.slug))
        .sort((a, b) => (popMap.get(a.slug) ?? 99) - (popMap.get(b.slug) ?? 99));
    }
    return list.filter(
      (t) => t.slug.includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [toolkits.data, search]);

  if (status.isLoading) return null;

  if (!status.data?.configured) {
    return (
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <Plug className="w-5 h-5 text-blue-600" />
          <div className="font-medium">Composio (250+ apps)</div>
        </div>
        <div className="text-sm text-muted">
          Set <code>COMPOSIO_API_KEY</code> in your Railway environment to
          connect Gmail, Slack, Stripe, HubSpot, and 250+ other apps without
          writing adapters. The key unlocks every toolkit at once.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <Plug className="w-5 h-5 text-blue-600" />
            Composio
            <span className="text-xs text-green-600 ml-1">✓ Connected</span>
          </div>
          <div className="text-xs text-muted mt-1">
            User: <code>{status.data.user_id}</code> · Click Connect to add an
            app; you'll be redirected to Composio's OAuth flow.
          </div>
        </div>
        <button
          onClick={() => setPicker(true)}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white"
        >
          + Connect app
        </button>
      </div>

      {/* Connected apps */}
      <div className="mt-4">
        <div className="text-xs uppercase text-muted mb-2 tracking-wider">
          Connected ({connections.data?.items.length ?? 0})
        </div>
        {(connections.data?.items.length ?? 0) === 0 ? (
          <div className="text-sm text-muted py-3">
            No apps connected yet. Click <strong>+ Connect app</strong> to start.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(connections.data?.items ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-line bg-[var(--bg)]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.toolkit}</div>
                  <div className="text-[10px] text-muted">
                    {c.status} · {c.id.slice(0, 12)}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Disconnect ${c.toolkit}?`))
                      disconnectMut.mutate(c.id);
                  }}
                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950 text-red-600 rounded"
                  title="Disconnect"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {picker && (
        <ToolkitPicker
          toolkits={filtered}
          loading={toolkits.isLoading}
          search={search}
          onSearchChange={setSearch}
          connecting={connectMut.isPending ? connectMut.variables ?? null : null}
          onClose={() => setPicker(false)}
          onConnect={(slug) => connectMut.mutate(slug)}
          connectedSlugs={new Set((connections.data?.items ?? []).map((c) => c.toolkit))}
        />
      )}
    </div>
  );
}

function ToolkitPicker({
  toolkits,
  loading,
  search,
  onSearchChange,
  connecting,
  connectedSlugs,
  onConnect,
  onClose,
}: {
  toolkits: ComposioToolkit[];
  loading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  connecting: string | null;
  connectedSlugs: Set<string>;
  onConnect: (slug: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-line rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <div className="font-semibold">Connect an app</div>
            <div className="text-xs text-muted mt-1">
              Pick a toolkit. You'll be sent to Composio to authorize it.
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-line">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search all 250+ apps…"
            className="w-full px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
            autoFocus
          />
          {!search && (
            <div className="text-[10px] text-muted mt-1">
              Showing popular apps. Type to search the full catalog.
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-sm text-muted">Loading…</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {toolkits.map((t) => {
              const isConnected = connectedSlugs.has(t.slug);
              const isConnecting = connecting === t.slug;
              return (
                <button
                  key={t.slug}
                  disabled={isConnecting}
                  onClick={() => onConnect(t.slug)}
                  className="flex flex-col items-start gap-1 p-3 rounded-lg border border-line hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/40 transition text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 w-full">
                    {t.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.logo} alt="" className="w-5 h-5 rounded" />
                    ) : (
                      <Plug className="w-4 h-4 text-muted" />
                    )}
                    <span className="text-sm font-medium flex-1 truncate">{t.name}</span>
                    {isConnected && <Check className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <div className="text-[10px] text-muted flex items-center gap-1">
                    {isConnecting ? (
                      "Opening OAuth…"
                    ) : (
                      <>
                        Connect <ExternalLink className="w-2.5 h-2.5" />
                      </>
                    )}
                  </div>
                </button>
              );
            })}
            {!loading && toolkits.length === 0 && (
              <div className="text-sm text-muted col-span-full py-6 text-center">
                No matching toolkits.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
