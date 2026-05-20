"use client";

/**
 * Channel setup walkthroughs — fifth-grade-language step-by-steps for
 * connecting Telegram / Slack / Discord. Operators paste their bot token
 * directly in the modal; we PUT to /api/integrations and offer a one-click
 * gateway restart so the new credentials take effect immediately.
 *
 * Platforms HERMÉS supports natively but that need real out-of-band
 * verification (WhatsApp Business, SMS via Twilio, Matrix, etc.) are
 * surfaced as "Advanced — ask your team" rather than walkthroughs, because
 * the setup is genuinely a multi-day process and a 5-step list would lie.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

// Each step is a short, plain-English sentence. Links open in a new tab.
// Token fields map to the same env-var keys the bridge already accepts.
interface ChannelDef {
  id: string;
  label: string;
  icon: string;
  tagline: string;
  estMinutes: number;
  steps: { text: string; link?: { label: string; href: string } }[];
  fields: { key: string; label: string; placeholder?: string; help?: string }[];
}

const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "✈️",
    tagline: "Chat with your agents from your phone. The easiest one.",
    estMinutes: 3,
    steps: [
      { text: "Open Telegram on your phone or desktop." },
      {
        text: "In the search bar, type @BotFather and tap the verified result.",
        link: { label: "Open BotFather", href: "https://t.me/BotFather" },
      },
      { text: 'Tap Start, then send /newbot. Pick a friendly name, then a username that ends in "bot" (like "acme_inbox_bot").' },
      { text: "BotFather sends you a long token. Tap it to copy. It looks like 1234567890:ABC-DEF..." },
      { text: "Paste the token below and click Save." },
      { text: "Open your bot's chat (search the username you picked), tap Start, and say hi." },
    ],
    fields: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Bot Token",
        placeholder: "1234567890:ABC-...",
        help: "The token BotFather sent you. Starts with a number, then a colon.",
      },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    icon: "💬",
    tagline: "Talk to your agents in a Slack DM or channel.",
    estMinutes: 10,
    steps: [
      {
        text: 'Go to api.slack.com/apps and click "Create New App" → "From scratch".',
        link: { label: "Open Slack apps", href: "https://api.slack.com/apps" },
      },
      { text: "Give it a name (like 'Staff Room Bot') and pick your workspace." },
      { text: 'In the sidebar, open "OAuth & Permissions". Scroll to Bot Token Scopes and add: chat:write, app_mentions:read, im:history, im:read, im:write.' },
      { text: 'In the sidebar, open "Socket Mode" and toggle it on. When prompted, generate an App-Level Token and check the connections:write scope. Copy the token (starts with xapp-).' },
      { text: 'In the sidebar, open "Event Subscriptions" and toggle it on. Under "Subscribe to bot events", add message.im and app_mention.' },
      { text: 'In the sidebar, open "Install App" → "Install to Workspace" → Allow. Copy the Bot Token (starts with xoxb-).' },
      { text: "Paste both tokens below and click Save." },
    ],
    fields: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Bot Token (xoxb-...)",
        placeholder: "xoxb-...",
        help: "From Install App. Starts with xoxb-.",
      },
      {
        key: "SLACK_APP_TOKEN",
        label: "App Token (xapp-...)",
        placeholder: "xapp-...",
        help: "From Socket Mode. Starts with xapp-.",
      },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    icon: "🎮",
    tagline: "Run an agent inside your Discord server.",
    estMinutes: 5,
    steps: [
      {
        text: 'Go to discord.com/developers/applications and click "New Application". Name it.',
        link: { label: "Open Discord developer portal", href: "https://discord.com/developers/applications" },
      },
      { text: "Click the Bot tab in the sidebar." },
      { text: 'Scroll to "Privileged Gateway Intents" and turn ON "Message Content Intent". Save.' },
      { text: 'Click "Reset Token" at the top, confirm, then copy the token immediately — Discord only shows it once.' },
      { text: "In the sidebar, click OAuth2 → URL Generator. Check 'bot' under Scopes. Under Bot Permissions check 'Send Messages' and 'Read Message History'." },
      { text: "Copy the generated URL at the bottom, open it in a new tab, pick your server, and click Authorize." },
      { text: "Paste the bot token below and click Save." },
    ],
    fields: [
      {
        key: "DISCORD_BOT_TOKEN",
        label: "Bot Token",
        placeholder: "MTAxN... (long string of characters)",
        help: "From the Bot tab → Reset Token.",
      },
    ],
  },
];

// Platforms HERMÉS supports but that need real-world verification we can't
// honestly compress into a 5-step walkthrough. Surfaced so operators know
// they exist but route the conversation back to their agency.
const ADVANCED = [
  { label: "WhatsApp Business", note: "Requires Meta Business verification (1–3 days)." },
  { label: "SMS (Twilio)", note: "Needs a Twilio account + a verified phone number." },
  { label: "Email (IMAP/SMTP)", note: "App-specific passwords vary by provider." },
  { label: "Matrix / Signal / iMessage", note: "Possible — but pairing is per-account and not 5-step." },
];

export function ChannelSetupSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = CHANNELS.find((c) => c.id === openId) ?? null;

  return (
    <div className="card p-5 mb-4">
      <div className="text-sm font-medium mb-1">Talk to your agents on…</div>
      <p className="text-xs text-muted mb-4">
        Pick a chat app. We&apos;ll walk you through getting a bot token in
        plain English — no developer terminology, no surprise steps.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => setOpenId(c.id)}
            className="flex flex-col items-start gap-1.5 p-3 rounded-lg border border-line bg-[var(--bg)] hover:border-accent/40 hover:bg-accent-soft/30 transition text-left"
          >
            <div className="flex items-center gap-2 w-full">
              <span className="text-xl">{c.icon}</span>
              <span className="text-sm font-medium">{c.label}</span>
              <span className="ml-auto text-[10px] text-muted">~{c.estMinutes} min</span>
            </div>
            <div className="text-[11px] text-muted line-clamp-2">{c.tagline}</div>
          </button>
        ))}
      </div>

      <details className="mt-4">
        <summary className="text-xs text-muted cursor-pointer">
          Advanced channels — ask your team to set these up
        </summary>
        <ul className="mt-2 space-y-1 text-[11px] text-muted pl-4">
          {ADVANCED.map((a) => (
            <li key={a.label}>
              <span className="text-[var(--ink)]/80">{a.label}</span> — {a.note}
            </li>
          ))}
        </ul>
      </details>

      {open && (
        <ChannelWalkthroughModal channel={open} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ChannelWalkthroughModal({
  channel,
  onClose,
}: {
  channel: ChannelDef;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(channel.fields.map((f) => [f.key, ""])),
  );
  const [savedOk, setSavedOk] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      // Strip blanks so we don't overwrite an existing token with an empty
      // value when the operator only updates one of two fields.
      const filtered = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v.trim() !== ""),
      );
      if (Object.keys(filtered).length === 0) {
        throw new Error("Paste at least one token before saving.");
      }
      return api.saveIntegration(channel.id, filtered);
    },
    onSuccess: () => {
      setSavedOk(true);
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });

  const restart = useMutation({
    mutationFn: async () => {
      await api.stopGateway();
      // Tiny pause so the OS releases the port before the new gateway binds.
      await new Promise((r) => setTimeout(r, 500));
      return api.startGateway();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-line rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{channel.icon}</span>
            <div>
              <h2 className="font-semibold">Set up {channel.label}</h2>
              <p className="text-[11px] text-muted">
                About {channel.estMinutes} minutes. No coding.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          <ol className="space-y-3">
            {channel.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div>{step.text}</div>
                  {step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent mt-1 hover:underline"
                    >
                      {step.link.label} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="space-y-3 pt-2 border-t border-line">
            {channel.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">{f.label}</span>
                <input
                  type="password"
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="px-3 py-2 rounded-lg border border-line bg-[var(--bg)] text-sm font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                {f.help && <span className="text-[10px] text-muted">{f.help}</span>}
              </label>
            ))}
            {save.error && (
              <div className="text-xs text-red-600">
                {(save.error as Error).message}
              </div>
            )}
          </div>

          {savedOk && (
            <div className="rounded-lg border border-ok/30 bg-accent-soft p-3">
              <div className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium">Saved.</div>
                  <p className="text-xs text-muted mt-0.5">
                    Restart the messaging service so it picks up your new
                    token. This takes a few seconds.
                  </p>
                  <button
                    onClick={() => restart.mutate()}
                    disabled={restart.isPending}
                    className="mt-2 px-3 py-1.5 text-xs btn-primary disabled:opacity-50"
                  >
                    {restart.isPending
                      ? "Restarting…"
                      : restart.isSuccess
                        ? "Restarted ✓"
                        : "Restart now"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-line">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-line rounded-lg text-sm"
          >
            Close
          </button>
          {!savedOk && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save token"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
