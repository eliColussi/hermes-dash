"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  PartyPopper,
} from "lucide-react";
import Link from "next/link";
import { api, audit, composio, schedules, webhooks } from "@/lib/api";

interface Step {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

function fmtUsd(v: number | undefined | null): string {
  if (v == null) return "$0.00";
  return v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export default function HomePage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 10_000 });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const cstatus = useQuery({ queryKey: ["composio-status"], queryFn: composio.status });
  const cconns = useQuery({
    queryKey: ["composio-connections"],
    queryFn: composio.connections,
    enabled: cstatus.data?.configured === true,
  });
  const sched = useQuery({ queryKey: ["schedules"], queryFn: schedules.list });
  const hooks = useQuery({ queryKey: ["webhooks"], queryFn: webhooks.list });
  const today = useQuery({ queryKey: ["audit-today"], queryFn: () => audit.list({ limit: 5 }) });

  const customAgentExists = (agents.data ?? []).some(
    (a) => !["analyst", "boss", "captain"].includes(a.id),
  );
  const runningAgent = (agents.data ?? []).some((a) => a.status !== "down");

  const steps: Step[] = [
    {
      key: "composio",
      title: "Connect your first app",
      description: "Pick Gmail, Slack, Stripe, HubSpot, or any of the other 250+ apps. One OAuth click.",
      href: "/integrations",
      cta: "Connect an app",
      done: (cconns.data?.items.length ?? 0) > 0,
    },
    {
      key: "agent",
      title: "Create your first agent",
      description: "Give it a name, tell it what its job is, pick what tools it can use.",
      href: "/agents",
      cta: "Add an agent",
      done: customAgentExists,
    },
    {
      key: "run",
      title: "Start it",
      description: "Click play on its card. It comes online.",
      href: "/agents",
      cta: "Open Agents",
      done: runningAgent,
    },
    {
      key: "schedule_or_webhook",
      title: "Wire up when it runs",
      description: "Schedule it for 9am every weekday, or trigger it from an outside event like a new Stripe payment.",
      href: "/schedules",
      cta: "Add a schedule",
      done: (sched.data?.items.length ?? 0) > 0 || (hooks.data?.items.length ?? 0) > 0,
    },
    {
      key: "activity",
      title: "Watch what happens",
      description: "Every conversation shows up in Activity as soon as it runs.",
      href: "/activity",
      cta: "Open Activity",
      done: (today.data?.count ?? 0) > 0,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;
  const nextStep = steps.find((s) => !s.done);
  const ov = overview.data;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-4xl font-semibold tracking-tight">
        {allDone ? "Welcome back." : "Welcome to Staff Room OS"}
      </h1>
      {!allDone && (
        <p className="text-muted mt-3 max-w-2xl">
          Your AI staff room. Five quick steps below get you from empty to a
          live agent working on your tools.
        </p>
      )}

      {/* Stat strip — always shown so the page feels alive even mid-setup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
        <Stat label="Agents" value={ov?.total_agents ?? 0} accent={ov?.healthy ? "ok" : undefined} />
        <Stat label="Online now" value={`${ov?.healthy ?? 0} of ${ov?.total_agents ?? 0}`} />
        <Stat label="Tasks today" value={ov?.tasks_today ?? 0} />
        <Stat label="Spent today" value={fmtUsd(ov?.cost_today_usd)} />
      </div>

      {allDone ? (
        <div className="card p-5 mt-8 bg-green-50/40 dark:bg-green-950/20 border-green-200 dark:border-green-900">
          <div className="flex items-start gap-3">
            <PartyPopper className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <div className="font-medium">You&apos;re live.</div>
              <div className="text-sm text-muted mt-1">
                Everything&apos;s wired up. Add more agents, connect more apps,
                or check <Link className="text-blue-600" href="/analytics">Usage</Link> to
                see what your team has been doing.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-10">
            <div className="flex items-center gap-3 mb-1">
              <div className="text-xs uppercase tracking-wider text-muted">
                {completed} of {steps.length} done
              </div>
              <div className="flex-1 h-1.5 bg-[var(--bg)] rounded">
                <div
                  className="h-full bg-green-500 rounded transition-all"
                  style={{ width: `${(completed / steps.length) * 100}%` }}
                />
              </div>
            </div>
            {nextStep && (
              <Link
                href={nextStep.href}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
              >
                Next: {nextStep.cta} <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>

          <ol className="mt-8 space-y-3">
            {steps.map((s, i) => (
              <li
                key={s.key}
                className={`card p-4 flex items-start gap-4 ${
                  s.done ? "opacity-60" : ""
                }`}
              >
                <div className="mt-0.5">
                  {s.done ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{i + 1}. {s.title}</div>
                  <div className="text-xs text-muted mt-1">{s.description}</div>
                </div>
                {!s.done && (
                  <Link
                    href={s.href}
                    className="px-3 py-1.5 text-xs border border-line rounded-lg whitespace-nowrap"
                  >
                    {s.cta}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: "ok" }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent === "ok" ? "text-green-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
