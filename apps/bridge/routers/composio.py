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
    # When the toolkit needs user-supplied credentials (API key, bearer
    # token, basic auth, etc.) the dashboard collects them via a form and
    # posts them here. Omit for managed-OAuth toolkits — the original flow
    # still works for those.
    auth_scheme: Optional[str] = None  # "OAUTH2" | "API_KEY" | "BEARER_TOKEN" | "BASIC" | ...
    credentials: Optional[dict] = None


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


def _create_custom_auth_config(client, toolkit: str, scheme: str) -> str:
    """Create a non-managed auth_config for API-key / bearer / basic auth.

    Used when Composio doesn't supply OAuth credentials for this toolkit —
    the user has to bring their own (API key, bearer token, username +
    password). We still let Composio store + encrypt the credentials; we
    just tell it which scheme to expect.
    """
    resp = client.auth_configs.create(
        toolkit=toolkit,
        options={"type": "use_custom_auth", "auth_scheme": scheme},
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


@router.get("/auth-schemes/{toolkit}")
def auth_schemes(toolkit: str) -> dict:
    """Discover how a toolkit authenticates so the dashboard can choose
    between the one-click OAuth popup and the credential-input form.

    Returns:
      - managed_oauth: bool   — true when Composio supplies the OAuth app
                                (Gmail, Slack, GitHub, etc.) → operator just
                                clicks a link and authorizes
      - schemes: [{mode, name, fields, auth_hint_url}] — for non-OAuth
                                toolkits, the fields the operator needs to
                                fill in (API key, bearer token, etc.)
    """
    client = _require_client()
    try:
        # The high-level SDK uses .get(slug=...) — it wraps the low-level
        # toolkits.retrieve() under the hood. .retrieve() doesn't exist on
        # the Toolkits proxy class itself.
        tk = client.toolkits.get(slug=toolkit)
    except Exception as exc:
        raise HTTPException(502, f"Composio API error: {type(exc).__name__}: {exc}")

    managed = list(getattr(tk, "composio_managed_auth_schemes", None) or [])
    # "managed OAuth available" means the user can connect in ONE click
    # because Composio supplies the OAuth credentials. Other managed
    # schemes (API_KEY, BEARER_TOKEN, BASIC) are still "managed" by Composio
    # but the user has to bring the credential themselves — those need
    # the credential form, not the popup.
    managed_oauth = any(s in managed for s in ("OAUTH2", "OAUTH1"))
    schemes: list[dict] = []
    for detail in (getattr(tk, "auth_config_details", None) or []):
        mode = (getattr(detail, "mode", "") or "").upper()
        fields_obj = getattr(detail, "fields", None)
        init = getattr(fields_obj, "connected_account_initiation", None) if fields_obj else None
        required = getattr(init, "required", None) or []
        optional = getattr(init, "optional", None) or []
        def _shape(f):
            return {
                "name": getattr(f, "name", ""),
                "label": getattr(f, "display_name", "") or getattr(f, "name", ""),
                "description": getattr(f, "description", "") or "",
                "type": getattr(f, "type", "string"),
                "is_secret": bool(getattr(f, "is_secret", False)),
                "default": getattr(f, "default", None),
            }
        schemes.append({
            "mode": mode,
            "name": getattr(detail, "name", mode or "Custom"),
            "auth_hint_url": getattr(detail, "auth_hint_url", None),
            "fields": [_shape(f) for f in required] + [
                {**_shape(f), "optional": True} for f in optional
            ],
        })
    return {
        "toolkit": toolkit,
        "managed_oauth": managed_oauth,
        "managed_schemes": managed,
        "schemes": schemes,
    }


@router.post("/connect")
def connect(req: ConnectRequest) -> dict:
    """Initiate a connection.

    Two paths:
      1. Managed OAuth — no credentials supplied; Composio handles the
         OAuth dance, we return a redirect_url for the popup.
      2. Custom auth — credentials supplied; we create a custom auth_config
         with the right scheme and Composio stores them. No redirect_url;
         the connection is active immediately.
    """
    client = _require_client()
    try:
        if req.credentials and req.auth_scheme:
            # Custom-auth path (API_KEY / BEARER_TOKEN / BASIC / etc.)
            auth_config_id = _create_custom_auth_config(
                client, req.toolkit, req.auth_scheme,
            )
            connection_req = client.connected_accounts.link(
                user_id=cc.STAFFROOM_USER_ID,
                auth_config_id=auth_config_id,
                callback_url=req.callback_url,
                # Composio's link() accepts credentials in extra_body for
                # non-OAuth schemes. The SDK passes anything in **kwargs
                # through; this is how API-key tokens get attached.
                **{"credentials": req.credentials},
            )
        else:
            # Managed-OAuth path (existing behavior).
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
