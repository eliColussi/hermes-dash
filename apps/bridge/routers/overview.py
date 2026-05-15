"""Overview metrics aggregated from state.db + agents.yaml + skills dir."""
from __future__ import annotations

import time

from fastapi import APIRouter

from .. import hermes_client as hc
from ..models import Overview

router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("", response_model=Overview)
def overview() -> Overview:
    agents = hc.load_agents()
    statuses = [hc.agent_runtime_status(a["id"])[0] for a in agents]
    midnight = time.time() - (time.time() % 86400)
    thirty_days = time.time() - 30 * 86400
    return Overview(
        total_agents=len(agents),
        healthy=sum(1 for s in statuses if s == "healthy"),
        stale=sum(1 for s in statuses if s == "stale"),
        down=sum(1 for s in statuses if s == "down"),
        tasks_today=hc.count_tool_calls(midnight),
        sessions_today=hc.count_sessions(midnight),
        cost_today_usd=round(hc.aggregate_cost(midnight), 4),
        cost_30d_usd=round(hc.aggregate_cost(thirty_days), 4),
        skills_installed=len(hc.list_skills()),
    )
