"""Settings endpoints: expose token + paths (auth-gated)."""
from __future__ import annotations

import io
import os
import tarfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .. import auth, persistence
from ..config import HERMES_HOME, STAFFROOM_HOME

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(auth.require_token)])


@router.get("")
def get_settings() -> dict:
    # We never return the bearer token from a GET. The operator sees it once
    # on rotation and is expected to record it somewhere safe.
    return {
        "token_present": not auth.is_disabled(),
        "token_fingerprint": auth.token_fingerprint(),
        "auth_disabled": auth.is_disabled(),
        "persistence": persistence.status(),
        "env": {
            "STAFFROOM_AUTH_TOKEN": "set" if os.environ.get("STAFFROOM_AUTH_TOKEN") else "unset",
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
    # Return only an abstract command name — never the absolute server-side
    # binary path or HERMES_HOME. The operator's own `which hermes` resolves
    # the path on their workstation; disclosing ours is recon for an attacker.
    return {
        "claude_code": {
            "mcpServers": {
                "hermes": {
                    "command": "hermes",
                    "args": ["mcp", "serve"],
                }
            }
        },
        "instructions": (
            "Save to ~/.claude/claude_desktop_config.json (macOS) or "
            "%APPDATA%\\Claude\\claude_desktop_config.json (Windows). "
            "If you already have an `mcpServers` block, merge the `hermes` "
            "entry into it. Restart Claude Code after editing. The `command` "
            "value above assumes `hermes` is on your PATH — if `which hermes` "
            "returns a path on your machine, paste that path in instead."
        ),
    }


# Items skipped from backup — caches that bloat the tarball with no value.
_BACKUP_EXCLUDE = {
    "logs",        # rotated logs, recoverable
    "sessions",    # JSON trajectory dumps, large; state.db is authoritative
    "plugins",     # symlinks to /app/plugins (would dereference; restore via image)
    "checkpoints", # internal
}

# Credential files that MUST NOT appear in a downloadable backup. An authed
# operator may legitimately want a backup of agent config / state / audit log,
# but the .env, vault key, session secret, bearer token, and api-server key
# would let anyone with the tarball impersonate the entire deploy. Matched on
# basename so this catches the file regardless of nesting.
_CREDENTIAL_BASENAMES = {
    ".env",
    "secrets.key",
    "vault.key",
    "session-secret",
    "token",
    "api-server-key",
}


def _tar_dir(tf: tarfile.TarFile, src: Path, arc_prefix: str) -> None:
    if not src.exists():
        return
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if rel.parts and rel.parts[0] in _BACKUP_EXCLUDE:
            continue
        if path.name in _CREDENTIAL_BASENAMES:
            continue
        try:
            tf.add(path, arcname=f"{arc_prefix}/{rel}", recursive=False)
        except (OSError, ValueError):
            continue


@router.get("/backup")
def backup() -> StreamingResponse:
    """Stream a .tar.gz of HERMES_HOME + STAFFROOM_HOME state.

    Excludes caches/logs/checkpoints/sessions for size, and ALL credential
    files (.env, secrets.key, session-secret, token, api-server-key) for
    safety — those must be re-supplied via Railway env vars on restore.
    Includes state.db, config.yaml, kanban.db, webhook_subscriptions.json,
    agents.yaml, audit/, runtime/, skills/.
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
    """Rotate the bearer token. The new value is returned EXACTLY ONCE — copy
    it now; no GET endpoint will return it again. The old token stops being
    accepted immediately (in-process)."""
    if auth.is_disabled():
        return {"rotated": False, "reason": "auth disabled"}
    new_token = auth.rotate_token()
    return {
        "rotated": True,
        "token": new_token,
        "note": (
            "Copy this token now — it will not be shown again. Update "
            "STAFFROOM_AUTH_TOKEN in Railway and any external integrations."
        ),
    }
