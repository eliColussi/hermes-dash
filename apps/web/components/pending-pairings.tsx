"use client";

/**
 * Pending bot-pairing banner.
 *
 * HERMÉS default-denies messages from unknown users on every chat platform —
 * Telegram/Slack/Discord/etc. all show new users a one-time pairing code
 * (e.g. WDUK52WP) and refuse to talk until the operator approves it.
 *
 * Without this banner, that approval requires SSH'ing into the container and
 * running `hermes pairing approve telegram <code>`. With it, the operator
 * sees who's waiting and approves with one click — no terminal, no restart.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { api, PairingPending } from "@/lib/api";

const PLATFORM_ICONS: Record<string, string> = {
  telegram: "✈️",
  slack: "💬",
  discord: "🎮",
  mattermost: "🛰️",
  whatsapp: "🟢",
};

export function PendingPairingsBanner() {
  const qc = useQueryClient();
  // Poll every 8s so a new pairing request shows up on the dashboard within
  // a few seconds of a user messaging the bot. Cheap — the endpoint just
  // walks a small JSON file under HERMES_HOME/platforms/pairing.
  const q = useQuery({
    queryKey: ["pending-pairings"],
    queryFn: api.listPendingPairings,
    refetchInterval: 8000,
    // Don't loud-fail in the console if the bridge can't import HERMÉS —
    // the manual approval fallback below still works either way.
    retry: false,
  });

  const items = q.data?.items ?? [];
  const hasItems = items.length > 0;

  if (q.isLoading) return null;

  return (
    <div className="mb-4">
      {hasItems && (
        <div className="card p-4 border-accent/40 bg-accent-soft/40 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <UserPlus className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium">
              {items.length === 1
                ? "Someone is trying to talk to your bot"
                : `${items.length} people are trying to talk to your bot`}
            </span>
          </div>
          <div className="space-y-2">
            {items.map((p) => (
              <PendingRow
                key={`${p.platform}-${p.code}`}
                p={p}
                onApproved={() =>
                  qc.invalidateQueries({ queryKey: ["pending-pairings"] })
                }
              />
            ))}
          </div>
          <p className="text-[11px] text-muted mt-3">
            Bots only respond to people you&apos;ve approved. Anyone else gets a
            pairing code in their first message and has to wait here.
          </p>
        </div>
      )}
      <ManualApproveCard />
    </div>
  );
}

// Manual fallback: paste a code from the bot's message directly. Works even
// when the listing endpoint is empty / unreachable, which is the situation
// the operator is in if their gateway issued a code but the bridge can't
// read it back for any reason. Bypasses the "show me what's pending" step
// entirely.
function ManualApproveCard() {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState("telegram");
  const [code, setCode] = useState("");
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: () => api.approvePairing(platform, code),
    onSuccess: (res) => {
      setOkMsg(`Approved ${res.user_name || res.user_id} on ${platform}.`);
      setCode("");
      qc.invalidateQueries({ queryKey: ["pending-pairings"] });
    },
  });

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="text-[11px] text-muted">
        Got a pairing code from your bot? Paste it here to approve.
      </div>
      <div className="flex gap-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-line bg-[var(--bg)]"
        >
          {Object.keys(PLATFORM_ICONS).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
          placeholder="e.g. WDUK52WP"
          className="flex-1 px-2 py-1.5 text-xs font-mono rounded-lg border border-line bg-[var(--bg)] uppercase"
          maxLength={20}
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button
          onClick={() => approve.mutate()}
          disabled={approve.isPending || code.length < 4}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
      </div>
      {okMsg && <div className="text-[11px] text-ok">{okMsg}</div>}
      {approve.error && (
        <div className="text-[11px] text-red-600">
          {(approve.error as Error).message}
        </div>
      )}
    </div>
  );
}

function PendingRow({
  p,
  onApproved,
}: {
  p: PairingPending;
  onApproved: () => void;
}) {
  const [done, setDone] = useState(false);
  const approve = useMutation({
    mutationFn: () => api.approvePairing(p.platform, p.code),
    onSuccess: () => {
      setDone(true);
      // Keep the row visible for 1s as feedback before it disappears.
      setTimeout(onApproved, 1000);
    },
  });

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-line bg-[var(--bg)]">
      <span className="text-xl shrink-0">
        {PLATFORM_ICONS[p.platform] ?? "💬"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {p.user_name || p.user_id || "Unknown user"}
        </div>
        <div className="text-[11px] text-muted">
          on {p.platform} · code{" "}
          <code className="font-mono">{p.code}</code>
        </div>
      </div>
      {done ? (
        <span className="flex items-center gap-1 text-xs text-ok">
          <Check className="w-3.5 h-3.5" /> Approved
        </span>
      ) : (
        <button
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
      )}
      {approve.error && (
        <span className="text-[10px] text-red-600 ml-2 max-w-[140px]">
          {(approve.error as Error).message}
        </span>
      )}
    </div>
  );
}
