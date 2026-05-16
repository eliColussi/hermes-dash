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
    """Synchronous chat turn via the HERMÉS gateway's api_server platform.

    The gateway is a long-lived process — no Python startup per message —
    so a simple POST/await is the right shape. ~3-5s for a no-tool message,
    longer for tool-heavy turns (bounded by the actual model + tool work,
    not by our infrastructure)."""
    threads = _load_threads()
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if not thread:
        raise HTTPException(404, "Thread not found")

    agents = hc.load_agents()
    agent = next((a for a in agents if a.get("id") == thread["agent_id"]), None)
    if not agent:
        raise HTTPException(404, "Agent for this thread no longer exists")

    toolsets_list = agent.get("toolsets") or (
        [agent.get("toolset")] if agent.get("toolset") and agent.get("toolset") != "default" else []
    )
    toolkits = _connected_composio_toolkits() if "composio" in (toolsets_list or []) else []
    system_prompt = _compose_system_prompt(agent, toolkits)

    headers = {"Content-Type": "application/json"}
    # The api_server gates session continuation on an API key. start.sh mints
    # one at boot; pass it as Bearer so the X-Hermes-Session-Id header is
    # honoured on turn 2+.
    api_key = os.environ.get("API_SERVER_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if thread.get("session_id"):
        headers["X-Hermes-Session-Id"] = thread["session_id"]

    body = {
        "model": agent.get("model", "claude-sonnet-4-6"),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.content},
        ],
    }

    started = time.time()
    try:
        r = httpx.post(_GATEWAY_URL, json=body, headers=headers, timeout=180.0)
    except httpx.RequestError as exc:
        raise HTTPException(
            503,
            "Couldn't reach the HERMÉS gateway. It usually takes ~15s to come "
            "up after a redeploy — try again. If it persists, ask your team "
            f"to check the Railway logs. ({type(exc).__name__})",
        )
    elapsed = time.time() - started
    print(f"[chat-timing] thread={thread_id} gateway_total={elapsed:.2f}s status={r.status_code}")

    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"Gateway error: {r.text[:400]}")

    # Pin the session on first turn so subsequent messages continue it.
    session_id = r.headers.get("X-Hermes-Session-Id")
    if session_id and not thread.get("session_id"):
        thread["session_id"] = session_id
        if thread.get("title") == "New conversation":
            thread["title"] = payload.content.strip()[:60]
        _save_threads(threads)

    return {
        "thread": thread,
        "messages": _thread_messages(thread.get("session_id")),
    }
