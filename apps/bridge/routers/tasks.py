"""Tasks endpoint.

v1 surface: read the HERMÉS kanban.db if present, else return an empty list.
POST /api/tasks is a stub that records a task in a local JSONL log; wiring it
into HERMÉS's kanban dispatcher is a v2 concern (requires AIAgent import path).
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Iterator, Optional

from fastapi import APIRouter

from ..config import HERMES_KANBAN_DB, STAFFROOM_RUNTIME_DIR, ensure_dirs
from ..models import Task, TaskCreate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

_LOCAL_TASKS = STAFFROOM_RUNTIME_DIR / "tasks.jsonl"


@contextmanager
def _kanban_conn() -> Iterator[Optional[sqlite3.Connection]]:
    if not HERMES_KANBAN_DB.exists():
        yield None
        return
    conn = sqlite3.connect(f"file:{HERMES_KANBAN_DB}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _list_kanban() -> list[Task]:
    with _kanban_conn() as conn:
        if conn is None:
            return []
        try:
            rows = conn.execute(
                "SELECT id, status, prompt, created_at FROM tasks ORDER BY created_at DESC LIMIT 200"
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [
            Task(
                id=str(r["id"]),
                title=str(r["prompt"])[:200],
                status=str(r["status"]),
                created_at=float(r["created_at"]),
                source="hermes-kanban",
            )
            for r in rows
        ]


def _list_local() -> list[Task]:
    if not _LOCAL_TASKS.exists():
        return []
    out: list[Task] = []
    for line in _LOCAL_TASKS.read_text().splitlines():
        if not line.strip():
            continue
        try:
            out.append(Task(**json.loads(line)))
        except (json.JSONDecodeError, ValueError):
            continue
    return sorted(out, key=lambda t: t.created_at, reverse=True)


@router.get("", response_model=list[Task])
def list_tasks() -> list[Task]:
    return _list_kanban() + _list_local()


@router.post("", response_model=Task, status_code=201)
def create_task(payload: TaskCreate) -> Task:
    ensure_dirs()
    task = Task(
        id=uuid.uuid4().hex,
        agent_id=payload.agent_id,
        title=payload.title,
        status="queued",
        created_at=time.time(),
        source="staffroom",
    )
    with _LOCAL_TASKS.open("a") as f:
        f.write(task.model_dump_json() + "\n")
    return task
