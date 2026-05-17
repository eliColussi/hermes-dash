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
  toolsets: string[] | null;
  composio_toolkits: string[] | null;
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
  if (!r.ok) {
    // Surface the bridge's actual error body so 502s aren't silent — the
    // server already includes a stderr tail in detail, we just need to
    // bubble it up to the UI instead of swallowing it.
    let detail = "";
    try {
      const body = await r.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
    } catch {
      try {
        detail = await r.text();
      } catch {
        // give up
      }
    }
    throw new Error(detail ? `${r.status}: ${detail}` : `${r.status} ${r.statusText}`);
  }
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
  activitySession: (id: string, limit = 500) =>
    req<{
      session: Record<string, unknown>;
      messages: {
        id: number;
        role: string;
        content: string | null;
        tool_call_id: string | null;
        tool_calls: string | null;
        tool_name: string | null;
        timestamp: number;
        token_count: number | null;
        finish_reason: string | null;
        reasoning: string | null;
      }[];
      message_count: number;
    }>(`/api/activity/${id}?limit=${limit}`),
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
      vault_active: boolean;
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
  mcpConfig: () =>
    req<{ claude_code: unknown; instructions: string }>(
      "/api/settings/mcp-config",
    ),
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

// Webhooks (HERMÉS dynamic subscriptions)
export interface Webhook {
  name: string;
  title: string;
  description: string;
  agent_id: string | null;
  url: string;
  events: string[];
  secret_masked: string;
  deliver: string;
  deliver_only: boolean;
  prompt: string;
  skills: string[];
  created_at: string | null;
}

// Audit log
export interface AuditEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

export interface PendingApproval {
  ts: string;
  event: string;
  command_preview?: string;
  description?: string;
  pattern_key?: string;
  session_key?: string;
  surface?: string;
  [key: string]: unknown;
}

export const approvals = {
  list: () => req<{ items: PendingApproval[]; count: number }>("/api/approvals"),
  history: () => req<{ items: PendingApproval[]; count: number }>("/api/approvals/history"),
};

// Goals
export interface Goal {
  id: string;
  title: string;
  description: string;
  status: "active" | "paused" | "done" | "archived";
  target_date: string | null;
  owner_agent_id: string | null;
  created_at: string;
  updated_at: string;
  progress: { ts: string; note: string }[];
}

export const goals = {
  list: (status?: string) =>
    req<{ items: Goal[]; total: number }>(
      "/api/goals" + (status ? `?status=${status}` : ""),
    ),
  create: (body: { title: string; description?: string; status?: string; target_date?: string; owner_agent_id?: string }) =>
    req<Goal>("/api/goals", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: string, body: Partial<{ title: string; description: string; status: string; target_date: string; progress_note: string }>) =>
    req<Goal>(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => fetch(`/api/goals/${id}`, { method: "DELETE" }),
};

export interface AnalyticsTotals {
  today: { sessions: number; cost: number; tokens: number; tool_calls: number };
  window: { sessions: number; cost: number; tokens: number; tool_calls: number };
}
export interface AnalyticsView {
  totals: AnalyticsTotals;
  by_day: { day: string; sessions: number; cost: number; tokens: number; tool_calls: number }[];
  by_model: { model: string; sessions: number; cost: number; tokens: number }[];
  by_source: { source: string; sessions: number; cost: number }[];
  by_agent: { agent_id: string; sessions: number; cost: number }[];
  state_db: "ok" | "not_found";
}

export const analytics = {
  fetch: (days = 30) => req<AnalyticsView>(`/api/analytics?days=${days}`),
};

export const audit = {
  list: (params: { date?: string; limit?: number; event?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set("date", params.date);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.event) qs.set("event", params.event);
    const q = qs.toString();
    return req<{ date: string; items: AuditEntry[]; count: number }>(
      "/api/audit" + (q ? `?${q}` : ""),
    );
  },
  days: () => req<{ days: string[] }>("/api/audit/days"),
};

export const webhooks = {
  list: () => req<{ items: Webhook[]; total: number; base_url: string }>("/api/webhooks"),
  create: (body: {
    name: string;
    description?: string;
    prompt?: string;
    agent_id?: string;
    events?: string[];
    deliver?: string;
    deliver_chat_id?: string;
    deliver_only?: boolean;
    skills?: string[];
  }) =>
    req<{ name: string; url: string; secret: string; note: string }>(
      "/api/webhooks",
      { method: "POST", body: JSON.stringify(body) },
    ),
  remove: (name: string) => fetch(`/api/webhooks/${name}`, { method: "DELETE" }),
};

export interface ChatThread {
  id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  session_id: string | null;
  created_at: string;
}
export interface ChatMessage {
  id: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  timestamp: number;
  reasoning: string | null;
}
export const chat = {
  threads: (agentId?: string) =>
    req<{ items: ChatThread[]; total: number }>(
      "/api/chat/threads" + (agentId ? `?agent_id=${agentId}` : ""),
    ),
  create: (body: { agent_id: string; title?: string }) =>
    req<ChatThread>("/api/chat/threads", { method: "POST", body: JSON.stringify(body) }),
  rename: (id: string, title: string) =>
    req<ChatThread>(`/api/chat/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  remove: (id: string) => fetch(`/api/chat/threads/${id}`, { method: "DELETE" }),
  messages: (id: string) =>
    req<{ thread: ChatThread; messages: ChatMessage[]; running: boolean; elapsed_sec: number | null }>(
      `/api/chat/threads/${id}/messages`,
    ),
  send: (id: string, content: string) =>
    req<{ thread: ChatThread; messages: ChatMessage[]; running: boolean; elapsed_sec: number | null }>(
      `/api/chat/threads/${id}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    ),
};

export interface Capability {
  id: string;
  ready: boolean;
  detail: string;
}
export const capabilities = {
  list: () => req<{ items: Capability[] }>("/api/capabilities"),
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
