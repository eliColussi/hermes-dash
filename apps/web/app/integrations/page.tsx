"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { ChannelSetupSection } from "@/components/channel-setup";
import { ComposioPanel } from "@/components/composio-panel";
import { PendingPairingsBanner } from "@/components/pending-pairings";

export default function ConnectionsPage() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: api.integrations });

  const providers = q.data?.integrations ?? [];

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
      <p className="text-sm text-muted mt-1 mb-6">
        Apps your agents can read, write, and act on.
      </p>

      <PendingPairingsBanner />

      <ChannelSetupSection />

      <ComposioPanel />

      <div className="card p-5">
        <div className="text-sm font-medium mb-1">Provider status</div>
        <p className="text-xs text-muted mb-4">
          The brains and messaging providers your agents use. Managed by your team.
          Need anything changed? Send a message.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {providers.map((p) => {
            const configured = p.configured;
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-line bg-[var(--bg)]"
              >
                <div className="text-xl">{p.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.label}</div>
                  <div className="text-[10px] text-muted">
                    {configured ? "Active" : "Not active"}
                  </div>
                </div>
                {configured ? (
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-soft text-ok"
                    title="Configured"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </span>
                ) : (
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--surface)] text-muted border border-line"
                    title="Not configured"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
