"""staffroom-introspect plugin — gives the channel agent visibility into the
Staff Room OS deployment it's running inside.

Three read-only tools, file-based (no auth, no HTTP calls):

  staffroom_list_agents     — every agent defined in agents.yaml with role,
                              model, toolsets, enabled/paused state
  staffroom_recent_activity — recent events from the audit log, filterable
                              by agent and hours
  staffroom_agent_summary   — per-agent: count of sessions today, last run
                              outcome, cost summary

Designed for the Orchestrator pattern: pick this agent as your channel
voice on Telegram/Slack/Discord, and operators can DM it questions like
"what have my agents done today?" or "is the inbox agent stuck?" and get
real answers instead of generic LLM guesses.

Data sources:
  - $STAFFROOM_HOME/agents.yaml  (operator-curated Staff Room agent list)
  - $STAFFROOM_HOME/audit/*.jsonl (session-start, tool-call, session-end events
                                   written by the staffroom-audit plugin)
  - $HERMES_HOME/state.db        (read-only via mode=ro URI; HERMÉS already
                                  uses WAL mode so concurrent reads are safe)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Path resolution — match the bridge's logic so we read the same files.
# ---------------------------------------------------------------------------
def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()


def _staffroom_home() -> Path:
    return Path(
        os.environ.get("STAFFROOM_HOME", Path.home() / ".staff-room-os")
    ).expanduser()


def _agents_yaml_path() -> Path:
    return _staffroom_home() / "agents.yaml"


def _audit_dir() -> Path:
    return _staffroom_home() / "audit"


def _state_db_path() -> Path:
    return _hermes_home() / "state.db"


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------
def _load_agents() -> List[Dict[str, Any]]:
    path = _agents_yaml_path()
    if not path.exists():
        return []
    try:
        import yaml as _y
        data = _y.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        logger.warning("staffroom-introspect: agents.yaml unreadable: %s", exc)
        return []
    agents = data.get("agents") if isinstance(data, dict) else None
    return agents if isinstance(agents, list) else []


def _iter_audit_lines(hours_back: int) -> List[Dict[str, Any]]:
    """Read audit JSONL files spanning the last N hours.

    Files are named YYYY-MM-DD.jsonl. We look at today + yesterday by default
    to handle any window crossing midnight UTC."""
    audit = _audit_dir()
    if not audit.exists():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    days_to_read = {
        (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")
        for n in range(max(2, (hours_back // 24) + 2))
    }
    events: List[Dict[str, Any]] = []
    for day in sorted(days_to_read):
        f = audit / f"{day}.jsonl"
        if not f.exists():
            continue
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts_raw = evt.get("ts")
            if isinstance(ts_raw, str):
                try:
                    ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                except ValueError:
                    continue
                if ts >= cutoff:
                    events.append(evt)
    return events


def _query_state_db(query: str, params: tuple = ()) -> List[sqlite3.Row]:
    """Read-only state.db query. Returns rows; never writes."""
    db = _state_db_path()
    if not db.exists():
        return []
    uri = f"file:{db}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.execute(query, params)
            return cur.fetchall()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        logger.warning("staffroom-introspect: state.db query failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------
def _handle_list_agents(arguments: Dict[str, Any], **_kw) -> str:
    agents = _load_agents()
    if not agents:
        return json.dumps({"agents": [], "count": 0, "note": "No agents configured yet. Tell the operator to head to /agents and click 'Add Agent'."})
    out: List[Dict[str, Any]] = []
    for a in agents:
        out.append({
            "id": a.get("id"),
            "name": a.get("name"),
            "role": a.get("role") or a.get("description") or "",
            "model": a.get("model"),
            "toolsets": a.get("toolsets") or [],
            "enabled": a.get("enabled", True),
            "icon": a.get("icon", "🤖"),
        })
    return json.dumps({"agents": out, "count": len(out)}, indent=2)


def _handle_recent_activity(arguments: Dict[str, Any], **_kw) -> str:
    hours = int(arguments.get("hours", 24))
    agent_id = arguments.get("agent_id") or None
    limit = int(arguments.get("limit", 50))
    events = _iter_audit_lines(hours)
    if agent_id:
        events = [e for e in events if e.get("agent_id") == agent_id]
    # Most recent first.
    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    events = events[:limit]
    return json.dumps({
        "window_hours": hours,
        "agent_id": agent_id,
        "count": len(events),
        "events": events,
    }, indent=2, default=str)


def _handle_agent_summary(arguments: Dict[str, Any], **_kw) -> str:
    """Per-agent rollup: sessions today, last-run outcome, cost.

    Audit events give us session counts and outcomes; state.db gives the
    authoritative cost numbers (set by HERMÉS itself at session end)."""
    agent_id = arguments.get("agent_id")
    if not agent_id:
        return json.dumps({"error": "agent_id is required"})

    # Confirm the agent actually exists so we can return a useful "not found"
    # rather than just an empty summary.
    matching = [a for a in _load_agents() if a.get("id") == agent_id]
    if not matching:
        return json.dumps({"error": f"No agent with id '{agent_id}' in agents.yaml"})
    agent = matching[0]

    # Today's session count, from the audit log (cheap, no DB hit needed).
    events = _iter_audit_lines(hours_back=24)
    session_ids_today = {
        e.get("session_id")
        for e in events
        if e.get("event") == "session_start"
        and e.get("agent_id") == agent_id
        and e.get("session_id")
    }
    # Last finished session's outcome.
    end_events = [
        e for e in events
        if e.get("event") == "session_end"
        and e.get("agent_id") == agent_id
    ]
    end_events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    last_outcome = end_events[0] if end_events else None

    # Aggregate cost for those sessions from state.db.
    cost_today = 0.0
    input_tokens = 0
    output_tokens = 0
    for sid in session_ids_today:
        rows = _query_state_db(
            "SELECT actual_cost_usd, estimated_cost_usd, input_tokens, output_tokens "
            "FROM sessions WHERE id = ?",
            (sid,),
        )
        if rows:
            r = rows[0]
            cost_today += r["actual_cost_usd"] or r["estimated_cost_usd"] or 0
            input_tokens += r["input_tokens"] or 0
            output_tokens += r["output_tokens"] or 0

    return json.dumps({
        "agent": {
            "id": agent.get("id"),
            "name": agent.get("name"),
            "role": agent.get("role"),
            "model": agent.get("model"),
            "enabled": agent.get("enabled", True),
        },
        "today": {
            "sessions": len(session_ids_today),
            "cost_usd": round(cost_today, 4),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        },
        "last_run": {
            "ts": last_outcome.get("ts") if last_outcome else None,
            "session_id": last_outcome.get("session_id") if last_outcome else None,
            "end_reason": last_outcome.get("end_reason") if last_outcome else None,
            "summary": last_outcome.get("summary") if last_outcome else None,
        } if last_outcome else None,
    }, indent=2, default=str)


# ---------------------------------------------------------------------------
# Schemas (OpenAI-compatible function shapes)
# ---------------------------------------------------------------------------
LIST_AGENTS_SCHEMA: Dict[str, Any] = {
    "name": "staffroom_list_agents",
    "description": (
        "List every agent defined in the operator's Staff Room OS — their "
        "names, roles, models, and whether they're enabled. Call this when "
        "the operator asks 'what agents do I have', 'who's on my team', "
        "'who can do X', or similar. Always prefer this over guessing."
    ),
    "parameters": {"type": "object", "properties": {}},
}

RECENT_ACTIVITY_SCHEMA: Dict[str, Any] = {
    "name": "staffroom_recent_activity",
    "description": (
        "Recent activity across all agents — session starts, tool calls, "
        "approval requests, session ends — from the audit log. Use when the "
        "operator asks 'what's been happening', 'what did my agents do today', "
        "or 'show me recent activity'. Filter by agent_id if they ask about "
        "a specific one."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "hours": {
                "type": "integer",
                "description": "Look back this many hours. Default 24.",
            },
            "agent_id": {
                "type": "string",
                "description": "Optional: scope to one agent's events.",
            },
            "limit": {
                "type": "integer",
                "description": "Max events to return (default 50).",
            },
        },
    },
}

AGENT_SUMMARY_SCHEMA: Dict[str, Any] = {
    "name": "staffroom_agent_summary",
    "description": (
        "One agent's day-at-a-glance: how many sessions it ran today, the "
        "outcome of its last finished run, cost and token usage. Use when "
        "the operator asks 'how's X doing', 'what did X do today', or 'is "
        "X stuck'."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent_id": {
                "type": "string",
                "description": "The agent id from staffroom_list_agents.",
            },
        },
        "required": ["agent_id"],
    },
}


_TOOLS = (
    ("staffroom_list_agents", LIST_AGENTS_SCHEMA, _handle_list_agents, "👥"),
    ("staffroom_recent_activity", RECENT_ACTIVITY_SCHEMA, _handle_recent_activity, "📋"),
    ("staffroom_agent_summary", AGENT_SUMMARY_SCHEMA, _handle_agent_summary, "📊"),
)


def _check_introspect() -> bool:
    """Always healthy — file-based, no API keys, no daemons. Tools handle
    missing data gracefully (return empty lists with a 'note' explaining why).
    Returning True unconditionally avoids the case where the gateway boots
    before agents.yaml exists and silently disables introspection forever."""
    return True


def _safe(handler):
    """Wrap a tool handler so unexpected exceptions become a structured JSON
    error returned TO the model (visible in the audit log + telegram reply)
    instead of being swallowed as a generic 'tool errored'. Lets Boss tell
    the operator what's actually broken, and gives us a real diagnostic to
    fix it the next time."""
    import functools, traceback as _tb

    @functools.wraps(handler)
    def wrapped(arguments, **kwargs):
        try:
            return handler(arguments, **kwargs)
        except Exception as exc:
            logger.exception("staffroom-introspect handler %s failed", handler.__name__)
            return json.dumps({
                "error": f"{exc.__class__.__name__}: {exc}",
                "trace": _tb.format_exc().splitlines()[-5:],
                "paths": {
                    "STAFFROOM_HOME": str(_staffroom_home()),
                    "HERMES_HOME": str(_hermes_home()),
                    "agents_yaml_exists": _agents_yaml_path().exists(),
                    "audit_dir_exists": _audit_dir().exists(),
                    "state_db_exists": _state_db_path().exists(),
                },
            })
    return wrapped


def register(ctx) -> None:
    """Plugin loader entry point. Called once by HERMÉS at startup."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="staffroom",
            schema=schema,
            handler=_safe(handler),
            check_fn=_check_introspect,
            emoji=emoji,
        )
    logger.info("staffroom-introspect: registered %d tools", len(_TOOLS))
