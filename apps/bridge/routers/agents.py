"""Agent CRUD + start/stop endpoints."""
from __future__ import annotations

import re
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import hermes_client as hc
from ..models import AgentCreate, AgentDef, AgentPatch, AgentView

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or uuid.uuid4().hex[:8]


def _materialize(agent: dict[str, Any]) -> AgentView:
    status, pid, last_seen = hc.agent_runtime_status(agent["id"])
    tasks_today = _tasks_for_agent_today(agent["id"])
    return AgentView(
        **{**agent, "status": status, "pid": pid, "last_seen": last_seen, "tasks_today": tasks_today}
    )


def _tasks_for_agent_today(agent_id: str) -> int:
    midnight = time.time() - (time.time() % 86400)
    for s in hc.query_sessions(limit=500, since=midnight):
        # We don't yet tag sessions with our agent_id; this is a placeholder
        # until the spawn path injects STAFFROOM_AGENT_ID into a session column.
        pass
    return 0


@router.get("", response_model=list[AgentView])
def list_agents() -> list[AgentView]:
    return [_materialize(a) for a in hc.load_agents()]


@router.post("", response_model=AgentView, status_code=201)
def create_agent(payload: AgentCreate) -> AgentView:
    agents = hc.load_agents()
    slug = payload.slug or _slugify(payload.name)
    if any(a["id"] == slug for a in agents):
        raise HTTPException(409, f"Agent with id '{slug}' already exists")
    new_agent = {
        "id": slug,
        "name": payload.name,
        "slug": slug,
        "role": payload.role,
        "description": payload.description,
        "organization": payload.organization,
        "icon": payload.icon,
        "model": payload.model,
        "system_prompt": payload.system_prompt,
        "toolset": payload.toolset,
        "enabled": True,
    }
    agents.append(new_agent)
    hc.save_agents(agents)
    return _materialize(new_agent)


@router.patch("/{agent_id}", response_model=AgentView)
def update_agent(agent_id: str, patch: AgentPatch) -> AgentView:
    agents = hc.load_agents()
    for a in agents:
        if a["id"] == agent_id:
            for k, v in patch.model_dump(exclude_none=True).items():
                a[k] = v
            hc.save_agents(agents)
            return _materialize(a)
    raise HTTPException(404, "Agent not found")


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str) -> None:
    agents = hc.load_agents()
    new = [a for a in agents if a["id"] != agent_id]
    if len(new) == len(agents):
        raise HTTPException(404, "Agent not found")
    hc.stop_agent(agent_id)
    hc.save_agents(new)


@router.post("/{agent_id}/start", response_model=AgentView)
def start(agent_id: str) -> AgentView:
    agents = hc.load_agents()
    for a in agents:
        if a["id"] == agent_id:
            hc.start_agent(a)
            return _materialize(a)
    raise HTTPException(404, "Agent not found")


@router.post("/{agent_id}/stop", response_model=AgentView)
def stop(agent_id: str) -> AgentView:
    agents = hc.load_agents()
    for a in agents:
        if a["id"] == agent_id:
            hc.stop_agent(agent_id)
            return _materialize(a)
    raise HTTPException(404, "Agent not found")
