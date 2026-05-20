"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

interface SettingsResponse {
  persistence?: { persistent: boolean | null };
}

interface CapabilitiesResponse {
  llm_ready?: boolean;
}

// Surfaces critical configuration problems that an operator cannot work
// around in the UI — they need their agency to flip a Railway env var.
// One banner; whichever issue is most severe wins (ephemeral > no LLM).
export function PersistenceBanner() {
  const [ephemeral, setEphemeral] = useState(false);
  const [llmMissing, setLlmMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/capabilities", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (sRes.ok) {
          const s: SettingsResponse = await sRes.json();
          setEphemeral(s.persistence?.persistent === false);
        }
        if (cRes.ok) {
          const c: CapabilitiesResponse = await cRes.json();
          setLlmMissing(c.llm_ready === false);
        }
      } catch {
        // ignore transient errors
      }
    }
    check();
    const t = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (ephemeral) {
    return (
      <Bar>
        <strong>Your data isn&apos;t being saved.</strong> Agents, conversations,
        triggers and secrets will be wiped on the next redeploy. Ask your team
        to mount a Railway Volume at <code className="font-mono bg-black/20 px-1 rounded">/data</code>.
      </Bar>
    );
  }
  if (llmMissing) {
    return (
      <Bar>
        <strong>No AI model connected.</strong> Your agents can&apos;t chat or run
        until your team adds an <code className="font-mono bg-black/20 px-1 rounded">OPENROUTER_API_KEY</code> (recommended),
        Anthropic, or OpenAI key in Railway. One quick message to them and you&apos;re back online.
      </Bar>
    );
  }
  return null;
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bad text-white px-4 py-2.5 text-sm flex items-center gap-3 border-b border-black/10">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
