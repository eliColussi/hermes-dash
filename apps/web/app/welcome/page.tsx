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

export default function WelcomePage() {
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
      key: "openrouter",
      title: "Connect an AI provider",
      description: "Set OPENROUTER_API_KEY in your Railway env. Unlocks every model in the picker.",
      href: "/integrations",
      cta: "Open Integrations",
      // We can't observe env vars from the client, but if agents exist + running we infer it works.
      done: runningAgent || (agents.data ?? []).length > 3,
    },
    {
      key: "composio",
      title: "Connect your first app via Composio",
      description: "One OAuth click. 250+ apps available — Gmail, Slack, Stripe, HubSpot, etc.",
      href: "/integrations",
      cta: "Connect an app",
      done: (cconns.data?.items.length ?? 0) > 0,
    },
    {
      key: "agent",
      title: "Create your first agent",
      description: "Give it a name, a system prompt, and a model. It's an AI employee.",
      href: "/agents",
      cta: "Add an agent",
      done: customAgentExists,
    },
    {
      key: "run",
      title: "Start it",
      description: "Click the play button on the agent card. Status dot turns green.",
      href: "/agents",
      cta: "Open Agents",
      done: runningAgent,
    },
    {
      key: "schedule_or_webhook",
      title: "Wire up a trigger",
      description: "Either: schedule the agent to run at 9am every weekday, or hook it to a Stripe / GitHub webhook.",
      href: "/schedules",
      cta: "Add a schedule",
      done: (sched.data?.items.length ?? 0) > 0 || (hooks.data?.items.length ?? 0) > 0,
    },
    {
      key: "activity",
      title: "Watch what happens",
      description: "Activity + Audit tabs show every session and tool call as it happens.",
      href: "/activity",
      cta: "Open Activity",
      done: (today.data?.count ?? 0) > 0,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-semibold tracking-tight">Welcome to Staff Room OS</h1>
      <p className="text-muted mt-3">
        Your autonomous AI staff room. The 6 steps below get you from empty
        to a live agent talking to your tools. There's no terminal — you do
        all of it from this dashboard.
      </p>

      {completed === steps.length ? (
        <div className="card p-5 mt-8 bg-green-50/40 dark:bg-green-950/20 border-green-200 dark:border-green-900">
          <div className="flex items-start gap-3">
            <PartyPopper className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <div className="font-medium">You're live.</div>
              <div className="text-sm text-muted mt-1">
                Everything's wired up. Iterate on prompts, add more agents,
                connect more apps via Composio. Visit{" "}
                <Link className="text-blue-600" href="/analytics">Analytics</Link>{" "}
                to keep an eye on cost.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
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
      )}

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
    </div>
  );
}
