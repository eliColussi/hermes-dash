"""Per-toolset readiness — surfaced in the Add Agent sheet so operators never
tick a box that silently fails (e.g. web search with no backend key)."""
from __future__ import annotations

import os
import shutil

from fastapi import APIRouter, Depends

from .. import auth, composio_link as cc

router = APIRouter(
    prefix="/api/capabilities",
    tags=["capabilities"],
    dependencies=[Depends(auth.require_token)],
)


def _web_search_backend() -> str | None:
    """Return the name of the configured web-search provider, or None."""
    for env, name in (
        ("EXA_API_KEY", "Exa"),
        ("TAVILY_API_KEY", "Tavily"),
        ("FIRECRAWL_API_KEY", "Firecrawl"),
        ("PARALLEL_API_KEY", "Parallel"),
    ):
        if os.environ.get(env):
            return name
    return None


@router.get("")
def capabilities() -> dict:
    web_backend = _web_search_backend()
    return {
        "items": [
            {
                "id": "composio",
                "ready": cc.is_configured(),
                "detail": "Connected" if cc.is_configured() else "Needs COMPOSIO_API_KEY — ask your team.",
            },
            {
                "id": "memory",
                "ready": True,
                "detail": "Built in — no setup needed.",
            },
            {
                "id": "web",
                "ready": web_backend is not None,
                "detail": (
                    f"Using {web_backend}." if web_backend
                    else "Needs a search provider key (Exa, Tavily, Firecrawl, or Parallel) — ask your team."
                ),
            },
            {
                "id": "code_execution",
                "ready": True,
                "detail": "Built in — sandboxed Python.",
            },
            {
                "id": "browser",
                "ready": True,
                "detail": (
                    "Browserbase cloud." if os.environ.get("BROWSERBASE_API_KEY")
                    else "Local Chromium. For higher reliability, ask your team to enable Browserbase."
                ),
            },
            {
                "id": "terminal",
                "ready": shutil.which("bash") is not None,
                "detail": "Built in — shell access inside the container.",
            },
        ],
    }
