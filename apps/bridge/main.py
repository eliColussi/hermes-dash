"""Staff Room OS bridge — FastAPI entrypoint."""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth
from .config import ensure_dirs
from .routers import activity, agents, composio, integrations, logs, overview, schedules, settings, skills, tasks, webhooks

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
app.include_router(settings.router)  # settings router already enforces auth


@app.on_event("startup")
def _startup() -> None:
    ensure_dirs()
    if auth.is_disabled():
        print("⚠️  STAFFROOM_AUTH_DISABLED=1 — running without auth (dev only)")
    else:
        print(f"🔐 Bridge token: {auth.current_token()}")
        print("   Set STAFFROOM_AUTH_TOKEN in the web env to authenticate.")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "auth_disabled": auth.is_disabled()}
