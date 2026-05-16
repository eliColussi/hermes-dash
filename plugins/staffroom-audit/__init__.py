"""staffroom-audit plugin — append-only audit trail.

Every meaningful agent lifecycle event becomes a JSON line in
$STAFFROOM_HOME/audit/{YYYY-MM-DD}.jsonl. Rotation is by date so deletes
are easy to script and old months can be archived without affecting writes.

Captured events:
  session_start            session began (CLI / gateway / cron / kanban)
  session_end              session ended (with completed/interrupted flag)
  tool_call                tool was invoked (before + after, paired by call_id)
  approval_requested       a dangerous tool is waiting for user approval
  approval_responded       user approved/denied (or it timed out)

The Staff Room OS dashboard tails today's file via /api/audit and shows the
result on the Activity page. Old days can be downloaded via the same API.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Resolve the audit dir at import time so the plugin doesn't have to do it
# on every event. STAFFROOM_HOME defaults to ~/.staff-room-os locally and
# /data/staffroom in the container.
STAFFROOM_HOME = Path(os.environ.get("STAFFROOM_HOME", Path.home() / ".staff-room-os")).expanduser()
AUDIT_DIR = STAFFROOM_HOME / "audit"

_lock = threading.Lock()


def _audit_path() -> Path:
    return AUDIT_DIR / f"{datetime.now(timezone.utc):%Y-%m-%d}.jsonl"


def _write(event_type: str, payload: Dict[str, Any]) -> None:
    """Append one JSONL record. Best-effort; never raises."""
    try:
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event_type,
            **payload,
        }
        line = json.dumps(record, default=str, ensure_ascii=False)
        with _lock:
            with _audit_path().open("a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:
        logger.debug("staffroom-audit: write failed (event=%s): %s", event_type, exc)


# ---------------------------------------------------------------------------
# Hook handlers
# ---------------------------------------------------------------------------

def _on_session_start(session_id: str = "", source: str = "", **kw: Any) -> None:
    _write("session_start", {
        "session_id": session_id,
        "source": source,
        "agent_id": os.environ.get("STAFFROOM_AGENT_ID") or None,
    })


def _on_session_end(
    session_id: str = "",
    completed: bool = True,
    interrupted: bool = False,
    **kw: Any,
) -> None:
    _write("session_end", {
        "session_id": session_id,
        "completed": completed,
        "interrupted": interrupted,
        "agent_id": os.environ.get("STAFFROOM_AGENT_ID") or None,
    })


def _on_pre_tool_call(
    tool_name: str = "",
    args: Optional[Dict[str, Any]] = None,
    tool_call_id: str = "",
    session_id: str = "",
    **kw: Any,
) -> None:
    # Trim args — some tools take large strings (write_file body, terminal cmd
    # output…). The audit log is meant to be greppable, not a full payload store.
    _write("tool_call", {
        "phase": "pre",
        "tool_call_id": tool_call_id,
        "session_id": session_id,
        "tool": tool_name,
        "args_preview": _preview(args),
    })


def _on_post_tool_call(
    tool_name: str = "",
    args: Optional[Dict[str, Any]] = None,
    result: Any = None,
    tool_call_id: str = "",
    session_id: str = "",
    **kw: Any,
) -> None:
    _write("tool_call", {
        "phase": "post",
        "tool_call_id": tool_call_id,
        "session_id": session_id,
        "tool": tool_name,
        "result_preview": _preview(result),
    })


def _on_pre_approval_request(
    command: str = "",
    description: str = "",
    pattern_key: str = "",
    session_key: str = "",
    surface: str = "",
    **kw: Any,
) -> None:
    _write("approval_requested", {
        "command_preview": _trunc(command, 300),
        "description": _trunc(description, 200),
        "pattern_key": pattern_key,
        "session_key": session_key,
        "surface": surface,
    })


def _on_post_approval_response(
    choice: str = "",
    command: str = "",
    pattern_key: str = "",
    session_key: str = "",
    surface: str = "",
    **kw: Any,
) -> None:
    _write("approval_responded", {
        "choice": choice,
        "command_preview": _trunc(command, 300),
        "pattern_key": pattern_key,
        "session_key": session_key,
        "surface": surface,
    })


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _trunc(s: Any, n: int) -> str:
    if s is None:
        return ""
    s = str(s)
    return s if len(s) <= n else s[:n] + f"…(+{len(s) - n})"


def _preview(obj: Any, n: int = 500) -> str:
    """Convert anything to a short, greppable string."""
    if obj is None:
        return ""
    try:
        s = json.dumps(obj, default=str, ensure_ascii=False)
    except Exception:
        s = str(obj)
    return _trunc(s, n)


# ---------------------------------------------------------------------------
# Plugin entry
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("pre_approval_request", _on_pre_approval_request)
    ctx.register_hook("post_approval_response", _on_post_approval_response)
    logger.info("staffroom-audit: registered 6 lifecycle hooks (audit dir=%s)", AUDIT_DIR)
