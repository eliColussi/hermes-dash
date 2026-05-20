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
        # Refuse to disable auth unless the operator explicitly acknowledges
        # the risk. Prevents a single env-var typo from exposing the whole
        # bridge. The acknowledgement var is intentionally verbose.
        ack = os.environ.get("STAFFROOM_I_UNDERSTAND_AUTH_DISABLED_IS_DEV_ONLY")
        if ack != "yes":
            raise RuntimeError(
                "STAFFROOM_AUTH_DISABLED=1 is set but "
                "STAFFROOM_I_UNDERSTAND_AUTH_DISABLED_IS_DEV_ONLY=yes is not. "
                "Refusing to start with auth disabled. Remove "
                "STAFFROOM_AUTH_DISABLED for production deploys."
            )
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


def token_fingerprint() -> str:
    """Last 4 chars of the token. Safe to surface in /api/settings without
    leaking the credential itself. Empty string when auth is disabled."""
    if not _TOKEN:
        return ""
    return _TOKEN[-4:]


def is_disabled() -> bool:
    return _TOKEN == ""


def rotate_token() -> str:
    """Mint a new token, persist it, and update the in-memory value so the
    old token stops being accepted immediately. Returns the new token. The
    caller is responsible for surfacing it exactly once to the operator —
    we never return it again from any GET endpoint."""
    global _TOKEN
    new_token = secrets.token_urlsafe(32)
    ensure_dirs()
    TOKEN_FILE.write_text(new_token)
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass
    _TOKEN = new_token
    return new_token


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
