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

from .. import auth
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
    name: str = Field(..., description="Slug like 'stripe-payment'. Becomes part of the URL.")
    description: Optional[str] = None
    prompt: str = Field(
        "",
        description=(
            "Prompt template. The webhook payload is available as `{payload}` and "
            "individual fields as `{payload.amount}` etc."
        ),
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
            "description": route.get("description", ""),
            "url": f"{base}/wh/{name}" if base else f"/wh/{name}",
            "events": route.get("events", []),
            "secret_masked": _mask(route.get("secret", "")),
            "deliver": route.get("deliver", "log"),
            "deliver_only": bool(route.get("deliver_only", False)),
            "prompt": route.get("prompt", ""),
            "skills": route.get("skills", []),
            "created_at": route.get("created_at"),
        })
    return {"items": items, "total": len(items), "base_url": base}


@router.post("", status_code=201)
def create_webhook(payload: WebhookCreate, request: Request) -> dict:
    name = payload.name.strip().lower().replace(" ", "-")
    if not re.match(r"^[a-z0-9][a-z0-9_-]*$", name):
        raise HTTPException(
            400,
            "Invalid name. Use lowercase alphanumeric with hyphens/underscores.",
        )

    if payload.deliver_only and payload.deliver == "log":
        raise HTTPException(
            400,
            "deliver_only requires a real delivery target (telegram, slack, discord, …).",
        )

    subs = _load_subs()
    route = {
        "description": payload.description or f"Created via Staff Room OS: {name}",
        "events": payload.events,
        "secret": secrets.token_urlsafe(32),
        "prompt": payload.prompt,
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
