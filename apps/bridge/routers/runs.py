"""Recent agent runs — the "look what your agents did for you" feed.

Reads state.db for completed sessions, joins each with its final assistant
message so the home page can render a card per run that says something
human-readable ("Replied to 3 customer emails"). Filters out the operator's
own dashboard chat sessions — those don't represent autonomous work.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Iterator, Optional

from fastapi import APIRouter, Depends, Query

from .. import auth
from ..config import HERMES_STATE_DB, STAFFROOM_HOME

router = APIRouter(
    prefix="/api/runs",
    tags=["runs"],
    dependencies=[Depends(auth.require_token)],
)

_AUDIT_DIR = STAFFROOM_HOME / "audit"


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


def _session_to_agent(days: int = 14) -> dict[str, str]:
    """Walk the audit log to map session_id → agent_id. We don't get this
    from state.db because hermes' sessions table doesn't carry an
    agent_id — only `source` (cron/cli/telegram/etc.)."""
    if not _AUDIT_DIR.exists():
        return {}
    out: dict[str, str] = {}
    today = datetime.utcnow().date()
    for offset in range(days):
        day = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        path = _AUDIT_DIR / f"{day}.jsonl"
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (
                    evt.get("event") == "session_start"
                    and evt.get("agent_id")
                    and evt.get("session_id")
                ):
                    out.setdefault(evt["session_id"], evt["agent_id"])
        except OSError:
            continue
    return out


@router.get("/recent")
def recent_runs(limit: int = Query(15, ge=1, le=50)) -> dict:
    """Last `limit` autonomous agent runs with a one-line outcome.

    Skips dashboard chat sessions (those are operator-initiated tests, not
    autonomous wins) and skips runs with no completion message yet."""
    with _ro() as conn:
        if conn is None:
            return {"items": []}
        rows = conn.execute(
            """
            SELECT id, source, model, started_at, ended_at,
                   message_count, tool_call_count,
                   COALESCE(actual_cost_usd, estimated_cost_usd) AS cost_usd,
                   title
            FROM sessions
            WHERE source IS NULL OR source NOT LIKE 'dashboard:%'
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit * 3,),  # over-fetch so the post-filter still returns ~limit
        ).fetchall()

        sessions = [dict(r) for r in rows]
        # Look up the last meaningful assistant message per session so the
        # UI can render the actual outcome the agent reported.
        for s in sessions:
            outcome = conn.execute(
                """
                SELECT content FROM messages
                WHERE session_id = ?
                  AND role = 'assistant'
                  AND content IS NOT NULL
                  AND TRIM(content) NOT IN ('', '...', '…')
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (s["id"],),
            ).fetchone()
            s["outcome"] = (outcome["content"][:500] if outcome else None)

    # Drop runs that produced nothing — those aren't useful "wins" to show.
    sessions = [s for s in sessions if s.get("outcome")][:limit]

    s2a = _session_to_agent()
    for s in sessions:
        s["agent_id"] = s2a.get(s["id"])

    return {"items": sessions}
