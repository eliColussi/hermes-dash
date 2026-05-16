"""Settings endpoints: expose token + paths (auth-gated)."""
from __future__ import annotations

import io
import json
import os
import secrets
import tarfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .. import auth
from ..config import HERMES_BIN, HERMES_HOME, STAFFROOM_HOME

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


@router.get("/mcp-config")
def mcp_config() -> dict:
    """Return the Claude Code / Cursor MCP config snippet for connecting to
    this Staff Room install's HERMÉS messaging bridge.

    HERMÉS already ships a stdio MCP server (vendor/hermes-agent/mcp_serve.py)
    that exposes conversations, messages, send-message, and approval tools.
    Pasting this snippet into ~/.claude/claude_desktop_config.json (or the
    equivalent IDE config) lets the user share memory between their daily
    Claude Code work and their autonomous HERMÉS agents.

    On Railway / Docker deploys the hermes binary lives at /app/apps/bridge/.venv/bin/hermes;
    locally we resolve via HERMES_BIN. The operator copies this snippet into
    their own Claude Code config on their workstation.
    """
    return {
        "claude_code": {
            "mcpServers": {
                "hermes": {
                    "command": HERMES_BIN,
                    "args": ["mcp", "serve"],
                    "env": {"HERMES_HOME": str(HERMES_HOME)},
                }
            }
        },
        "instructions": (
            "Save to ~/.claude/claude_desktop_config.json (macOS) or "
            "%APPDATA%\\Claude\\claude_desktop_config.json (Windows). "
            "If you already have an `mcpServers` block, merge the `hermes` "
            "entry into it. Restart Claude Code after editing. The bridge "
            "binary path assumes your HERMÉS install — if it differs from "
            "the value above, edit the `command` field to point at your "
            "own `hermes` executable (`which hermes`)."
        ),
    }


# Items skipped from backup — caches that bloat the tarball with no value.
_BACKUP_EXCLUDE = {
    "logs",        # rotated logs, recoverable
    "sessions",    # JSON trajectory dumps, large; state.db is authoritative
    "plugins",     # symlinks to /app/plugins (would dereference; restore via image)
    "checkpoints", # internal
}


def _tar_dir(tf: tarfile.TarFile, src: Path, arc_prefix: str) -> None:
    if not src.exists():
        return
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if rel.parts and rel.parts[0] in _BACKUP_EXCLUDE:
            continue
        try:
            tf.add(path, arcname=f"{arc_prefix}/{rel}", recursive=False)
        except (OSError, ValueError):
            continue


@router.get("/backup")
def backup() -> StreamingResponse:
    """Stream a .tar.gz of HERMES_HOME + STAFFROOM_HOME state.

    Excludes caches/logs/checkpoints/sessions for size. Includes state.db,
    config.yaml, .env, kanban.db, webhook_subscriptions.json, agents.yaml,
    audit/, runtime/, skills/.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        _tar_dir(tf, HERMES_HOME, "hermes")
        _tar_dir(tf, STAFFROOM_HOME, "staff-room-os")
    buf.seek(0)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    fname = f"staffroom-backup-{stamp}.tar.gz"

    def _iter():
        chunk = 64 * 1024
        while True:
            data = buf.read(chunk)
            if not data:
                break
            yield data

    return StreamingResponse(
        _iter(),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


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
