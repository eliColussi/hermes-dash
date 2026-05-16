"""Goals router (v1).

Long-running objectives the operator wants their agents working toward.
Persisted as a simple JSON file at $STAFFROOM_HOME/goals.json. Future
iterations will let agents push progress updates via a hook, but v1 is
human-edited only — still useful as a dashboard "what are we trying to do"
panel.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth
from ..config import STAFFROOM_HOME, ensure_dirs

router = APIRouter(
    prefix="/api/goals",
    tags=["goals"],
    dependencies=[Depends(auth.require_token)],
)

_GOALS_FILE = STAFFROOM_HOME / "goals.json"


class GoalCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    status: str = Field("active", pattern="^(active|paused|done|archived)$")
    target_date: Optional[str] = None  # ISO date string
    owner_agent_id: Optional[str] = None


class GoalPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    target_date: Optional[str] = None
    owner_agent_id: Optional[str] = None
    progress_note: Optional[str] = None  # appends to progress log


def _load() -> List[dict]:
    if not _GOALS_FILE.exists():
        return []
    try:
        data = json.loads(_GOALS_FILE.read_text(encoding="utf-8"))
        return list(data) if isinstance(data, list) else []
    except Exception:
        return []


def _save(goals: List[dict]) -> None:
    ensure_dirs()
    _GOALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _GOALS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(goals, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _GOALS_FILE)


@router.get("")
def list_goals(status: Optional[str] = None) -> dict:
    items = _load()
    if status:
        items = [g for g in items if g.get("status") == status]
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
def create_goal(payload: GoalCreate) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    goal = {
        "id": uuid.uuid4().hex[:12],
        "title": payload.title.strip(),
        "description": payload.description.strip(),
        "status": payload.status,
        "target_date": payload.target_date,
        "owner_agent_id": payload.owner_agent_id,
        "created_at": now,
        "updated_at": now,
        "progress": [],
    }
    goals = _load()
    goals.insert(0, goal)
    _save(goals)
    return goal


@router.patch("/{goal_id}")
def patch_goal(goal_id: str, patch: GoalPatch) -> dict:
    goals = _load()
    for g in goals:
        if g.get("id") == goal_id:
            updates = patch.model_dump(exclude_none=True)
            progress_note = updates.pop("progress_note", None)
            for k, v in updates.items():
                g[k] = v
            if progress_note:
                g.setdefault("progress", []).append({
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "note": progress_note,
                })
            g["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _save(goals)
            return g
    raise HTTPException(404, "Goal not found")


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str) -> None:
    goals = _load()
    new = [g for g in goals if g.get("id") != goal_id]
    if len(new) == len(goals):
        raise HTTPException(404, "Goal not found")
    _save(new)
