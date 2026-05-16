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

from .. import auth, composio_link as cc, hermes_client as hc
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


_BRIEFING_END = "<<< END BRIEFING >>>"


def _strip_briefing(content: Optional[str]) -> Optional[str]:
    """If a user message starts with our system-briefing wrapper, return only
    the operator's actual text. The briefing is plumbing — it shouldn't
    appear in the chat surface."""
    if not content:
        return content
    if _BRIEFING_END in content:
        return content.split(_BRIEFING_END, 1)[1].strip()
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


def _compose_system_prompt(agent: dict, toolkits: list[str]) -> str:
    """Stitch the agent's authored prompt with operator-supplied context so
    the agent never wastes turns discovering what's already known. Also
    nudges the model toward structured tool calls instead of describing
    tool calls as text (a common failure mode on multi-step tasks)."""
    parts: list[str] = []
    base = (agent.get("system_prompt") or agent.get("description") or "").strip()
    if base:
        parts.append(base)

    if toolkits:
        nice = ", ".join(t.replace("googlecalendar", "Google Calendar")
                          .replace("googledrive", "Google Drive")
                          .replace("github", "GitHub")
                          .replace("hubspot", "HubSpot")
                          .replace("salesforce", "Salesforce")
                          .replace("gmail", "Gmail")
                          .replace("slack", "Slack")
                          .replace("notion", "Notion")
                          .replace("calendly", "Calendly")
                          .replace("stripe", "Stripe")
                          .replace("linear", "Linear")
                          .replace("airtable", "Airtable")
                          .replace("intercom", "Intercom")
                          .replace("zoom", "Zoom")
                          .replace("trello", "Trello")
                          .replace("discord", "Discord")
                          .replace("shopify", "Shopify")
                          .replace("asana", "Asana")
                          .title() if " " not in t else t for t in toolkits)
        parts.append(
            f"### Tools available to you right now\n"
            f"You have these apps already connected via Composio (the user "
            f"linked them in the dashboard): **{nice}**.\n\n"
            f"To use them, call the `composio_execute` tool with the right "
            f"action slug. For example, to read Gmail you'd call `composio_execute` "
            f"with `action='GMAIL_FETCH_EMAILS'`. If you don't know the exact "
            f"action name for a toolkit, call `composio_list_actions` once with "
            f"the toolkit slug — do NOT call `composio_list_apps` first, the "
            f"list above is authoritative."
        )

    parts.append(
        "### How to act\n"
        "When a task requires an external tool, **call the tool directly** "
        "using your structured tool-calling capability. Do not write out tool "
        "calls as JSON in your reply — actually invoke them. After getting "
        "results, respond to the user in plain conversational language with "
        "the outcome, not the raw payload."
    )
    return "\n\n".join(parts)


def _latest_session_for_source(source_tag: str, since: float) -> Optional[str]:
    """Find the session HERMÉS just created. We *prefer* matching by our
    custom source tag, but fall back to the most-recent session started in
    this invocation window — HERMÉS sometimes normalises or strips custom
    source values, and a near-empty bridge has effectively no other writers
    creating sessions in a 30s window."""
    with _state_ro() as conn:
        if conn is None:
            return None
        # Preferred path: exact source match
        row = conn.execute(
            """
            SELECT id, source, started_at FROM sessions
            WHERE source = ? AND started_at >= ?
            ORDER BY started_at DESC LIMIT 1
            """,
            (source_tag, since - 1.0),
        ).fetchone()
        if row:
            return row["id"]
        # Fallback: any session that came into existence during this invocation
        row = conn.execute(
            """
            SELECT id, source, started_at FROM sessions
            WHERE started_at >= ?
            ORDER BY started_at DESC LIMIT 1
            """,
            (since - 1.0,),
        ).fetchone()
        if row:
            print(
                f"[chat] session_id fallback: expected source={source_tag!r}, "
                f"found source={row['source']!r} id={row['id']!r}"
            )
            return row["id"]
        return None


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

    # `hermes chat` has no --system flag, so we inject context into the
    # query text itself. On turn 1 we prepend the full agent identity +
    # connected-apps briefing so the agent never wastes turns discovering
    # what's already known. On turn N>1 the agent has the briefing in its
    # session history and we just send the user's text.
    is_first_turn = not thread.get("session_id")
    if is_first_turn:
        toolkits = _connected_composio_toolkits() if "composio" in (toolsets_list or []) else []
        briefing = _compose_system_prompt(agent, toolkits)
        query_text = (
            f"<<< SYSTEM BRIEFING — read this carefully, then act on the user's message below >>>\n\n"
            f"{briefing}\n\n"
            f"<<< END BRIEFING >>>\n\n"
            f"{payload.content}"
        )
    else:
        query_text = payload.content

    cmd = [
        HERMES_BIN,
        "chat",
        "-q", query_text,
        "--quiet",
        "--source", source_tag,
        "--model", agent.get("model", "claude-sonnet-4-6"),
        "--ignore-rules",  # don't auto-inject random AGENTS.md from the cwd
    ]
    if toolsets_arg:
        cmd.extend(["-t", toolsets_arg])
    if thread.get("session_id"):
        cmd.extend(["-r", thread["session_id"]])

    env = {**os.environ, "STAFFROOM_AGENT_ID": agent["id"]}

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
        tail = (result.stderr or result.stdout or "")[-800:]
        raise HTTPException(502, f"Agent run failed (exit {result.returncode}): {tail}")

    # First turn — find the session HERMÉS just created and pin it.
    if not thread.get("session_id"):
        sid = _latest_session_for_source(source_tag, invocation_start)
        if sid:
            thread["session_id"] = sid
            if thread.get("title") == "New conversation":
                thread["title"] = payload.content.strip()[:60]
            _save_threads(threads)
        else:
            print(
                f"[chat] no session created for thread={thread_id} source={source_tag}. "
                f"stdout tail: {(result.stdout or '')[-400:]!r} | "
                f"stderr tail: {(result.stderr or '')[-400:]!r}"
            )

    messages = _thread_messages(thread.get("session_id"))
    # If the DB returned nothing (e.g. session not found, or hermes wrote to
    # an unexpected place), at minimum surface what hermes printed on stdout
    # so the conversation isn't a silent void. We synthesize a couple of
    # message-shaped records the UI can render.
    if not messages:
        synth: list[dict] = [
            {
                "id": -1,
                "role": "user",
                "content": payload.content,
                "tool_calls": None,
                "tool_name": None,
                "tool_call_id": None,
                "timestamp": invocation_start,
                "reasoning": None,
            }
        ]
        if (result.stdout or "").strip():
            synth.append({
                "id": -2,
                "role": "assistant",
                "content": result.stdout.strip(),
                "tool_calls": None,
                "tool_name": None,
                "tool_call_id": None,
                "timestamp": time.time(),
                "reasoning": None,
            })
        else:
            synth.append({
                "id": -2,
                "role": "assistant",
                "content": (
                    "(The agent finished but didn't return any text. "
                    "This usually means hermes is still installing its model "
                    "client on first use — try again in a few seconds. "
                    "Stderr tail in the bridge logs has details.)"
                ),
                "tool_calls": None,
                "tool_name": None,
                "tool_call_id": None,
                "timestamp": time.time(),
                "reasoning": None,
            })
        messages = synth

    return {"thread": thread, "messages": messages}
