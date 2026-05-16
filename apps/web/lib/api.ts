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
  integrations: () =>
    req<{
      integrations: Integration[];
      gateway: { running: boolean; pid: number | null; log: string };
    }>("/api/integrations"),
  saveIntegration: (provider: string, values: Record<string, string>) =>
    req<{ ok: boolean }>("/api/integrations", {
      method: "PUT",
      body: JSON.stringify({ provider, values }),
    }),
  startGateway: () =>
    req<{ running: boolean; pid: number }>("/api/integrations/gateway/start", { method: "POST" }),
  stopGateway: () =>
    req<{ running: boolean }>("/api/integrations/gateway/stop", { method: "POST" }),
  settings: () => req<SettingsView>("/api/settings"),
  rotateToken: () =>
    req<{ rotated: boolean; token?: string; note?: string }>(
      "/api/settings/rotate-token",
      { method: "POST" },
    ),
};

export interface SettingsView {
  token: string | null;
  auth_disabled: boolean;
  hermes_home: string;
  staffroom_home: string;
  env: Record<string, string>;
}

// Composio
export interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: string[];
}
export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
  created_at: string;
}
export interface ComposioStatus {
  configured: boolean;
  user_id: string;
  init_error: string | null;
}

// Schedules (HERMÉS cron)
export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  schedule: { kind: string; display?: string; expr?: string; minutes?: number; run_at?: string };
  schedule_display: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  repeat: { times: number | null; completed: number } | null;
  repeat_count: number;
  deliver: string | null;
  enabled: boolean;
  disabled_reason: string | null;
  model: string | null;
  created_at: string;
}

export const schedules = {
  list: () => req<{ items: Schedule[]; total: number }>("/api/schedules"),
  create: (body: {
    prompt: string;
    schedule: string;
    name?: string;
    repeat?: number;
    deliver?: string;
    model?: string;
    skills?: string[];
  }) =>
    req<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: string, body: Partial<{ name: string; prompt: string; schedule: string; repeat: number; deliver: string; model: string; enabled: boolean }>) =>
    req<Schedule>(`/api/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  trigger: (id: string) =>
    req<Schedule>(`/api/schedules/${id}/trigger`, { method: "POST" }),
  remove: (id: string) =>
    fetch(`/api/schedules/${id}`, { method: "DELETE" }),
};

export const composio = {
  status: () => req<ComposioStatus>("/api/composio/status"),
  toolkits: () =>
    req<{ items: ComposioToolkit[]; total: number }>("/api/composio/toolkits"),
  connections: () =>
    req<{ items: ComposioConnection[]; total: number }>("/api/composio/connections"),
  connect: (toolkit: string) =>
    req<{ toolkit: string; redirect_url: string; connection_id: string }>(
      "/api/composio/connect",
      { method: "POST", body: JSON.stringify({ toolkit }) },
    ),
  disconnect: (id: string) =>
    fetch(`/api/composio/connections/${id}`, { method: "DELETE" }),
};

export interface Integration {
  id: string;
  label: string;
  icon: string;
  fields: { key: string; label: string; secret: boolean; help: string }[];
  values: Record<string, string>;
  configured: boolean;
}
