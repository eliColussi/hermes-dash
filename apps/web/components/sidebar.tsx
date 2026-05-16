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
    <aside className="w-[260px] shrink-0 border-r border-line bg-[var(--surface)] flex flex-col">
      <div className="px-5 pt-5 pb-3 font-medium tracking-tight">Staff Room OS</div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            placeholder="Search..."
            className="w-full pl-9 pr-10 py-2 text-sm rounded-xl border border-line bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">/</span>
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
        <div className="text-xs text-muted px-3 pt-2">v0.1.0</div>
      </div>
    </aside>
  );
}

