"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Plug, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ComposioAuthField, ComposioToolkit, composio } from "@/lib/api";

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
  // When a toolkit needs API-key / bearer / basic creds we show this modal
  // populated with fields the bridge discovered from Composio's catalog.
  const [credForm, setCredForm] = useState<{
    slug: string;
    schemeName: string;
    authScheme: string;
    fields: ComposioAuthField[];
    authHintUrl: string | null;
  } | null>(null);
  // Last connect-attempt error. Shown inline on the picker — alert() was
  // unreliable on Mac Safari/Chrome (flashed and dismissed before operators
  // could read it).
  const [lastError, setLastError] = useState<{ slug: string; message: string } | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Pick the best credential scheme from a list — prefer fewest required
  // fields so operators see the simplest path. Used both for the
  // "non-OAuth" branch and the OAuth-fallback branch below.
  function pickBestScheme(schemes: { mode: string; name: string; fields: ComposioAuthField[]; auth_hint_url: string | null }[]) {
    const sorted = [...schemes].sort(
      (a, b) =>
        a.fields.filter((f) => !f.optional).length -
        b.fields.filter((f) => !f.optional).length,
    );
    return sorted[0] ?? null;
  }

  // Start a connection. Decides between the one-click OAuth popup and the
  // credential-form modal by asking the bridge what the toolkit needs.
  // Opens about:blank SYNCHRONOUSLY so the browser doesn't block the popup
  // — async window.open after the fetch resolves gets killed by Chrome/
  // Safari's popup blocker.
  async function startConnect(slug: string) {
    setLastError(null);
    setBusySlug(slug);
    const popup = window.open("about:blank", "_blank");
    try {
      const info = await composio.authSchemes(slug);
      // Helper to fall through to the credential form whenever the OAuth
      // path can't actually complete. Composio sometimes lists schemes as
      // "managed" for the catalog but still requires custom credentials in
      // practice — we discover this only when the connect call returns no
      // redirect_url.
      const showCredForm = () => {
        const best = pickBestScheme(info.schemes || []);
        if (!best) {
          throw new Error(
            `${slug} uses an authentication method we don't support yet (likely service accounts or enterprise SSO). Send your team a message.`,
          );
        }
        setCredForm({
          slug,
          schemeName: best.name,
          authScheme: best.mode,
          fields: best.fields,
          authHintUrl: best.auth_hint_url,
        });
      };

      if (info.managed_oauth) {
        // Try the one-click OAuth path. If Composio rejects it (502) OR
        // returns no redirect_url, fall through to the credential form so
        // the operator sees something actionable instead of nothing.
        let resp: { redirect_url: string | null; connection_id: string } | null = null;
        try {
          resp = await composio.connect(slug);
        } catch (oauthErr) {
          // eslint-disable-next-line no-console
          console.error("composio managed-OAuth connect failed:", oauthErr);
          popup?.close();
          showCredForm();
          return;
        }
        if (popup && resp?.redirect_url) {
          popup.location.href = resp.redirect_url;
          setTimeout(
            () => qc.invalidateQueries({ queryKey: ["composio-connections"] }),
            2000,
          );
          return;
        }
        // OAuth said yes but gave us nothing to redirect to — treat as
        // requiring credentials.
        popup?.close();
        showCredForm();
        return;
      }
      // Non-OAuth — close the placeholder tab and show the credential form.
      popup?.close();
      showCredForm();
    } catch (err) {
      popup?.close();
      // eslint-disable-next-line no-console
      console.error("composio startConnect failed:", err);
      setLastError({ slug, message: (err as Error).message || String(err) });
    } finally {
      setBusySlug(null);
    }
  }

  const submitCredMut = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!credForm) throw new Error("No credential form open");
      return composio.connect(credForm.slug, {
        auth_scheme: credForm.authScheme,
        credentials: values,
      });
    },
    onSuccess: () => {
      setCredForm(null);
      qc.invalidateQueries({ queryKey: ["composio-connections"] });
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
          connecting={busySlug}
          lastError={lastError}
          onClose={() => setPicker(false)}
          onConnect={(slug) => {
            // We don't close the picker — startConnect either opens the OAuth
            // popup (operator sees both windows briefly) or opens our
            // credential modal on top.
            startConnect(slug);
          }}
          connectedSlugs={new Set((connections.data?.items ?? []).map((c) => c.toolkit))}
        />
      )}

      {credForm && (
        <CredentialFormModal
          slug={credForm.slug}
          schemeName={credForm.schemeName}
          fields={credForm.fields}
          authHintUrl={credForm.authHintUrl}
          submitting={submitCredMut.isPending}
          error={(submitCredMut.error as Error)?.message ?? null}
          onClose={() => setCredForm(null)}
          onSubmit={(values) => submitCredMut.mutate(values)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Credential form — used for API-key / bearer / basic-auth toolkits where
// the operator has to bring their own credential. Form auto-adapts to
// whatever fields Composio's catalog says are required for the toolkit.
// ──────────────────────────────────────────────────────────────────────
function CredentialFormModal({
  slug,
  schemeName,
  fields,
  authHintUrl,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  slug: string;
  schemeName: string;
  fields: ComposioAuthField[];
  authHintUrl: string | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.default ?? ""])),
  );
  const allRequiredFilled = fields
    .filter((f) => !f.optional)
    .every((f) => (values[f.name] ?? "").trim() !== "");

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-line rounded-2xl shadow-2xl max-w-md w-full"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <div className="font-display text-lg tracking-tight capitalize">
              Connect {slug}
            </div>
            <div className="text-xs text-muted mt-1">{schemeName}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-3 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {authHintUrl && (
            <a
              href={authHintUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Get your credentials here <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {fields.map((f) => (
            <label key={f.name} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">
                {f.label}
                {f.optional && (
                  <span className="text-[10px] ml-1 opacity-60">(optional)</span>
                )}
              </span>
              <input
                type={f.is_secret ? "password" : "text"}
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((p) => ({ ...p, [f.name]: e.target.value }))
                }
                className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {f.description && (
                <span className="text-[10px] text-muted">{f.description}</span>
              )}
            </label>
          ))}
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-line">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-line rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(values)}
            disabled={submitting || !allRequiredFilled}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolkitPicker({
  toolkits,
  loading,
  connecting,
  lastError,
  connectedSlugs,
  onConnect,
  onClose,
}: {
  toolkits: ComposioToolkit[];
  loading: boolean;
  connecting: string | null;
  lastError: { slug: string; message: string } | null;
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

        {lastError && (
          <div className="mx-4 mt-4 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
            <strong className="capitalize">{lastError.slug}</strong>: {lastError.message}
          </div>
        )}
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
