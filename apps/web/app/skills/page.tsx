"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

export default function SkillsPage() {
  const q = useQuery({ queryKey: ["skills"], queryFn: api.skills });
  const [filter, setFilter] = useState("");

  const skills = (q.data ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase()) ||
      s.category.toLowerCase().includes(filter.toLowerCase()),
  );

  const grouped = skills.reduce<Record<string, typeof skills>>((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Skills</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Skills your agents can call on. {skills.length} installed.
      </p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        className="w-full max-w-md mb-6 px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm"
      />

      <div className="space-y-8">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">{cat}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((s) => (
                <div key={`${s.category}/${s.name}`} className="card p-4">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted line-clamp-2 mt-1">{s.description}</div>
                  {s.version && (
                    <div className="text-[10px] text-muted mt-2">v{s.version}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {q.isLoading && <div className="text-sm text-muted">Loading…</div>}
      </div>
    </div>
  );
}
