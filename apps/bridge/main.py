"""Staff Room OS bridge — FastAPI entrypoint."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the vendored HERMÉS package importable regardless of whether the
# `uv pip install -e /app/vendor/hermes-agent` step in the Dockerfile
# silently failed. Railway has shown the install can quietly skip, which
# left `from gateway.pairing import PairingManager` raising ImportError
# at runtime and surfacing as 500s on the dashboard. Prepending the path
# is idempotent and free.
_VENDOR = Path(__file__).resolve().parent.parent.parent / "vendor" / "hermes-agent"
if _VENDOR.is_dir() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, persistence, vault
from .config import ensure_dirs
from .routers import activity, agents, analytics, approvals, audit, capabilities, chat, composio, goals, home, integrations, logs, overview, runs, schedules, settings, skills, tasks
from .routers import vault as vault_router
from .routers import webhooks

app = FastAPI(title="Staff Room OS Bridge", version="0.1.0")

_origins = os.environ.get(
    "STAFFROOM_CORS_ORIGINS",
    "http://localhost:3737,http://127.0.0.1:3737",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth-gated routers (everything except /api/health and the log WebSocket which
# uses query-string token auth).
_authed = [Depends(auth.require_token)]
app.include_router(overview.router, dependencies=_authed)
app.include_router(agents.router, dependencies=_authed)
app.include_router(tasks.router, dependencies=_authed)
app.include_router(activity.router, dependencies=_authed)
app.include_router(logs.router)  # logs handles auth per-route (WS uses query string)
app.include_router(skills.router, dependencies=_authed)
app.include_router(integrations.router, dependencies=_authed)
app.include_router(composio.router)  # composio router enforces its own auth
app.include_router(schedules.router)  # schedules router enforces its own auth
app.include_router(webhooks.router)  # webhooks router enforces its own auth
app.include_router(audit.router)  # audit router enforces its own auth
app.include_router(approvals.router)  # approvals router enforces its own auth
app.include_router(analytics.router)  # analytics router enforces its own auth
app.include_router(vault_router.router)  # vault router enforces its own auth
app.include_router(goals.router)  # goals router enforces its own auth
app.include_router(settings.router)  # settings router already enforces auth
app.include_router(capabilities.router)  # capabilities router enforces its own auth
app.include_router(chat.router)  # chat router enforces its own auth
app.include_router(runs.router)  # runs router enforces its own auth
app.include_router(home.router)  # home router enforces its own auth


@app.on_event("startup")
def _startup() -> None:
    ensure_dirs()
    persistence.warn_at_startup()
    if auth.is_disabled():
        print("⚠️  STAFFROOM_AUTH_DISABLED=1 — running without auth (dev only)")
    else:
        # Never log the token itself — Railway captures stdout permanently.
        # Print only the fingerprint so an operator can confirm "the bridge
        # is using the same token I set in env" without leaking the value.
        print(f"🔐 Bridge token configured (ends in …{auth.token_fingerprint()})")
        print("   Set STAFFROOM_AUTH_TOKEN in the web env to authenticate.")
    # Decrypt vault and export to os.environ so spawned HERMÉS processes
    # inherit secrets without plaintext .env on disk.
    n = vault.export_to_env()
    if n:
        print(f"🔓 vault: exported {n} secret(s) to environment (key={vault.key_source()})")


@app.get("/api/health")
def health() -> dict:
    # Intentionally minimal — this is the only unauthenticated endpoint
    # on the bridge. Don't leak auth state or filesystem paths to anyone
    # who can reach the container. Authed callers get detail via /api/settings.
    return {"status": "ok"}
