"""Audit feed: read the JSONL files written by the staffroom-audit plugin."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from .. import auth
from ..config import STAFFROOM_HOME

router = APIRouter(
    prefix="/api/audit",
    tags=["audit"],
    dependencies=[Depends(auth.require_token)],
)

AUDIT_DIR = STAFFROOM_HOME / "audit"


def _read_jsonl(date: str, limit: int) -> list[dict]:
    """Read the most recent ``limit`` lines from a given day's audit file."""
    path = AUDIT_DIR / f"{date}.jsonl"
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in raw[-limit:]:
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


@router.get("")
def list_audit(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today UTC)"),
    limit: int = Query(200, ge=1, le=5000),
    event: Optional[str] = Query(None, description="Filter to one event type."),
) -> dict:
    day = date or datetime.utcnow().strftime("%Y-%m-%d")
    items = _read_jsonl(day, limit * 4 if event else limit)
    if event:
        items = [e for e in items if e.get("event") == event][-limit:]
    return {"date": day, "items": items, "count": len(items)}


@router.get("/days")
def list_days() -> dict:
    if not AUDIT_DIR.exists():
        return {"days": []}
    return {
        "days": sorted(
            [p.stem for p in AUDIT_DIR.glob("*.jsonl")],
            reverse=True,
        )
    }
