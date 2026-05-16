"""Detect whether HERMES_HOME / STAFFROOM_HOME live on a real persistent
volume or on the container's ephemeral writable layer.

On Linux, a bind-mounted volume lives on a different block device than `/`.
That's a reliable signal: same device → ephemeral, different device →
persistent (Railway Volume, Docker named volume, host bind mount).

If we ever can't tell (non-Linux, weird filesystem), we report 'unknown'
and surface a yellow caution rather than a red alarm.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from .config import HERMES_HOME, STAFFROOM_HOME


def _is_separate_device(path: Path) -> bool | None:
    """True if `path` lives on a different filesystem device than `/`.

    Returns None when we genuinely can't tell (path doesn't exist, OS doesn't
    expose st_dev meaningfully, etc.)."""
    try:
        path_dev = path.stat().st_dev
        root_dev = Path("/").stat().st_dev
    except OSError:
        return None
    return path_dev != root_dev


def _is_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        marker = path / ".persistence_probe"
        marker.write_text(str(time.time()), encoding="utf-8")
        marker.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def status() -> dict:
    """Compose a single persistence report for the dashboard and health probe."""
    # `/data` is the canonical Railway / Docker mount point our Dockerfile
    # points HERMES_HOME and STAFFROOM_HOME into. We probe it directly because
    # it's the parent that needs to be the mount, not the subdirs.
    data_root = Path("/data") if Path("/data").exists() else HERMES_HOME.parent

    sep = _is_separate_device(data_root)
    persistent: bool | None
    if sep is True:
        persistent = True
    elif sep is False:
        # /data exists on the same filesystem as / → not a real volume.
        # On a local laptop install (~/.hermes), that's expected, so we
        # downgrade to "unknown" rather than alarm. Heuristic: if the path
        # is /data, it's almost certainly Railway/Docker and ephemeral.
        persistent = False if str(data_root) == "/data" else None
    else:
        persistent = None

    return {
        "persistent": persistent,  # True / False / None
        "data_root": str(data_root),
        "hermes_home": str(HERMES_HOME),
        "staffroom_home": str(STAFFROOM_HOME),
        "writable": _is_writable(STAFFROOM_HOME),
        "remediation": (
            "In Railway: open the service → Volumes → New Volume → Mount path "
            "`/data` → Save. Trigger a redeploy. Existing data is on the "
            "ephemeral layer and will be lost; back up first if you've been "
            "running without persistence."
        ) if persistent is False else None,
    }


def warn_at_startup() -> None:
    """Print a loud, hard-to-miss warning if data is on the ephemeral layer."""
    s = status()
    if s["persistent"] is False:
        bar = "=" * 72
        print(bar)
        print("⚠️  PERSISTENCE NOT CONFIGURED — DATA WILL BE LOST ON NEXT REDEPLOY")
        print(bar)
        print(f"   {s['data_root']} is on the container's ephemeral filesystem.")
        print("   Mount a Railway Volume at /data to persist agents, chats,")
        print("   secrets, schedules, triggers, and session history.")
        print(bar)
    elif s["persistent"] is True:
        print(f"💾 persistence: OK — {s['data_root']} is a real volume mount")
    else:
        print(f"💾 persistence: unknown for {s['data_root']} (probably local dev)")
