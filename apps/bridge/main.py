"""Staff Room OS bridge — FastAPI entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import ensure_dirs
from .routers import activity, agents, integrations, logs, overview, skills, tasks

app = FastAPI(title="Staff Room OS Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3737", "http://127.0.0.1:3737"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(overview.router)
app.include_router(agents.router)
app.include_router(tasks.router)
app.include_router(activity.router)
app.include_router(logs.router)
app.include_router(skills.router)
app.include_router(integrations.router)


@app.on_event("startup")
def _startup() -> None:
    ensure_dirs()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
