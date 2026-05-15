"""Settings endpoints: expose token + paths (auth-gated)."""
from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, Depends

from .. import auth
from ..config import HERMES_HOME, STAFFROOM_HOME

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(auth.require_token)])


@router.get("")
def get_settings() -> dict:
    return {
        "token": auth.current_token() if not auth.is_disabled() else None,
        "auth_disabled": auth.is_disabled(),
        "hermes_home": str(HERMES_HOME),
        "staffroom_home": str(STAFFROOM_HOME),
        "env": {
            "STAFFROOM_AUTH_TOKEN": "set" if os.environ.get("STAFFROOM_AUTH_TOKEN") else "unset",
            "STAFFROOM_AUTH_DISABLED": os.environ.get("STAFFROOM_AUTH_DISABLED", "0"),
        },
    }


@router.post("/rotate-token")
def rotate_token() -> dict:
    """Rotate the persisted token. Requires a restart to take effect for clients."""
    if auth.is_disabled():
        return {"rotated": False, "reason": "auth disabled"}
    new_token = secrets.token_urlsafe(32)
    auth.TOKEN_FILE.write_text(new_token)
    try:
        os.chmod(auth.TOKEN_FILE, 0o600)
    except OSError:
        pass
    return {"rotated": True, "token": new_token, "note": "Restart the bridge for the new token to take effect."}
