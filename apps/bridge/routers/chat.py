"""In-dashboard chat with agents.

Why this exists: clients want to test/talk to their agents without
configuring Telegram or Slack first. Each thread is a sustained
conversation backed by HERMÉS' own state.db (so it gets the same
session/message persistence, costs, tool-call tracking as a Telegram
chat would). Threads are independent — operators can fork a "fresh"
conversation any time without clobbering memory.

Architecture: we shell out to `hermes chat -q ... -Q -r <session_id>`
per message. On the first turn we omit `-r` and HERMÉS allocates a
new session; we look it up in state.db by the unique `--source` tag
we passed and pin it to the thread. Subsequent turns resume by ID.

This means HERMÉS owns all conversation state — we only store thread
metadata (id, agent, title, session_id) in a tiny JSON file.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth, hermes_client as hc
from ..config import HERMES_BIN, HERMES_STATE_DB, STAFFROOM_HOME

router = APIRouter(
    prefix="/api/chat",
    tags=["chat"],
    dependencies=[Depends(auth.require_token)],
)

_THREADS_FILE = STAFFROOM_HOME / "chat" / "threads.json"


# ---------------------------------------------------------------------------
# Thread storage (JSON file — small, single-tenant, no need for a real DB)
# ---------------------------------------------------------------------------

def _load_threads() -> list[dict]:
    if not _THREADS_FILE.exists():
        return []
    try:
        data = json.loads(_THREADS_FILE.read_text(encoding="utf-8"))
        return data.get("threads", []) if isinstance(data, dict) else []
    except Exception:
        return []


def _save_threads(threads: list[dict]) -> None:
    _THREADS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _THREADS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"threads": threads}, indent=2), encoding="utf-8")
    os.replace(tmp, _THREADS_FILE)


@contextmanager
def _state_ro() -> Iterator[Optional[sqlite3.Connection]]:
    if not HERMES_STATE_DB.exists():
        yield None
        return
    conn = sqlite3.connect(f"file:{HERMES_STATE_DB}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _thread_messages(session_id: Optional[str]) -> list[dict]:
    if not session_id:
        return []
    with _state_ro() as conn:
        if conn is None:
            return []
        rows = conn.execute(
            """
            SELECT id, role, content, tool_calls, tool_name, tool_call_id,
                   timestamp, reasoning
            FROM messages
            WHERE session_id = ?
            ORDER BY timestamp ASC
            """,
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def _latest_session_for_source(source_tag: str, since: float) -> Optional[str]:
    """Find the session HERMÉS just created for a given source tag."""
    with _state_ro() as conn:
        if conn is None:
            return None
        row = conn.execute(
            """
            SELECT id FROM sessions
            WHERE source = ? AND started_at >= ?
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (source_tag, since - 1.0),  # 1s grace for clock skew
        ).fetchone()
        return row["id"] if row else None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ThreadCreate(BaseModel):
    agent_id: str
    title: Optional[str] = None


class ThreadPatch(BaseModel):
    title: Optional[str] = None


class MessageSend(BaseModel):
    content: str = Field(..., min_length=1, max_length=20000)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/threads")
def list_threads(agent_id: Optional[str] = None) -> dict:
    threads = _load_threads()
    if agent_id:
        threads = [t for t in threads if t.get("agent_id") == agent_id]
    # Newest first
    threads.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return {"items": threads, "total": len(threads)}


@router.post("/threads", status_code=201)
def create_thread(payload: ThreadCreate) -> dict:
    agents = hc.load_agents()
    agent = next((a for a in agents if a.get("id") == payload.agent_id), None)
    if not agent:
        raise HTTPException(404, f"Agent '{payload.agent_id}' not found")

    thread = {
        "id": uuid.uuid4().hex[:12],
        "agent_id": payload.agent_id,
        "agent_name": agent.get("name"),
        "title": payload.title or "New conversation",
        "session_id": None,  # populated after first message
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    threads = _load_threads()
    threads.append(thread)
    _save_threads(threads)
    return thread


@router.patch("/threads/{thread_id}")
def patch_thread(thread_id: str, patch: ThreadPatch) -> dict:
    threads = _load_threads()
    for t in threads:
        if t["id"] == thread_id:
            if patch.title is not None:
                t["title"] = patch.title
            _save_threads(threads)
            return t
    raise HTTPException(404, "Thread not found")


@router.delete("/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str) -> None:
    threads = _load_threads()
    new = [t for t in threads if t["id"] != thread_id]
    if len(new) == len(threads):
        raise HTTPException(404, "Thread not found")
    _save_threads(new)


@router.get("/threads/{thread_id}/messages")
def get_messages(thread_id: str) -> dict:
    threads = _load_threads()
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if not thread:
        raise HTTPException(404, "Thread not found")
    return {
        "thread": thread,
        "messages": _thread_messages(thread.get("session_id")),
    }


@router.post("/threads/{thread_id}/messages")
def send_message(thread_id: str, payload: MessageSend) -> dict:
    threads = _load_threads()
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if not thread:
        raise HTTPException(404, "Thread not found")

    agents = hc.load_agents()
    agent = next((a for a in agents if a.get("id") == thread["agent_id"]), None)
    if not agent:
        raise HTTPException(404, "Agent for this thread no longer exists")

    source_tag = f"dashboard:{thread_id}"
    invocation_start = time.time()

    # Compose toolset arg the same way start_agent does.
    toolsets_list = agent.get("toolsets") or (
        [agent.get("toolset")] if agent.get("toolset") and agent.get("toolset") != "default" else []
    )
    toolsets_arg = ",".join(t for t in toolsets_list if t and t != "default")

    cmd = [
        HERMES_BIN,
        "chat",
        "-q", payload.content,
        "--quiet",
        "--source", source_tag,
        "--model", agent.get("model", "claude-sonnet-4-6"),
        "--ignore-rules",  # don't auto-inject random AGENTS.md from the cwd
    ]
    if toolsets_arg:
        cmd.extend(["-t", toolsets_arg])
    if thread.get("session_id"):
        cmd.extend(["-r", thread["session_id"]])

    env = {
        **os.environ,
        "STAFFROOM_AGENT_ID": agent["id"],
        # HERMES_SYSTEM_PROMPT is read by hermes when set; system prompt
        # only applies on first turn of a session.
        "HERMES_SYSTEM_PROMPT": agent.get("system_prompt") or agent.get("description", ""),
    }

    try:
        result = subprocess.run(
            cmd,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min hard cap per turn
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Agent timed out after 5 minutes. Try a shorter message or check the logs.")

    if result.returncode != 0:
        # Surface a clipped tail of stderr so the operator can see what broke.
        tail = (result.stderr or result.stdout or "")[-800:]
        raise HTTPException(502, f"Agent run failed (exit {result.returncode}): {tail}")

    # First turn — find the session HERMÉS just created and pin it.
    if not thread.get("session_id"):
        sid = _latest_session_for_source(source_tag, invocation_start)
        if sid:
            thread["session_id"] = sid
            # Set a friendly title from the first user message if still default
            if thread.get("title") == "New conversation":
                thread["title"] = payload.content.strip()[:60]
            _save_threads(threads)

    messages = _thread_messages(thread.get("session_id"))
    return {"thread": thread, "messages": messages}
