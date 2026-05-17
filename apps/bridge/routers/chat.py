"""In-dashboard chat with agents.

Architecture: POST to the HERMÉS gateway's built-in OpenAI-compatible
api_server (POST /v1/chat/completions). The gateway is a long-lived
process holding the model client, tools and plugins warm — so each
chat turn is just one HTTP round-trip, no per-message Python startup.
Session continuity rides on the X-Hermes-Session-Id header. Message
history is still persisted to state.db by hermes itself, so Activity,
Usage, and audit all stay consistent with scheduled / triggered runs.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Iterator, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth, composio_link as cc, hermes_client as hc
from ..config import HERMES_STATE_DB, STAFFROOM_HOME

_GATEWAY_URL = (
    f"http://{os.environ.get('API_SERVER_HOST', '127.0.0.1')}:"
    f"{os.environ.get('API_SERVER_PORT', '8642')}/v1/chat/completions"
)

# Tracks chat turns in flight. Lets GET /messages know whether to keep
# polling and lets the UI show a subtle "working…" indicator. Cleared
# when the gateway call returns (success or fail).
_PENDING: dict[str, dict] = {}  # thread_id -> {"started": float, "user_msg": str}

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


def _strip_briefing(content: Optional[str]) -> Optional[str]:
    """Drop the `[Context: ...]` preamble we prepend on first turn so the
    operator only sees their actual text in the chat surface."""
    if not content:
        return content
    # Older wrapper, kept for messages written before this commit
    if "<<< END BRIEFING >>>" in content:
        return content.split("<<< END BRIEFING >>>", 1)[1].strip()
    # Current wrapper: [Context: ...]\n\n<message>
    if content.startswith("[Context:"):
        # Match the bracket pair conservatively — find the closing ] on the
        # same context line, then strip the blank line after it.
        end = content.find("]\n")
        if end > 0:
            return content[end + 2 :].lstrip()
    return content


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
        out = []
        for r in rows:
            d = dict(r)
            if d.get("role") == "user":
                d["content"] = _strip_briefing(d.get("content"))
            out.append(d)
        return out


def _connected_composio_toolkits() -> list[str]:
    """Names of toolkits with an active Composio connection. Empty if Composio
    isn't configured or the operator hasn't connected anything yet."""
    client = cc.get_client()
    if client is None:
        return []
    try:
        resp = client.connected_accounts.list(user_ids=[cc.STAFFROOM_USER_ID])
    except Exception:
        return []
    out: list[str] = []
    for acc in getattr(resp, "items", []) or []:
        tk = getattr(acc, "toolkit", None)
        slug = (
            (tk.get("slug") or tk.get("name") or "") if isinstance(tk, dict)
            else (getattr(tk, "slug", None) or getattr(tk, "name", None) or "")
        )
        if slug and slug not in out:
            out.append(slug)
    return out


def _agent_scoped_toolkits(agent: dict) -> list[str]:
    """Intersect the agent's allow-list (if any) with the toolkits currently
    connected at the Composio level. Empty allow-list = no restriction →
    fall back to every connected toolkit (legacy behaviour)."""
    connected = _connected_composio_toolkits()
    allow = agent.get("composio_toolkits")
    if not allow:
        return connected
    return [t for t in connected if t in allow]


_TOOLKIT_NICE_NAMES = {
    "gmail": "Gmail", "googlecalendar": "Google Calendar", "googledrive": "Google Drive",
    "slack": "Slack", "notion": "Notion", "github": "GitHub", "linear": "Linear",
    "hubspot": "HubSpot", "stripe": "Stripe", "calendly": "Calendly",
    "airtable": "Airtable", "asana": "Asana", "trello": "Trello", "zoom": "Zoom",
    "discord": "Discord", "intercom": "Intercom", "salesforce": "Salesforce",
    "shopify": "Shopify",
}


def _compose_system_prompt(agent: dict, toolkits: list[str]) -> str:
    """Minimal context — name, role, connected apps. Modern tool-calling
    models don't need a 200-token primer on how to use tools; that just
    bloats every turn and triggers reasoning passes the user doesn't want
    for a simple "hey what's up"."""
    base = (agent.get("system_prompt") or agent.get("description") or "").strip()
    name = agent.get("name") or "the agent"
    parts = [f"You are {name}." + (f" {base}" if base else "")]
    if toolkits:
        nice = ", ".join(_TOOLKIT_NICE_NAMES.get(t, t.title()) for t in toolkits)
        parts.append(f"Connected apps available via tools: {nice}.")
    return " ".join(parts)


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


async def _run_gateway_turn(
    thread_id: str,
    user_msg: str,
    headers: dict,
    body: dict,
) -> None:
    """Background task that fires the gateway POST and updates thread state
    when it finishes. Tool-heavy turns can take many minutes; the UI keeps
    showing progress via state.db polling while this runs."""
    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            r = await client.post(_GATEWAY_URL, json=body, headers=headers)
        if r.status_code >= 400:
            print(f"[chat] gateway error thread={thread_id} status={r.status_code} body={r.text[:300]}")
            return
        # Pin session on first turn
        session_id = r.headers.get("X-Hermes-Session-Id")
        if session_id:
            threads = _load_threads()
            thread = next((t for t in threads if t["id"] == thread_id), None)
            if thread and not thread.get("session_id"):
                thread["session_id"] = session_id
                if thread.get("title") == "New conversation":
                    thread["title"] = user_msg.strip()[:60]
                _save_threads(threads)
    except Exception as exc:
        print(f"[chat] gateway call failed thread={thread_id}: {type(exc).__name__}: {exc}")
    finally:
        _PENDING.pop(thread_id, None)


@router.get("/threads/{thread_id}/messages")
def get_messages(thread_id: str) -> dict:
    threads = _load_threads()
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if not thread:
        raise HTTPException(404, "Thread not found")
    pending = _PENDING.get(thread_id)
    messages = _thread_messages(thread.get("session_id"))
    # Keep the just-sent user message visible while the session is still
    # being pinned (first turn, gateway hasn't returned yet).
    if pending and not messages:
        messages = [{
            "id": -1, "role": "user", "content": pending["user_msg"],
            "tool_calls": None, "tool_name": None, "tool_call_id": None,
            "timestamp": pending["started"], "reasoning": None,
        }]
    return {
        "thread": thread,
        "messages": messages,
        "running": pending is not None,
        "elapsed_sec": (time.time() - pending["started"]) if pending else None,
    }


@router.post("/threads/{thread_id}/messages")
async def send_message(thread_id: str, payload: MessageSend) -> dict:
    """Kick off the gateway call as a background task and return immediately.

    The UI polls GET /messages every ~1.5s, watching tool calls + text
    appear in state.db live as hermes works through them. This is the
    right shape for chat turns that may involve many minutes of tool
    execution (Gmail fetches, multi-step actions, etc.)."""
    threads = _load_threads()
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if not thread:
        raise HTTPException(404, "Thread not found")
    if thread_id in _PENDING:
        raise HTTPException(409, "The agent is still responding to your last message.")

    agents = hc.load_agents()
    agent = next((a for a in agents if a.get("id") == thread["agent_id"]), None)
    if not agent:
        raise HTTPException(404, "Agent for this thread no longer exists")

    toolsets_list = agent.get("toolsets") or (
        [agent.get("toolset")] if agent.get("toolset") and agent.get("toolset") != "default" else []
    )
    toolkits = _agent_scoped_toolkits(agent) if "composio" in (toolsets_list or []) else []
    system_prompt = _compose_system_prompt(agent, toolkits)

    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("API_SERVER_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if thread.get("session_id"):
        headers["X-Hermes-Session-Id"] = thread["session_id"]

    body = {
        "model": agent.get("model", "anthropic/claude-sonnet-4.6"),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.content},
        ],
    }

    started = time.time()
    _PENDING[thread_id] = {"started": started, "user_msg": payload.content}
    asyncio.create_task(_run_gateway_turn(thread_id, payload.content, headers, body))

    existing = _thread_messages(thread.get("session_id"))
    if not existing:
        existing = [{
            "id": -1, "role": "user", "content": payload.content,
            "tool_calls": None, "tool_name": None, "tool_call_id": None,
            "timestamp": started, "reasoning": None,
        }]
    return {
        "thread": thread,
        "messages": existing,
        "running": True,
        "elapsed_sec": 0.0,
    }
