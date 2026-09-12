"""Home: the one screen a business owner needs.

GET /api/home  -> setup state, connected apps + their numbers, agents, recent runs.
Everything here already exists elsewhere in the bridge; this just puts it in one
call so the page renders in one round trip.
"""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, Depends, Query

from .. import auth, composio_link as cc, hermes_client as hc
from ..config import CLIENT_DIR
from ..services import metrics
from .agents import _materialize
from .composio import _toolkit_slug
from .runs import recent_runs

router = APIRouter(prefix="/api/home", tags=["home"], dependencies=[Depends(auth.require_token)])


def _client_info() -> dict:
    p = CLIENT_DIR / "client.json"
    if p.exists():
        try:
            d = json.loads(p.read_text())
            return {"business_name": d.get("business_name") or "", "one_liner": d.get("one_liner") or ""}
        except Exception:  # noqa: BLE001
            pass
    return {"business_name": "", "one_liner": ""}


def _connected_toolkits() -> tuple[list[str], str | None]:
    client = cc.get_client()
    if client is None:
        return [], cc.init_error()
    try:
        resp = client.connected_accounts.list(user_ids=[cc.STAFFROOM_USER_ID])
    except Exception as exc:  # noqa: BLE001
        return [], f"{type(exc).__name__}: {exc}"[:160]
    out: list[str] = []
    for acc in getattr(resp, "items", []) or []:
        status = str(getattr(acc, "status", "") or "").upper()
        slug = _toolkit_slug(getattr(acc, "toolkit", None)).lower()
        if slug and status in ("ACTIVE", "", "CONNECTED") and slug not in out:
            out.append(slug)
    return out, None


@router.get("")
def home(refresh: bool = Query(False)) -> dict:
    llm = next((n for e, n in (("OPENROUTER_API_KEY", "OpenRouter"), ("ANTHROPIC_API_KEY", "Anthropic"), ("OPENAI_API_KEY", "OpenAI")) if os.environ.get(e)), None)
    connected, composio_error = _connected_toolkits()
    tiles = metrics.collect(connected, refresh=refresh) if connected else []
    agents = [_materialize(a).model_dump() for a in hc.load_agents() if a.get("enabled", True)]
    recent = recent_runs(limit=8).get("items", [])
    return {
        "client": _client_info(),
        "setup": {
            "llm_ready": llm is not None,
            "llm_provider": llm,
            "composio_configured": cc.is_configured(),
            "composio_error": composio_error,
        },
        "connected": connected,
        "metrics": tiles,
        "suggestions": metrics.suggestions(connected),
        "agents": agents,
        "recent": recent,
    }
