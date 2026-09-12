"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Agent, chat, composio, home, HomeData, HomeTile, RecentRun } from "@/lib/api";
import { cn } from "@/lib/cn";

// The one screen. Three things, top to bottom:
//   1. Your numbers  — one figure per connected app, plus Connect tiles for the rest
//   2. Tell your team — pick an AI employee, type what you need, read the reply
//   3. What happened  — the last few things agents did
// Everything else in the app still exists by URL. It is off the sidebar on purpose.

function ago(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Tile({ t, onConnect, busy }: { t: HomeTile; onConnect: (slug: string) => void; busy: boolean }) {
  if (!t.connected) {
    return (
      <button
        onClick={() => onConnect(t.toolkit)}
        disabled={busy}
        className="card card-hover p-5 text-left flex flex-col gap-2 border-dashed disabled:opacity-50"
      >
        <div className="text-2xl">{t.icon}</div>
        <div className="text-sm font-medium">{t.name}</div>
        <div className="text-xs text-accent font-medium">Connect</div>
      </button>
    );
  }
  return (
    <div className="card p-5 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{t.icon}</span>
        <span>{t.name}</span>
      </div>
      <div className={cn("text-3xl font-semibold tabular mt-1", t.value == null && "text-muted text-base")}>
        {t.value ?? "No number yet"}
      </div>
      <div className="text-xs text-muted">{t.value != null ? t.label : t.hint}</div>
      {t.value != null && t.hint && <div className="text-[11px] text-muted/80">{t.hint}</div>}
    </div>
  );
}

export default function HomePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["home"], queryFn: () => home.get(false), refetchInterval: 60_000 });
  const refresh = useMutation({
    mutationFn: () => home.get(true),
    onSuccess: (d) => qc.setQueryData(["home"], d),
  });

  // --- connect an app (managed OAuth popup) ---------------------------------
  const [connecting, setConnecting] = useState(false);
  async function connect(slug: string) {
    // Open the window synchronously so the browser does not block it as a popup.
    const popup = window.open("about:blank", "_blank");
    setConnecting(true);
    try {
      const r = await composio.connect(slug);
      if (popup && r.redirect_url) popup.location.href = r.redirect_url;
      else if (popup) popup.close();
      if (!r.redirect_url) alert(`${slug} needs an API key. Add it under Apps.`);
    } catch (e) {
      popup?.close();
      alert(`Couldn't start the connection: ${(e as Error).message}`);
    } finally {
      setConnecting(false);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["home"] }), 4000);
    }
  }

  // --- command an agent -------------------------------------------------------
  const agents: Agent[] = q.data?.agents ?? [];
  const [agentId, setAgentId] = useState<string>("");
  const [text, setText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!agentId && agents.length) setAgentId(agents.find((a) => a.id === "boss")?.id ?? agents[0].id);
  }, [agents, agentId]);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  async function send() {
    const content = text.trim();
    if (!content || !agentId) return;
    setErr(null); setReply(null); setRunning(true);
    try {
      let tid = threadId;
      if (!tid) {
        const existing = await chat.threads(agentId);
        tid = existing.items[0]?.id ?? (await chat.create({ agent_id: agentId, title: "Home" })).id;
        setThreadId(tid);
      }
      await chat.send(tid, content);
      setText("");
      const started = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const m = await chat.messages(tid!);
          const last = [...m.messages].reverse().find((x) => x.role === "assistant" && x.content);
          if (last) setReply(last.content);
          if (!m.running || Date.now() - started > 10 * 60_000) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setRunning(false);
            if (!last) setErr("No reply came back. Is your model key set under Apps?");
            qc.invalidateQueries({ queryKey: ["home"] });
          }
        } catch (e) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setRunning(false);
          setErr((e as Error).message);
        }
      }, 1500);
    } catch (e) {
      setRunning(false);
      setErr((e as Error).message);
    }
  }

  if (q.isLoading) return <div className="text-sm text-muted">Loading…</div>;
  if (q.isError || !q.data)
    return <div className="text-sm text-bad">Can&apos;t reach the service. Is the bridge running on :8787?</div>;

  const d: HomeData = q.data;
  const biz = d.client.business_name || "Your business";
  const needsSetup = !d.setup.llm_ready || !d.setup.composio_configured;
  const tiles = [...d.metrics, ...d.suggestions];
  const selected = agents.find((a) => a.id === agentId);

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{biz}</h1>
          <p className="text-sm text-muted mt-1">{d.client.one_liner || "Your apps, your numbers, your AI employees. One screen."}</p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="btn-ghost flex items-center gap-2 text-xs"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refresh.isPending && "animate-spin")} /> Refresh numbers
        </button>
      </div>

      {needsSetup && (
        <div className="card p-5 border-warn/40 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium">Two keys and you&apos;re live</div>
            <div className="text-xs text-muted mt-1">
              {!d.setup.llm_ready && "A model key (OpenRouter) so your AI employees can think. "}
              {!d.setup.composio_configured && "A Composio key so they can use your apps."}
            </div>
          </div>
          <Link href="/integrations" className="btn-primary text-sm text-center">Add keys</Link>
        </div>
      )}

      {/* 1. Your numbers */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg">Your numbers</h2>
          <Link href="/integrations" className="text-xs text-muted hover:text-ink">All apps</Link>
        </div>
        {tiles.length === 0 ? (
          <div className="card p-6 text-sm text-muted">Add your Composio key, then connect Gmail, Stripe, HubSpot and the rest. Each one shows up here as a number.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {tiles.map((t) => <Tile key={t.toolkit} t={t} onConnect={connect} busy={connecting} />)}
          </div>
        )}
      </section>

      {/* 2. Tell your team */}
      <section>
        <h2 className="text-lg mb-3">Tell your team</h2>
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => { setAgentId(a.id); setThreadId(null); setReply(null); setErr(null); }}
                className={cn("chip text-xs py-1.5 px-3 transition", a.id === agentId && "chip-accent border-accent/40")}
                title={a.role}
              >
                <span>{a.icon}</span> {a.name}
              </button>
            ))}
            {agents.length === 0 && <span className="text-xs text-muted">No AI employees yet.</span>}
          </div>
          {selected && <div className="text-xs text-muted">{selected.description || selected.role}</div>}
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={2}
              placeholder={selected ? `What do you need ${selected.name} to do?` : "What do you need done?"}
              className="flex-1 px-4 py-3 text-sm rounded-xl border border-line bg-surface-2 focus:outline-none focus:border-accent resize-none"
            />
            <button onClick={send} disabled={running || !text.trim() || !agentId} className="btn-primary flex items-center gap-2 self-end">
              <Send className="w-4 h-4" /> {running ? "Working…" : "Send"}
            </button>
          </div>
          {running && !reply && <div className="text-xs text-muted animate-pulse">{selected?.name ?? "Agent"} is on it…</div>}
          {reply && <div className="card-inset p-4 text-sm whitespace-pre-wrap">{reply}</div>}
          {err && <div className="text-xs text-bad">{err}</div>}
        </div>
      </section>

      {/* 3. What happened */}
      <section>
        <h2 className="text-lg mb-3">What happened</h2>
        {d.recent.length === 0 ? (
          <div className="card p-6 text-sm text-muted">Nothing yet. Send the first instruction above.</div>
        ) : (
          <div className="card divide-y divide-line">
            {d.recent.map((r: RecentRun) => {
              const a = agents.find((x) => x.id === r.agent_id);
              return (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="text-lg">{a?.icon ?? "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.title || "Untitled"}</div>
                    <div className="text-xs text-muted">{a?.name ?? r.source ?? "Agent"} · {ago(r.started_at)}{r.outcome ? ` · ${r.outcome}` : ""}</div>
                  </div>
                  {r.cost_usd != null && <div className="text-xs text-muted tabular">${r.cost_usd.toFixed(3)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
