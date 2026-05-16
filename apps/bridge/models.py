"""Pydantic response schemas for the bridge."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

AgentStatus = Literal["healthy", "stale", "down"]


class AgentDef(BaseModel):
    id: str
    name: str
    slug: str
    role: str = ""
    description: str = ""
    organization: str = "staffroom"
    icon: str = "🤖"
    model: str = "claude-sonnet-4-6"
    system_prompt: str = ""
    toolset: str = "default"  # legacy single-string field, kept for back-compat
    toolsets: Optional[List[str]] = None  # new multi-select; preferred when set
    enabled: bool = True


class AgentView(AgentDef):
    status: AgentStatus = "down"
    tasks_today: int = 0
    pid: Optional[int] = None
    last_seen: Optional[float] = None


class AgentCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    role: str = ""
    description: str = ""
    organization: str = "staffroom"
    icon: str = "🤖"
    model: str = "claude-sonnet-4-6"
    system_prompt: str = ""
    toolset: str = "default"
    toolsets: Optional[List[str]] = None


class AgentPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    organization: Optional[str] = None
    icon: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    toolset: Optional[str] = None
    toolsets: Optional[List[str]] = None
    enabled: Optional[bool] = None


class Overview(BaseModel):
    total_agents: int
    healthy: int
    stale: int
    down: int
    tasks_today: int
    sessions_today: int
    cost_today_usd: float
    cost_30d_usd: float
    skills_installed: int


class Task(BaseModel):
    id: str
    agent_id: Optional[str] = None
    title: str
    status: str
    created_at: float
    source: str = ""


class TaskCreate(BaseModel):
    agent_id: Optional[str] = None
    title: str = Field(..., min_length=1)


class ActivityItem(BaseModel):
    session_id: str
    agent_id: Optional[str] = None
    title: Optional[str] = None
    source: str
    model: Optional[str] = None
    started_at: float
    ended_at: Optional[float] = None
    message_count: int
    tool_call_count: int
    cost_usd: Optional[float] = None


class Skill(BaseModel):
    category: str
    name: str
    description: str = ""
    version: str = ""
    path: str
