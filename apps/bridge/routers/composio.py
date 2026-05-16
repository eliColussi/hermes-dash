"""Composio router: manage toolkits + connected accounts.

The connect flow is two-step under the hood (find-or-create auth_config →
link), but the dashboard sees a single "Connect" button per toolkit.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, composio_link as cc

router = APIRouter(
    prefix="/api/composio",
    tags=["composio"],
    dependencies=[Depends(auth.require_token)],
)


class ConnectRequest(BaseModel):
    toolkit: str
    callback_url: Optional[str] = None


def _require_client():
    client = cc.get_client()
    if client is None:
        raise HTTPException(503, "Composio not configured. Set COMPOSIO_API_KEY.")
    return client


def _toolkit_slug(toolkit_obj) -> str:
    """Composio's response objects expose toolkit as either a dict or an
    ItemToolkit nested model — handle both."""
    if toolkit_obj is None:
        return ""
    if isinstance(toolkit_obj, dict):
        return toolkit_obj.get("slug") or toolkit_obj.get("name") or ""
    return getattr(toolkit_obj, "slug", None) or getattr(toolkit_obj, "name", None) or ""


def _find_auth_config_id(client, toolkit: str) -> Optional[str]:
    """Look up an existing Composio-managed auth_config for this toolkit."""
    try:
        resp = client.auth_configs.list()
    except Exception:
        return None
    for ac in resp.items:
        if _toolkit_slug(getattr(ac, "toolkit", None)).lower() == toolkit.lower():
            return getattr(ac, "id", None)
    return None


def _create_managed_auth_config(client, toolkit: str) -> str:
    """Create a Composio-managed auth_config (Composio supplies the OAuth app).
    Used when the user has no auth_config for this toolkit yet."""
    resp = client.auth_configs.create(
        toolkit=toolkit,
        options={"type": "use_composio_managed_auth"},
    )
    return getattr(resp, "id")


# ---------------------------------------------------------------------------


@router.get("/status")
def status() -> dict:
    return {
        "configured": cc.is_configured(),
        "user_id": cc.STAFFROOM_USER_ID,
        "init_error": cc.init_error(),
    }


@router.get("/toolkits")
def list_toolkits() -> dict:
    """Returns the full Composio catalog with logos. Walks pagination so the
    UI gets all ~1000+ toolkits in one call (small payload, cached well)."""
    client = _require_client()
    items: list[dict] = []
    cursor: Optional[str] = None
    safety = 20  # at 1000 per page that's 20k toolkits — way more than reality
    while safety > 0:
        try:
            resp = (
                client.toolkits.list(cursor=cursor) if cursor else client.toolkits.list()
            )
        except Exception as exc:
            raise HTTPException(502, f"Composio API error: {type(exc).__name__}: {exc}")
        for tk in resp.items:
            # tk.meta is a Pydantic model (ItemMeta), not a dict
            meta = getattr(tk, "meta", None)
            logo = ""
            description = ""
            categories: list[str] = []
            if meta is not None:
                logo = getattr(meta, "logo", "") or ""
                description = getattr(meta, "description", "") or ""
                cats = getattr(meta, "categories", []) or []
                for c in cats:
                    name = getattr(c, "name", None) or getattr(c, "id", None)
                    if name:
                        categories.append(name)
            items.append({
                "slug": getattr(tk, "slug", None),
                "name": getattr(tk, "name", None) or getattr(tk, "slug", ""),
                "description": description,
                "logo": logo,
                "categories": categories,
            })
        cursor = getattr(resp, "next_cursor", None)
        if not cursor:
            break
        safety -= 1
    return {"items": items, "total": len(items)}


@router.get("/connections")
def list_connections() -> dict:
    client = _require_client()
    try:
        resp = client.connected_accounts.list(user_ids=[cc.STAFFROOM_USER_ID])
    except Exception as exc:
        raise HTTPException(502, f"Composio API error: {type(exc).__name__}: {exc}")
    items = []
    for acc in resp.items:
        items.append({
            "id": getattr(acc, "id", None),
            "toolkit": _toolkit_slug(getattr(acc, "toolkit", None)),
            "status": getattr(acc, "status", ""),
            "created_at": str(getattr(acc, "created_at", "") or ""),
        })
    return {"items": items, "total": len(items)}


@router.post("/connect")
def connect(req: ConnectRequest) -> dict:
    """Returns a Composio-hosted OAuth URL. The user opens it, authorizes,
    and on return their connection appears in /connections."""
    client = _require_client()
    try:
        auth_config_id = _find_auth_config_id(client, req.toolkit)
        if not auth_config_id:
            auth_config_id = _create_managed_auth_config(client, req.toolkit)
        connection_req = client.connected_accounts.link(
            user_id=cc.STAFFROOM_USER_ID,
            auth_config_id=auth_config_id,
            callback_url=req.callback_url,
        )
    except Exception as exc:
        raise HTTPException(502, f"Composio API error: {type(exc).__name__}: {exc}")
    return {
        "toolkit": req.toolkit,
        "redirect_url": getattr(connection_req, "redirect_url", None),
        "connection_id": getattr(connection_req, "id", None),
    }


@router.delete("/connections/{connection_id}", status_code=204)
def disconnect(connection_id: str) -> None:
    client = _require_client()
    try:
        client.connected_accounts.delete(nanoid=connection_id)
    except Exception as exc:
        raise HTTPException(502, f"Composio API error: {type(exc).__name__}: {exc}")
