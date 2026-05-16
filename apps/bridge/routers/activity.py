"""Activity feed = recent HERMÉS sessions + per-session message detail."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator, Optional

from fastapi import APIRouter, HTTPException, Query

from .. import hermes_client as hc
from ..config import HERMES_STATE_DB
from ..models import ActivityItem

router = APIRouter(prefix="/api/activity", tags=["activity"])


@contextmanager
def _ro() -> Iterator[Optional[sqlite3.Connection]]:
    if not HERMES_STATE_DB.exists():
        yield None
        return
    conn = sqlite3.connect(f"file:{HERMES_STATE_DB}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@router.get("", response_model=list[ActivityItem])
def activity(limit: int = Query(50, ge=1, le=500)) -> list[ActivityItem]:
    sessions = hc.query_sessions(limit=limit)
    return [
        ActivityItem(
            session_id=s["id"],
            title=s.get("title"),
            source=s.get("source", ""),
            model=s.get("model"),
            started_at=s["started_at"],
            ended_at=s.get("ended_at"),
            message_count=int(s.get("message_count") or 0),
            tool_call_count=int(s.get("tool_call_count") or 0),
            cost_usd=s.get("cost_usd"),
        )
        for s in sessions
    ]


@router.get("/{session_id}")
def session_detail(session_id: str, limit: int = Query(500, ge=1, le=5000)) -> dict:
    """Full session: metadata + message history, trimmed."""
    with _ro() as conn:
        if conn is None:
            raise HTTPException(404, "HERMÉS state.db not found")
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Session not found")
        session = dict(row)
        # Strip noisy/redundant columns
        for k in ("billing_provider", "billing_base_url", "billing_mode", "cost_source", "pricing_version", "handoff_state", "handoff_platform", "handoff_error"):
            session.pop(k, None)

        msgs = conn.execute(
            """
            SELECT id, role, content, tool_call_id, tool_calls, tool_name,
                   timestamp, token_count, finish_reason, reasoning
            FROM messages
            WHERE session_id = ?
            ORDER BY timestamp ASC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
        messages = []
        for m in msgs:
            d = dict(m)
            # Cap content for transport safety
            if d.get("content") and len(d["content"]) > 8000:
                d["content"] = d["content"][:8000] + f"…(+{len(d['content']) - 8000} chars)"
            if d.get("reasoning") and len(d["reasoning"]) > 4000:
                d["reasoning"] = d["reasoning"][:4000] + "…"
            messages.append(d)
    return {"session": session, "messages": messages, "message_count": len(messages)}
