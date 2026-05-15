"""Bearer-token auth for the bridge.

A single shared token is read from $STAFFROOM_AUTH_TOKEN at startup. On first
boot, if neither the env var nor ~/.staff-room-os/token is set, we generate a
strong random token and persist it. The token is surfaced to the operator via
the Settings page.

To bypass auth (local dev only), set STAFFROOM_AUTH_DISABLED=1.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import Header, HTTPException

from .config import STAFFROOM_HOME, ensure_dirs

TOKEN_FILE = STAFFROOM_HOME / "token"
_PUBLIC_PATHS = {"/api/health"}


def _load_or_create_token() -> str:
    if os.environ.get("STAFFROOM_AUTH_DISABLED") == "1":
        return ""
    if (env_token := os.environ.get("STAFFROOM_AUTH_TOKEN")):
        return env_token
    ensure_dirs()
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
        if token:
            return token
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(token)
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass
    return token


_TOKEN = _load_or_create_token()


def current_token() -> str:
    return _TOKEN


def is_disabled() -> bool:
    return _TOKEN == ""


def require_token(authorization: str | None = Header(default=None)) -> None:
    if is_disabled():
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    presented = authorization[7:].strip()
    if not secrets.compare_digest(presented, _TOKEN):
        raise HTTPException(401, "Invalid token")


def require_token_ws(token: str | None) -> None:
    """WebSocket variant — token comes via query string."""
    if is_disabled():
        return
    if not token or not secrets.compare_digest(token, _TOKEN):
        raise HTTPException(401, "Invalid token")
