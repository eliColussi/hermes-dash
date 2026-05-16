"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

interface HealthResponse {
  persistence?: {
    persistent: boolean | null;
    data_root: string;
    remediation: string | null;
  };
}

// Polls /api/health every 60s. If the bridge reports that data isn't on a
// real volume, slam a non-dismissable warning across the top of the app.
// The whole point is that the operator cannot miss this — losing the agent
// they spent an hour building is exactly the failure mode we're guarding
// against.
export function PersistenceBanner() {
  const [state, setState] = useState<"loading" | "ok" | "ephemeral" | "unknown">("loading");

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) return;
        const data: HealthResponse = await r.json();
        if (cancelled) return;
        const p = data.persistence?.persistent;
        setState(p === true ? "ok" : p === false ? "ephemeral" : "unknown");
      } catch {
        // network blip — keep last state
      }
    }
    fetchHealth();
    const t = setInterval(fetchHealth, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (state !== "ephemeral") return null;

  return (
    <div className="bg-bad text-white px-4 py-2.5 text-sm flex items-center gap-3 border-b border-black/10">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <strong>Your data isn&apos;t being saved.</strong> Agents, conversations,
        triggers and secrets will be wiped on the next redeploy. Ask your team
        to mount a Railway Volume at <code className="font-mono bg-black/20 px-1 rounded">/data</code>.
      </div>
    </div>
  );
}
