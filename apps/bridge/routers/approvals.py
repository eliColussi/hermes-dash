"""Approvals router (MVP v1).

Derives pending approvals from today's staffroom-audit JSONL: an approval is
PENDING if there's an `approval_requested` event with no matching
`approval_responded` for the same `pattern_key` + `session_key`.

Response is NOT yet wired through the bridge — that requires registering a
gateway_notify callback into HERMÉS's tools/approval.py, which is a
cross-process call that needs a small fork to expose cleanly. For v1.0.4
MVP we ship visibility; the operator approves via the surface that raised
the request (CLI prompt, Telegram/Slack message buttons, etc.).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends

from .. import auth
from ..config import STAFFROOM_HOME

router = APIRouter(
    prefix="/api/approvals",
    tags=["approvals"],
    dependencies=[Depends(auth.require_token)],
)

AUDIT_DIR = STAFFROOM_HOME / "audit"


def _today_entries() -> List[dict]:
    path = AUDIT_DIR / f"{datetime.utcnow():%Y-%m-%d}.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def _key(entry: dict) -> Tuple[str, str]:
    return (entry.get("session_key", ""), entry.get("pattern_key", ""))


@router.get("")
def list_approvals() -> dict:
    entries = _today_entries()
    pending: Dict[Tuple[str, str], dict] = {}
    for e in entries:
        if e.get("event") == "approval_requested":
            pending[_key(e)] = e
        elif e.get("event") == "approval_responded":
            pending.pop(_key(e), None)
    items = sorted(pending.values(), key=lambda x: x.get("ts", ""), reverse=True)
    return {"items": items, "count": len(items)}


@router.get("/history")
def list_history(limit: int = 100) -> dict:
    entries = _today_entries()
    pairs = [
        e for e in entries
        if e.get("event") in ("approval_requested", "approval_responded")
    ]
    return {"items": pairs[-limit:], "count": len(pairs[-limit:])}
