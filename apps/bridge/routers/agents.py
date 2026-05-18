"""Agent CRUD + start/stop endpoints."""
from __future__ import annotations

import re
import sys
import time
import uuid
from pathlib import Path as _P
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import agent_links, hermes_client as hc
from ..config import VENDOR_HERMES
from ..models import AgentCreate, AgentDef, AgentPatch, AgentView


def _hermes_cron():
    if str(VENDOR_HERMES) not in sys.path:
        sys.path.insert(0, str(VENDOR_HERMES))
    from cron import jobs as cron_jobs  # type: ignore
    return cron_jobs


def _cascade_set_enabled(agent_id: str, enabled: bool) -> dict:
    """Flip every linked schedule + trigger to match the agent's state.
    Returns counts so the API consumer can show a confirmation."""
    links = agent_links.for_agent(agent_id)
    # Schedules: use HERMÉS' cron API directly (same path the schedules
    # router uses, no need to round-trip through HTTP).
    cron = _hermes_cron()
    schedule_count = 0
    for sid in links.get("schedules", []):
        try:
            if enabled:
                cron.resume_job(sid)
            else:
                cron.pause_job(sid, reason="agent paused via dashboard")
            schedule_count += 1
        except Exception:
            pass

    # Webhooks: park them under a __paused__ prefix so the gateway no
    # longer matches the inbound URL.
    from .webhooks import _load_subs, _save_subs
    subs = _load_subs()
    webhook_count = 0
    for name in links.get("webhooks", []):
        paused_name = f"__paused__{name}"
        if enabled:
            if paused_name in subs and name not in subs:
                subs[name] = subs.pop(paused_name)
                webhook_count += 1
        else:
            if name in subs:
                subs[paused_name] = subs.pop(name)
                webhook_count += 1
    if webhook_count:
        _save_subs(subs)

    return {"schedules": schedule_count, "webhooks": webhook_count}

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
    return hc.count_agent_sessions_today(agent_id)


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
        "toolsets": payload.toolsets or None,
        "composio_toolkits": payload.composio_toolkits or None,
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
    """Resume the agent: marks it enabled, un-pauses every schedule and
    trigger linked to it. Any future schedule/trigger added with this
    agent_id will be picked up the same way."""
    agents = hc.load_agents()
    for a in agents:
        if a["id"] == agent_id:
            a["enabled"] = True
            hc.save_agents(agents)
            hc.start_agent(a)
            _cascade_set_enabled(agent_id, True)
            return _materialize(a)
    raise HTTPException(404, "Agent not found")


@router.post("/{agent_id}/stop", response_model=AgentView)
def stop(agent_id: str) -> AgentView:
    """Pause the agent and EVERY automation tied to it. Schedules stop
    firing, webhook URLs return 404, but nothing is deleted — clicking
    Start again restores everything in its previous configuration."""
    agents = hc.load_agents()
    for a in agents:
        if a["id"] == agent_id:
            a["enabled"] = False
            hc.save_agents(agents)
            hc.stop_agent(agent_id)
            _cascade_set_enabled(agent_id, False)
            return _materialize(a)
    raise HTTPException(404, "Agent not found")
