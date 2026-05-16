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


def _llm_provider() -> tuple[str | None, str | None]:
    """Returns (provider_name, key_env) for the configured LLM, or (None, None)."""
    for env, name in (
        ("OPENROUTER_API_KEY", "OpenRouter"),
        ("ANTHROPIC_API_KEY", "Anthropic"),
        ("OPENAI_API_KEY", "OpenAI"),
    ):
        if os.environ.get(env):
            return name, env
    return None, None


@router.get("")
def capabilities() -> dict:
    web_backend = _web_search_backend()
    llm_name, llm_key = _llm_provider()
    return {
        "llm_ready": llm_name is not None,
        "llm_provider": llm_name,
        "items": [
            {
                "id": "llm",
                "ready": llm_name is not None,
                "detail": (
                    f"Using {llm_name}." if llm_name
                    else "No LLM provider configured. Ask your team to set OPENROUTER_API_KEY (recommended), ANTHROPIC_API_KEY, or OPENAI_API_KEY."
                ),
            },
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
