"""Lightweight agent ↔ automation linkage.

When an operator pauses an agent, we want all its scheduled jobs and
trigger webhooks to stop firing — otherwise "Pause" is a lie and the bill
keeps growing. HERMÉS' cron + webhook subsystems don't natively track
'which Staff Room agent owns me', so we maintain a tiny side index here:

    $STAFFROOM_HOME/agent_links.json
    {"<agent_id>": {"schedules": [<id>, ...], "webhooks": [<name>, ...]}}

Updated on create/delete of schedules + triggers, walked on agent
start/stop to cascade enable/disable.
"""
from __future__ import annotations

import json
import os
from typing import Iterable

from .config import STAFFROOM_HOME

_LINKS_FILE = STAFFROOM_HOME / "agent_links.json"


def _load() -> dict:
    if not _LINKS_FILE.exists():
        return {}
    try:
        data = json.loads(_LINKS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict) -> None:
    _LINKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _LINKS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, _LINKS_FILE)


def _entry(data: dict, agent_id: str) -> dict:
    return data.setdefault(agent_id, {"schedules": [], "webhooks": []})


def link_schedule(agent_id: str, schedule_id: str) -> None:
    if not agent_id or not schedule_id:
        return
    data = _load()
    bucket = _entry(data, agent_id)["schedules"]
    if schedule_id not in bucket:
        bucket.append(schedule_id)
        _save(data)


def link_webhook(agent_id: str, webhook_name: str) -> None:
    if not agent_id or not webhook_name:
        return
    data = _load()
    bucket = _entry(data, agent_id)["webhooks"]
    if webhook_name not in bucket:
        bucket.append(webhook_name)
        _save(data)


def unlink_schedule(schedule_id: str) -> None:
    data = _load()
    changed = False
    for entry in data.values():
        if schedule_id in entry.get("schedules", []):
            entry["schedules"].remove(schedule_id)
            changed = True
    if changed:
        _save(data)


def unlink_webhook(webhook_name: str) -> None:
    data = _load()
    changed = False
    for entry in data.values():
        if webhook_name in entry.get("webhooks", []):
            entry["webhooks"].remove(webhook_name)
            changed = True
    if changed:
        _save(data)


def for_agent(agent_id: str) -> dict:
    """Returns {'schedules': [...], 'webhooks': [...]} for the agent."""
    return _load().get(agent_id) or {"schedules": [], "webhooks": []}


def summary() -> dict:
    """Full map for diagnostic surfaces."""
    return _load()


def cleanup_unknown(known_schedule_ids: Iterable[str], known_webhook_names: Iterable[str]) -> None:
    """Drop links that point at schedules/webhooks no longer present.
    Keeps the index honest after deletions that bypassed our routers."""
    keep_s = set(known_schedule_ids)
    keep_w = set(known_webhook_names)
    data = _load()
    changed = False
    for entry in data.values():
        before_s = len(entry.get("schedules", []))
        before_w = len(entry.get("webhooks", []))
        entry["schedules"] = [s for s in entry.get("schedules", []) if s in keep_s]
        entry["webhooks"] = [w for w in entry.get("webhooks", []) if w in keep_w]
        if len(entry["schedules"]) != before_s or len(entry["webhooks"]) != before_w:
            changed = True
    if changed:
        _save(data)
