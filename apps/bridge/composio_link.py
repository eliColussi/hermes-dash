"""Composio singleton + Staff Room user_id contract.

We're single-tenant per deploy, so every Composio call uses a fixed user_id.
That user_id IS the Staff Room install — all agents share its connected apps.
When we ship multi-tenant in v2 this becomes per-tenant.
"""
from __future__ import annotations

import os
from typing import Optional

# The fixed Composio user_id for this Staff Room install. Composio scopes
# connected accounts (Gmail, Slack, etc.) by user_id, so picking one identity
# for the whole install means every agent inherits the same connections.
STAFFROOM_USER_ID = os.environ.get("COMPOSIO_USER_ID", "staffroom")

_client = None
_init_error: Optional[str] = None


def get_client():
    """Lazy-init the Composio client. Returns None if no key is set."""
    global _client, _init_error
    if _client is not None:
        return _client
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        return None
    try:
        from composio import Composio  # local import — Composio is optional
        _client = Composio(api_key=key)
        _init_error = None
        return _client
    except Exception as exc:
        _init_error = f"{type(exc).__name__}: {exc}"
        return None


def reset_client() -> None:
    """Call after env vars change so the next get_client() re-initializes."""
    global _client, _init_error
    _client = None
    _init_error = None


def init_error() -> Optional[str]:
    return _init_error


def is_configured() -> bool:
    return bool(os.environ.get("COMPOSIO_API_KEY"))
