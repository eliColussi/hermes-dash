"""Activity feed = recent HERMÉS sessions."""
from __future__ import annotations

from fastapi import APIRouter, Query

from .. import hermes_client as hc
from ..models import ActivityItem

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("", response_model=list[ActivityItem])
def activity(limit: int = Query(50, ge=1, le=500)) -> list[ActivityItem]:
    sessions = hc.query_sessions(limit=limit)
    return [
        ActivityItem(
            session_id=s["id"],
            title=s.get("title"),
            source=s.get("source", ""),
            model=s.get("model"),
            started_at=s["started_at"],
            ended_at=s.get("ended_at"),
            message_count=int(s.get("message_count") or 0),
            tool_call_count=int(s.get("tool_call_count") or 0),
            cost_usd=s.get("cost_usd"),
        )
        for s in sessions
    ]
