"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  LayoutGrid,
  Bot,
  ListTodo,
  Activity,
  ScrollText,
  MessageSquare,
  ShieldCheck,
  Workflow,
  Plug,
  Target,
  BarChart3,
  BookOpen,
  FlaskConical,
  Puzzle,
  Settings,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";

const PRIMARY = [
  { href: "/welcome", label: "Welcome", icon: Sparkles },
  { href: "/overview", label: "Overview", icon: LayoutGrid },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/log", label: "Log", icon: ScrollText },
];

const OPERATIONS = [
  { label: "Messages", icon: MessageSquare, soon: true },
  { label: "Approvals", icon: ShieldCheck, soon: true },
  { label: "Workflows", icon: Workflow, soon: true },
  { label: "Integrations", icon: Plug, soon: true },
  { label: "Goals", icon: Target, soon: true },
  { label: "Analytics", icon: BarChart3, soon: true },
];

const INTELLIGENCE = [
  { label: "Knowledge", icon: BookOpen, soon: true },
  { label: "Experiments", icon: FlaskConical, soon: true },
  { href: "/skills", label: "Skills", icon: Puzzle },
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
          {PRIMARY.map((item) => {
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

        <SectionLabel>Operations</SectionLabel>
        <ul className="space-y-1">
          {OPERATIONS.map((item) => (
            <SoonItem key={item.label} icon={item.icon} label={item.label} />
          ))}
        </ul>

        <SectionLabel>Intelligence</SectionLabel>
        <ul className="space-y-1">
          {INTELLIGENCE.map((item) =>
            "href" in item && item.href ? (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn("nav-item", pathname === item.href && "active")}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            ) : (
              <SoonItem key={item.label} icon={item.icon} label={item.label} />
            ),
          )}
        </ul>
      </nav>

      <div className="px-3 pb-5 pt-3 border-t border-line">
        <div className="nav-item opacity-80 cursor-default">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </div>
        <div className="text-xs text-muted px-3 pt-2">v0.1.0</div>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-1 px-3 text-[11px] uppercase tracking-wider text-muted">
      {children}
    </div>
  );
}

function SoonItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <li className="nav-item opacity-50 cursor-not-allowed" title="Coming soon">
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">soon</span>
    </li>
  );
}
