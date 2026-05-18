"""Schedules router: wraps HERMÉS's cron subsystem.

The heavy lifting is already done by ``cron/jobs.py`` in HERMÉS — this is just
a thin Pydantic-typed REST surface so the dashboard can drive it.
"""
from __future__ import annotations

import sys
from pathlib import Path as _P
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import agent_links, auth
from ..config import VENDOR_HERMES

# HERMÉS modules live in vendor/hermes-agent/ and are imported lazily so the
# bridge can boot even if the vendored install ever breaks.
def _hermes():
    if str(VENDOR_HERMES) not in sys.path:
        sys.path.insert(0, str(VENDOR_HERMES))
    from cron import jobs as cron_jobs  # type: ignore
    return cron_jobs


router = APIRouter(
    prefix="/api/schedules",
    tags=["schedules"],
    dependencies=[Depends(auth.require_token)],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ScheduleCreate(BaseModel):
    prompt: str = Field(..., description="What the agent should do on each run.")
    schedule: str = Field(
        ...,
        description=(
            "Schedule string. Accepted forms: '30m' (one-shot in 30 min), "
            "'every 1h' (recurring), '0 9 * * 1-5' (cron, weekdays 9am), "
            "'2026-06-01T09:00' (one-shot ISO timestamp)."
        ),
    )
    name: Optional[str] = None
    repeat: Optional[int] = Field(
        None,
        description="How many times to run before auto-deleting. None = forever.",
    )
    deliver: Optional[str] = Field(
        None,
        description="Where to send the output: 'local' (default), 'telegram', 'slack', 'discord'.",
    )
    model: Optional[str] = None
    skills: Optional[List[str]] = None
    agent_id: Optional[str] = Field(
        None,
        description=(
            "If set, the schedule is linked to this Staff Room agent. "
            "Pausing the agent will pause this schedule and vice versa."
        ),
    )


class SchedulePatch(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    schedule: Optional[str] = None
    repeat: Optional[int] = None
    deliver: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _slim(job: Dict[str, Any]) -> Dict[str, Any]:
    """Strip internal fields the UI doesn't need; flatten the schedule for display."""
    sched = job.get("schedule") or {}
    return {
        "id": job.get("id"),
        "name": job.get("name") or job.get("prompt", "")[:60],
        "prompt": job.get("prompt", ""),
        "schedule": sched,
        "schedule_display": sched.get("display") if isinstance(sched, dict) else str(sched),
        "next_run_at": job.get("next_run_at"),
        "last_run_at": job.get("last_run_at"),
        "last_status": job.get("last_status"),
        "repeat": job.get("repeat"),
        "repeat_count": job.get("repeat_count", 0),
        "deliver": job.get("deliver"),
        "enabled": bool(job.get("enabled", True)),
        "disabled_reason": job.get("paused_reason") or job.get("disabled_reason"),
        "model": job.get("model"),
        "created_at": job.get("created_at"),
    }


@router.get("")
def list_schedules(include_disabled: bool = True) -> dict:
    hermes = _hermes()
    jobs = hermes.list_jobs(include_disabled=include_disabled)
    return {"items": [_slim(j) for j in jobs], "total": len(jobs)}


@router.post("", status_code=201)
def create_schedule(payload: ScheduleCreate) -> dict:
    hermes = _hermes()
    try:
        hermes.parse_schedule(payload.schedule)
    except Exception as exc:
        raise HTTPException(400, f"Invalid schedule: {exc}")
    try:
        job = hermes.create_job(
            prompt=payload.prompt,
            schedule=payload.schedule,
            name=payload.name,
            repeat=payload.repeat,
            deliver=payload.deliver,
            model=payload.model,
            skills=payload.skills,
        )
    except Exception as exc:
        raise HTTPException(400, f"Failed to create schedule: {exc}")
    if payload.agent_id and job.get("id"):
        agent_links.link_schedule(payload.agent_id, job["id"])
    return _slim(job)


@router.patch("/{job_id}")
def update_schedule(job_id: str, patch: SchedulePatch) -> dict:
    hermes = _hermes()
    updates = patch.model_dump(exclude_none=True)
    if "enabled" in updates:
        enabled = updates.pop("enabled")
        if enabled:
            hermes.resume_job(job_id)
        else:
            hermes.pause_job(job_id, reason="paused via dashboard")
    job = hermes.update_job(job_id, updates) if updates else hermes.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Schedule not found")
    return _slim(job)


@router.post("/{job_id}/trigger")
def trigger_now(job_id: str) -> dict:
    hermes = _hermes()
    job = hermes.trigger_job(job_id)
    if job is None:
        raise HTTPException(404, "Schedule not found")
    return _slim(job)


@router.delete("/{job_id}", status_code=204)
def delete_schedule(job_id: str) -> None:
    hermes = _hermes()
    ok = hermes.remove_job(job_id)
    if not ok:
        raise HTTPException(404, "Schedule not found")
    agent_links.unlink_schedule(job_id)
