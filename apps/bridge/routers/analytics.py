"""Analytics router: cost, tokens, sessions, tool-call breakdowns.

Sources: HERMÉS state.db (sessions table — cost, tokens, model, source) and
the staffroom-audit JSONL (per-agent session_start events).
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Iterator, List, Optional

from fastapi import APIRouter, Depends, Query

from .. import auth, hermes_client as hc
from ..config import HERMES_STATE_DB, STAFFROOM_HOME

router = APIRouter(
    prefix="/api/analytics",
    tags=["analytics"],
    dependencies=[Depends(auth.require_token)],
)

AUDIT_DIR = STAFFROOM_HOME / "audit"


@contextmanager
def _ro_state() -> Iterator[Optional[sqlite3.Connection]]:
    if not HERMES_STATE_DB.exists():
        yield None
        return
    conn = sqlite3.connect(f"file:{HERMES_STATE_DB}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@router.get("")
def analytics(days: int = Query(30, ge=1, le=365)) -> dict:
    since = time.time() - days * 86400
    midnight = time.time() - (time.time() % 86400)

    with _ro_state() as conn:
        if conn is None:
            return {
                "totals": _empty_totals(),
                "by_day": [],
                "by_model": [],
                "by_source": [],
                "by_agent": _agent_breakdown(days),
                "state_db": "not_found",
            }

        # Totals (today / window / 30d hard limit for the headline number)
        totals = {
            "today": _agg(conn, since=midnight),
            "window": _agg(conn, since=since),
        }

        # By day (last `days`)
        rows = conn.execute(
            """
            SELECT
              date(started_at, 'unixepoch') AS day,
              COUNT(*) AS sessions,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
              COALESCE(SUM(tool_call_count), 0) AS tool_calls
            FROM sessions
            WHERE started_at >= ?
            GROUP BY day
            ORDER BY day DESC
            LIMIT ?
            """,
            (since, days),
        ).fetchall()
        by_day = [dict(r) for r in rows]

        # By model
        rows = conn.execute(
            """
            SELECT
              COALESCE(model, 'unknown') AS model,
              COUNT(*) AS sessions,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
            FROM sessions
            WHERE started_at >= ?
            GROUP BY model
            ORDER BY cost DESC
            LIMIT 20
            """,
            (since,),
        ).fetchall()
        by_model = [dict(r) for r in rows]

        # By source (cli, telegram, slack, …)
        rows = conn.execute(
            """
            SELECT
              COALESCE(source, 'unknown') AS source,
              COUNT(*) AS sessions,
              COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS cost
            FROM sessions
            WHERE started_at >= ?
            GROUP BY source
            ORDER BY sessions DESC
            """,
            (since,),
        ).fetchall()
        by_source = [dict(r) for r in rows]

    return {
        "totals": totals,
        "by_day": by_day,
        "by_model": by_model,
        "by_source": by_source,
        "by_agent": _agent_breakdown(days),
        "state_db": "ok",
    }


def _agg(conn: sqlite3.Connection, since: float) -> dict:
    row = conn.execute(
        """
        SELECT
          COUNT(*) AS sessions,
          COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS cost,
          COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
          COALESCE(SUM(tool_call_count), 0) AS tool_calls
        FROM sessions
        WHERE started_at >= ?
        """,
        (since,),
    ).fetchone()
    return dict(row) if row else _empty_totals()["today"]


def _empty_totals() -> dict:
    z = {"sessions": 0, "cost": 0, "tokens": 0, "tool_calls": 0}
    return {"today": z, "window": z}


def _agent_breakdown(days: int) -> List[dict]:
    """Walk the last `days` of audit JSONLs, count distinct sessions per
    agent, then join with state.db so the operator can see actual $ spent
    per agent — the answer to "which worker is burning my budget?"."""
    if not AUDIT_DIR.exists():
        return []
    today = datetime.utcnow().date()
    seen: dict[str, set[str]] = {}
    for offset in range(days):
        day = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        path = AUDIT_DIR / f"{day}.jsonl"
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
                    seen.setdefault(evt["agent_id"], set()).add(evt["session_id"])
        except OSError:
            continue

    # Look up costs for those sessions in state.db (single query, batched).
    all_session_ids: list[str] = [sid for sids in seen.values() for sid in sids]
    cost_by_session: dict[str, float] = {}
    if all_session_ids:
        with _ro_state() as conn:
            if conn is not None:
                # SQLite IN clauses have a parameter cap (~999); chunk if huge.
                for i in range(0, len(all_session_ids), 500):
                    chunk = all_session_ids[i : i + 500]
                    placeholders = ",".join("?" * len(chunk))
                    rows = conn.execute(
                        f"""
                        SELECT id, COALESCE(actual_cost_usd, estimated_cost_usd) AS cost
                        FROM sessions WHERE id IN ({placeholders})
                        """,
                        chunk,
                    ).fetchall()
                    for r in rows:
                        cost_by_session[r["id"]] = float(r["cost"] or 0.0)

    out = []
    for agent_id, sids in seen.items():
        cost = sum(cost_by_session.get(sid, 0.0) for sid in sids)
        out.append({"agent_id": agent_id, "sessions": len(sids), "cost": cost})
    # Sort by cost desc so the most expensive agent is at the top.
    out.sort(key=lambda x: -x["cost"])
    return out
