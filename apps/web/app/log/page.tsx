"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export default function LogPage() {
  const files = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (files.data && !selected && files.data.files[0]) {
      setSelected(files.data.files[0].name);
    }
  }, [files.data, selected]);

  useEffect(() => {
    if (!selected) return;
    setLines([]);

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/logs/stream?name=${encodeURIComponent(selected)}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.line !== undefined) setLines((prev) => [...prev.slice(-1000), msg.line]);
      } catch {}
    };

    return () => ws.close();
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Log</h1>
      <p className="text-sm text-muted mt-1 mb-6">Live tail of HERMÉS + agent logs.</p>

      <div className="flex gap-3 mb-4 flex-wrap">
        {(files.data?.files ?? []).map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              selected === f.name ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-line"
            }`}
          >
            {f.name}
          </button>
        ))}
        {(files.data?.files ?? []).length === 0 && (
          <span className="text-sm text-muted">No log files yet.</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="card font-mono text-xs p-4 h-[60vh] overflow-y-auto bg-[var(--bg)]"
      >
        {lines.length === 0 && <div className="text-muted">Waiting for output…</div>}
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
