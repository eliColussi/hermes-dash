"""composio plugin — exposes Composio's 250+ app integrations to HERMÉS agents.

Tools:
  composio_list_apps     — what apps the operator has connected via the dashboard
  composio_list_actions  — what actions a given app supports (e.g. GMAIL_SEND_EMAIL)
  composio_execute       — run an action on a connected app

The operator manages OAuth connections from the Staff Room OS Integrations tab.
This plugin only handles agent-side execution; it never initiates new
connections itself.

Requires env: COMPOSIO_API_KEY. Optional: COMPOSIO_USER_ID (defaults to
"staffroom" — must match the bridge so agent + dashboard share connections).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

STAFFROOM_USER_ID = os.environ.get("COMPOSIO_USER_ID", "staffroom")
_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        return None
    try:
        from composio import Composio
        _client = Composio(api_key=key)
        return _client
    except Exception as exc:
        logger.warning("composio plugin: client init failed: %s", exc)
        return None


def _check_composio() -> bool:
    return bool(os.environ.get("COMPOSIO_API_KEY"))


def _toolkit_slug(t) -> str:
    if t is None:
        return ""
    if isinstance(t, dict):
        return t.get("slug") or t.get("name") or ""
    return getattr(t, "slug", None) or getattr(t, "name", None) or ""


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

LIST_APPS_SCHEMA: Dict[str, Any] = {
    "name": "composio_list_apps",
    "description": (
        "List the apps the operator has connected through the Staff Room OS "
        "Integrations tab (e.g. gmail, slack, hubspot). Returns connection ids "
        "and their status. Call this first when you need to know what tools "
        "are available before composio_list_actions or composio_execute."
    ),
    "parameters": {"type": "object", "properties": {}},
}

LIST_ACTIONS_SCHEMA: Dict[str, Any] = {
    "name": "composio_list_actions",
    "description": (
        "List the actions a Composio toolkit supports — useful for discovering "
        "what an app can do. Returns OpenAI-style function schemas. Use the "
        "returned action name as the `action` parameter of composio_execute."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "toolkit": {
                "type": "string",
                "description": "Toolkit slug, e.g. 'gmail', 'slack', 'stripe'.",
            },
            "search": {
                "type": "string",
                "description": "Optional fuzzy filter on action names.",
            },
            "limit": {
                "type": "integer",
                "description": "Max number of actions to return (default 20).",
            },
        },
        "required": ["toolkit"],
    },
}

EXECUTE_SCHEMA: Dict[str, Any] = {
    "name": "composio_execute",
    "description": (
        "Execute a single Composio action on a connected app. Examples: send a "
        "Gmail email, post to a Slack channel, create a Stripe customer. "
        "Discover available actions with composio_list_actions first. Returns "
        "the action's response data or an error message."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "Composio action slug, e.g. 'GMAIL_SEND_EMAIL'.",
            },
            "arguments": {
                "type": "object",
                "description": (
                    "Arguments object matching the action's parameter schema. "
                    "Get the schema from composio_list_actions."
                ),
            },
        },
        "required": ["action", "arguments"],
    },
}


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _handle_list_apps(args: Dict[str, Any], **_kw) -> str:
    c = _get_client()
    if c is None:
        return json.dumps({"error": "COMPOSIO_API_KEY not configured on this Staff Room OS install."})
    try:
        resp = c.connected_accounts.list(user_ids=[STAFFROOM_USER_ID])
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
    items = []
    for a in resp.items:
        items.append({
            "id": getattr(a, "id", None),
            "toolkit": _toolkit_slug(getattr(a, "toolkit", None)),
            "status": getattr(a, "status", ""),
        })
    return json.dumps({"connected": items, "user_id": STAFFROOM_USER_ID})


def _handle_list_actions(args: Dict[str, Any], **_kw) -> str:
    c = _get_client()
    if c is None:
        return json.dumps({"error": "COMPOSIO_API_KEY not configured."})
    toolkit = args.get("toolkit")
    if not toolkit:
        return json.dumps({"error": "toolkit is required"})
    search = args.get("search")
    limit = int(args.get("limit", 20))
    try:
        kwargs: Dict[str, Any] = {"user_id": STAFFROOM_USER_ID, "toolkits": [toolkit], "limit": limit}
        if search:
            kwargs["search"] = search
        tools = c.tools.get(**kwargs)
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
    out = []
    for t in tools:
        fn = t.get("function", {}) if isinstance(t, dict) else {}
        out.append({
            "name": fn.get("name"),
            "description": fn.get("description"),
            "parameters": fn.get("parameters"),
        })
    return json.dumps({"toolkit": toolkit, "actions": out})


def _handle_execute(args: Dict[str, Any], **_kw) -> str:
    c = _get_client()
    if c is None:
        return json.dumps({"error": "COMPOSIO_API_KEY not configured."})
    action = args.get("action")
    arguments = args.get("arguments") or {}
    if not action:
        return json.dumps({"error": "action is required"})
    if not isinstance(arguments, dict):
        return json.dumps({"error": "arguments must be an object"})
    try:
        result = c.tools.execute(slug=action, arguments=arguments, user_id=STAFFROOM_USER_ID)
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
    return json.dumps({
        "successful": getattr(result, "successful", None),
        "data": getattr(result, "data", None),
        "error": getattr(result, "error", None),
        "log_id": getattr(result, "log_id", None),
    }, default=str)


_TOOLS = (
    ("composio_list_apps", LIST_APPS_SCHEMA, _handle_list_apps, "🔌"),
    ("composio_list_actions", LIST_ACTIONS_SCHEMA, _handle_list_actions, "📋"),
    ("composio_execute", EXECUTE_SCHEMA, _handle_execute, "⚡"),
)


def register(ctx) -> None:
    """Plugin loader entry point. Called once by HERMÉS at startup."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="composio",
            schema=schema,
            handler=handler,
            check_fn=_check_composio,
            requires_env=["COMPOSIO_API_KEY"],
            emoji=emoji,
        )
    logger.info("composio plugin: registered %d tools (user_id=%s)", len(_TOOLS), STAFFROOM_USER_ID)
