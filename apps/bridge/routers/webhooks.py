"""Webhooks router: manage HERMÉS dynamic webhook subscriptions.

Subscriptions persist to ~/.hermes/webhook_subscriptions.json and are
hot-reloaded by HERMÉS's webhook adapter without restarting the gateway.

The public URL for each route is the Railway-provided domain (the operator
sets PUBLIC_BASE_URL once in env, or the bridge falls back to the request's
own Host header).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import agent_links, auth, hermes_client as hc
from ..config import HERMES_HOME

router = APIRouter(
    prefix="/api/webhooks",
    tags=["webhooks"],
    dependencies=[Depends(auth.require_token)],
)

_SUBS_FILE = HERMES_HOME / "webhook_subscriptions.json"


# ---------------------------------------------------------------------------
# Storage (matches HERMÉS's format byte-for-byte so its hot-reload picks up
# our writes without restart)
# ---------------------------------------------------------------------------

def _load_subs() -> dict:
    if not _SUBS_FILE.exists():
        return {}
    try:
        data = json.loads(_SUBS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_subs(subs: dict) -> None:
    _SUBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _SUBS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(subs, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _SUBS_FILE)


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * (len(value) - 8) + value[-4:]


def _public_base_url(request: Request) -> str:
    explicit = os.environ.get("PUBLIC_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    return ""


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class WebhookCreate(BaseModel):
    # `name` accepts free text from the new wizard ("Stripe payments") and we
    # slugify server-side; old callers passing a slug already still work.
    name: str = Field(..., description="Human title; slugified to the URL path.")
    description: Optional[str] = None
    prompt: str = Field(
        "",
        description=(
            "Plain-English instructions for the agent. The event payload is "
            "auto-appended invisibly — operators don't need to think about it."
        ),
    )
    agent_id: Optional[str] = Field(
        None,
        description="If set, the trigger runs as this specific Staff Room agent.",
    )
    events: List[str] = Field(default_factory=list, description="Optional header-based event filter.")
    deliver: str = Field(
        "log",
        description="Where to send the response: log | telegram | slack | discord | github_comment.",
    )
    deliver_chat_id: Optional[str] = None
    deliver_only: bool = Field(
        False,
        description="If true, skip the agent — the rendered prompt IS the message sent to `deliver`.",
    )
    skills: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_webhooks(request: Request) -> dict:
    base = _public_base_url(request)
    subs = _load_subs()
    items = []
    for name, route in subs.items():
        items.append({
            "name": name,
            "title": route.get("title") or route.get("description") or name,
            "description": route.get("description", ""),
            "agent_id": route.get("agent_id"),
            "url": f"{base}/wh/{name}" if base else f"/wh/{name}",
            "events": route.get("events", []),
            "secret_masked": _mask(route.get("secret", "")),
            "deliver": route.get("deliver", "log"),
            "deliver_only": bool(route.get("deliver_only", False)),
            "prompt": route.get("user_prompt") or route.get("prompt", ""),
            "skills": route.get("skills", []),
            "created_at": route.get("created_at"),
        })
    return {"items": items, "total": len(items), "base_url": base}


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:48] or f"trigger-{secrets.token_hex(3)}"


def _compose_prompt(user_prompt: str, agent: Optional[dict]) -> str:
    """Wrap the operator's plain-English prompt so the agent always (a) knows
    who it's acting as and (b) receives the full event payload — without the
    operator ever needing to type {payload.x.y.z}."""
    parts: list[str] = []
    if agent:
        identity = (
            f"You are acting as the \"{agent.get('name')}\" agent. "
            f"{agent.get('system_prompt') or agent.get('role') or ''}"
        ).strip()
        if identity:
            parts.append(identity)
    if user_prompt.strip():
        parts.append(user_prompt.strip())
    # If the operator didn't use any payload placeholders, append the raw
    # event dump invisibly so the agent has full context.
    if "{payload" not in user_prompt and "{__raw__}" not in user_prompt:
        parts.append("--- Event data ---\n{__raw__}")
    return "\n\n".join(parts)


@router.post("", status_code=201)
def create_webhook(payload: WebhookCreate, request: Request) -> dict:
    raw_title = payload.name.strip()
    if not raw_title:
        raise HTTPException(400, "Trigger needs a name.")
    name = _slugify(raw_title)
    subs = _load_subs()
    # Ensure slug uniqueness — append a suffix on collision rather than rejecting.
    base_name = name
    suffix = 2
    while name in subs:
        name = f"{base_name}-{suffix}"
        suffix += 1

    if payload.deliver_only and payload.deliver == "log":
        raise HTTPException(
            400,
            "deliver_only requires a real delivery target (telegram, slack, discord, …).",
        )

    agent: Optional[dict] = None
    if payload.agent_id:
        agents = hc.load_agents()
        agent = next((a for a in agents if a.get("id") == payload.agent_id), None)
        if not agent:
            raise HTTPException(404, f"Agent '{payload.agent_id}' not found")

    composed_prompt = _compose_prompt(payload.prompt, agent)

    route = {
        "title": raw_title,
        "description": payload.description or raw_title,
        "agent_id": payload.agent_id,
        "events": payload.events,
        "secret": secrets.token_urlsafe(32),
        "prompt": composed_prompt,
        "user_prompt": payload.prompt,  # preserve original for UI re-display
        "skills": payload.skills,
        "deliver": payload.deliver,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if payload.deliver_only:
        route["deliver_only"] = True
    if payload.deliver_chat_id:
        route["deliver_extra"] = {"chat_id": payload.deliver_chat_id}
    subs[name] = route
    _save_subs(subs)
    if payload.agent_id:
        agent_links.link_webhook(payload.agent_id, name)

    base = _public_base_url(request)
    return {
        "name": name,
        "url": f"{base}/wh/{name}" if base else f"/wh/{name}",
        "secret": route["secret"],
        "note": (
            "Save this secret — it's only shown once. Use it for HMAC-SHA256 "
            "signature validation when configuring the source service."
        ),
    }


@router.delete("/{name}", status_code=204)
def delete_webhook(name: str) -> None:
    name = name.strip().lower()
    subs = _load_subs()
    if name not in subs:
        raise HTTPException(404, "Subscription not found")
    del subs[name]
    _save_subs(subs)
    agent_links.unlink_webhook(name)


class WebhookEnableToggle(BaseModel):
    enabled: bool


@router.patch("/{name}")
def toggle_webhook(name: str, payload: WebhookEnableToggle) -> dict:
    """Soft-pause a trigger without losing its config or URL.

    We park the disabled route under a `paused:` prefix so HERMÉS' webhook
    adapter no longer matches incoming POSTs, then restore the original
    name when re-enabled. This way the URL the operator pasted into Stripe
    keeps working the moment they un-pause."""
    name = name.strip().lower()
    subs = _load_subs()
    paused_name = f"__paused__{name}"
    if payload.enabled:
        # Resume: move config back to original key.
        if paused_name in subs and name not in subs:
            subs[name] = subs.pop(paused_name)
            _save_subs(subs)
            return {"name": name, "enabled": True}
        if name in subs:
            return {"name": name, "enabled": True}
        raise HTTPException(404, "Trigger not found")
    else:
        # Pause: move config out of the active key.
        if name in subs:
            subs[paused_name] = subs.pop(name)
            _save_subs(subs)
            return {"name": name, "enabled": False}
        if paused_name in subs:
            return {"name": name, "enabled": False}
        raise HTTPException(404, "Trigger not found")
