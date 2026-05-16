"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plug, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ComposioToolkit, composio } from "@/lib/api";

// Slugs we float to the top of the picker when the search box is empty.
// Anything not in this list still appears in the grid below it.
const FEATURED = [
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
    staleTime: 10 * 60 * 1000, // catalog rarely changes; cache for 10 min
  });
  const connections = useQuery({
    queryKey: ["composio-connections"],
    queryFn: composio.connections,
    enabled: status.data?.configured === true,
    refetchInterval: 5000,
  });

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

  if (status.isLoading) return null;

  if (!status.data?.configured) {
    return (
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <Plug className="w-5 h-5 text-accent" />
          <div className="font-medium">Apps</div>
        </div>
        <div className="text-sm text-muted">
          Your team needs to activate this. Send them a message and they&apos;ll
          have you connecting Gmail, Slack, Stripe, HubSpot, and 250+ other
          apps in a few minutes.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 font-medium text-base">
            <Plug className="w-5 h-5 text-accent" />
            Apps
            <span className="chip chip-accent text-[10px] ml-1">Active</span>
          </div>
          <div className="text-xs text-muted mt-1">
            Connect Gmail, Slack, Stripe — over a thousand apps your agents can
            read, write and act on.
          </div>
        </div>
        <button onClick={() => setPicker(true)} className="btn-primary">
          + Connect app
        </button>
      </div>

      {/* Connected apps */}
      <div className="mt-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted mb-2">
          Connected ({connections.data?.items.length ?? 0})
        </div>
        {(connections.data?.items.length ?? 0) === 0 ? (
          <div className="text-sm text-muted py-3">
            Nothing connected yet. Click <strong>+ Connect app</strong> to start.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(connections.data?.items ?? []).map((c) => {
              const logo = `https://logos.composio.dev/api/${c.toolkit}`;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-line bg-surface-2"
                >
                  <ToolkitLogo slug={c.toolkit} src={logo} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate capitalize">{c.toolkit}</div>
                    <div className="text-[10px] text-muted">{c.status}</div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Disconnect ${c.toolkit}?`))
                        disconnectMut.mutate(c.id);
                    }}
                    className="p-1.5 hover:bg-surface-3 text-bad rounded"
                    title="Disconnect"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {picker && (
        <ToolkitPicker
          toolkits={toolkits.data?.items ?? []}
          loading={toolkits.isLoading}
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
  connecting,
  connectedSlugs,
  onConnect,
  onClose,
}: {
  toolkits: ComposioToolkit[];
  loading: boolean;
  connecting: string | null;
  connectedSlugs: Set<string>;
  onConnect: (slug: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  // Always render the entire catalog. When the search box is empty, sort
  // featured apps to the top; otherwise alphabetical filter on slug+name.
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = toolkits;
    if (!q) {
      const featuredSet = new Set(FEATURED);
      const featured = FEATURED
        .map((s) => all.find((t) => t.slug === s))
        .filter((t): t is ComposioToolkit => !!t);
      const rest = all
        .filter((t) => !featuredSet.has(t.slug))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [...featured, ...rest];
    }
    return all
      .filter((t) => t.slug.includes(q) || t.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [toolkits, search]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-line rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <div className="font-display text-xl tracking-tight">Connect an app</div>
            <div className="text-xs text-muted mt-1">
              {toolkits.length > 0
                ? `Pick from ${toolkits.length.toLocaleString()} apps. You'll be sent to authorize it.`
                : "Loading apps…"}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-3 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-line">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="input"
            autoFocus
          />
          {search && (
            <div className="text-[10px] text-muted mt-2">
              {list.length.toLocaleString()} matches
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-sm text-muted">Loading…</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {list.map((t) => {
              const isConnected = connectedSlugs.has(t.slug);
              const isConnecting = connecting === t.slug;
              return (
                <button
                  key={t.slug}
                  disabled={isConnecting}
                  onClick={() => onConnect(t.slug)}
                  className="group flex items-center gap-3 p-3 rounded-xl border border-line bg-surface hover:border-accent/40 hover:bg-accent-soft/40 transition text-left disabled:opacity-50"
                  title={t.description || t.name}
                >
                  <ToolkitLogo slug={t.slug} src={t.logo} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-muted truncate">
                      {isConnecting ? "Opening…" : t.slug}
                    </div>
                  </div>
                  {isConnected && (
                    <Check className="w-3.5 h-3.5 text-ok shrink-0" />
                  )}
                </button>
              );
            })}
            {!loading && list.length === 0 && (
              <div className="text-sm text-muted col-span-full py-6 text-center">
                No matching apps.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolkitLogo({ slug, src, size }: { slug: string; src: string; size: number }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div
        className="rounded-md bg-surface-3 border border-line flex items-center justify-center text-[10px] uppercase font-semibold text-muted shrink-0"
        style={{ width: size, height: size }}
      >
        {slug.slice(0, 2)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={slug}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className="rounded-md bg-white border border-line shrink-0 object-contain p-0.5"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
