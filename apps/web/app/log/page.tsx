"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export default function LogPage() {
  const files = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (files.data && !selected && files.data.files[0]) {
      setSelected(files.data.files[0].name);
    }
  }, [files.data, selected]);

  const tail = useQuery({
    queryKey: ["tail", selected],
    queryFn: () => api.tailLog(selected!, 500),
    enabled: !!selected,
    refetchInterval: 2000,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [tail.data]);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Log</h1>
      <p className="text-sm text-muted mt-1 mb-6">Live tail of HERMÉS + agent logs (polled every 2s).</p>

      <div className="flex gap-3 mb-4 flex-wrap">
        {(files.data?.files ?? []).map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              selected === f.name ? "border-accent bg-accent-soft" : "border-line"
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
        {(tail.data?.lines ?? []).length === 0 && (
          <div className="text-muted">Waiting for output…</div>
        )}
        {(tail.data?.lines ?? []).map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
