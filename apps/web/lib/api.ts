export type AgentStatus = "healthy" | "stale" | "down";

export interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  organization: string;
  icon: string;
  model: string;
  system_prompt: string;
  toolset: string;
  enabled: boolean;
  status: AgentStatus;
  tasks_today: number;
  pid: number | null;
  last_seen: number | null;
}

export interface Overview {
  total_agents: number;
  healthy: number;
  stale: number;
  down: number;
  tasks_today: number;
  sessions_today: number;
  cost_today_usd: number;
  cost_30d_usd: number;
  skills_installed: number;
}

export interface Task {
  id: string;
  agent_id: string | null;
  title: string;
  status: string;
  created_at: number;
  source: string;
}

export interface ActivityItem {
  session_id: string;
  agent_id: string | null;
  title: string | null;
  source: string;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  tool_call_count: number;
  cost_usd: number | null;
}

export interface Skill {
  category: string;
  name: string;
  description: string;
  version: string;
  path: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const api = {
  overview: () => req<Overview>("/api/overview"),
  agents: () => req<Agent[]>("/api/agents"),
  createAgent: (body: Partial<Agent>) =>
    req<Agent>("/api/agents", { method: "POST", body: JSON.stringify(body) }),
  startAgent: (id: string) =>
    req<Agent>(`/api/agents/${id}/start`, { method: "POST" }),
  stopAgent: (id: string) =>
    req<Agent>(`/api/agents/${id}/stop`, { method: "POST" }),
  deleteAgent: (id: string) =>
    fetch(`/api/agents/${id}`, { method: "DELETE" }),
  tasks: () => req<Task[]>("/api/tasks"),
  createTask: (body: { agent_id?: string; title: string }) =>
    req<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  activity: (limit = 50) => req<ActivityItem[]>(`/api/activity?limit=${limit}`),
  logs: () => req<{ files: { name: string; path: string; size: number }[] }>("/api/logs"),
  tailLog: (name: string, lines = 200) =>
    req<{ name: string; lines: string[] }>(
      `/api/logs/tail?name=${encodeURIComponent(name)}&lines=${lines}`
    ),
  skills: () => req<Skill[]>("/api/skills"),
};
