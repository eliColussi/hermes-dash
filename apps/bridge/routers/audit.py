"""Audit feed: read the JSONL files written by the staffroom-audit plugin."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import auth
from ..config import STAFFROOM_HOME

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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
    # Reject anything that isn't a strict YYYY-MM-DD — without this an
    # attacker could pass "../../../etc/passwd" (or any other relative path
    # ending in .jsonl after our suffix) and read arbitrary files on the
    # volume that happen to be JSONL.
    if not _DATE_RE.match(day):
        raise HTTPException(400, "date must be in YYYY-MM-DD format")
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
