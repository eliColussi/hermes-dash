"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Bot,
  Activity,
  ShieldCheck,
  Workflow,
  Plug,
  Zap,
  Target,
  MessageSquare,
  BarChart3,
  Settings,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";

// One flat list — no jargon section labels.
// URL routes stay stable; only labels change.
const NAV = [
  { href: "/welcome", label: "Home", icon: Home },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/schedules", label: "Schedules", icon: Workflow },
  { href: "/webhooks", label: "Triggers", icon: Zap },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/integrations", label: "Connections", icon: Plug },
  { href: "/analytics", label: "Usage", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[260px] shrink-0 border-r border-line bg-surface flex flex-col">
      <div className="px-5 pt-6 pb-4">
        <div className="font-display text-[19px] leading-none tracking-tight text-ink">
          Staff Room
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted mt-1">
          Operating System
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
          <input
            placeholder="Search"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-line bg-surface-2 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted font-mono">/</span>
        </div>
      </div>

      <nav className="px-3 pt-2 flex-1 overflow-y-auto">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className={cn("nav-item", active && "active")}>
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pb-5 pt-3 border-t border-line">
        <Link
          href="/settings"
          className={cn("nav-item", pathname === "/settings" && "active")}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
        <div className="text-[10px] text-muted px-3 pt-3 tracking-wider uppercase">v0.1</div>
      </div>
    </aside>
  );
}

