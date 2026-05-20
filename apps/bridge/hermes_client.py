"""Thin wrapper over HERMÉS state.db, skills directory, and agent processes.

We never import AIAgent directly in v1 — every interaction is either:
  - a read-only SQLite query against ~/.hermes/state.db (sessions, costs, tokens), or
  - a spawn/kill of `hermes` CLI subprocesses backed by our own agent definitions.

This keeps the bridge resilient to upstream HERMÉS refactors. The cost is that
we cannot drive an agent turn-by-turn from the dashboard (which v1 does not need).
"""
from __future__ import annotations

import os
import shlex
import signal
import sqlite3
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

import psutil
import yaml
from ruamel.yaml import YAML

from .config import (
    HERMES_BIN,
    HERMES_HOME,
    HERMES_LOGS_DIR,
    HERMES_SKILLS_DIR,
    HERMES_STATE_DB,
    STAFFROOM_AGENTS_YAML,
    STAFFROOM_RUNTIME_DIR,
    VENDOR_SKILLS_DIR,
    ensure_dirs,
)
from .services.subprocess_env import sanitized_env

_yaml = YAML()
_yaml.preserve_quotes = True
_yaml.indent(mapping=2, sequence=4, offset=2)


# ---------------------------------------------------------------------------
# SQLite (read-only)
# ---------------------------------------------------------------------------
@contextmanager
def _state_conn() -> Iterator[Optional[sqlite3.Connection]]:
    if not HERMES_STATE_DB.exists():
        yield None
        return
    uri = f"file:{HERMES_STATE_DB}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def query_sessions(limit: int = 50, since: Optional[float] = None) -> list[dict[str, Any]]:
    with _state_conn() as conn:
        if conn is None:
            return []
        sql = (
            "SELECT id, source, model, started_at, ended_at, message_count, "
            "tool_call_count, COALESCE(actual_cost_usd, estimated_cost_usd) AS cost_usd, "
            "title, system_prompt "
            "FROM sessions"
        )
        params: list[Any] = []
        if since is not None:
            sql += " WHERE started_at >= ?"
            params.append(since)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def aggregate_cost(since: float) -> float:
    with _state_conn() as conn:
        if conn is None:
            return 0.0
        row = conn.execute(
            "SELECT COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS c "
            "FROM sessions WHERE started_at >= ?",
            (since,),
        ).fetchone()
        return float(row["c"] or 0.0) if row else 0.0


def count_sessions(since: float) -> int:
    with _state_conn() as conn:
        if conn is None:
            return 0
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM sessions WHERE started_at >= ?",
            (since,),
        ).fetchone()
        return int(row["c"]) if row else 0


def count_tool_calls(since: float) -> int:
    """We treat tool calls as the closest proxy to 'tasks completed today'."""
    with _state_conn() as conn:
        if conn is None:
            return 0
        row = conn.execute(
            "SELECT COALESCE(SUM(tool_call_count), 0) AS c FROM sessions WHERE started_at >= ?",
            (since,),
        ).fetchone()
        return int(row["c"] or 0) if row else 0


# ---------------------------------------------------------------------------
# Agent definitions (our own YAML, not HERMÉS's config.yaml)
# ---------------------------------------------------------------------------
def load_agents() -> list[dict[str, Any]]:
    ensure_dirs()
    if not STAFFROOM_AGENTS_YAML.exists():
        seed_default_agents()
    with STAFFROOM_AGENTS_YAML.open() as f:
        data = _yaml.load(f) or {}
    return list(data.get("agents", []))


def save_agents(agents: list[dict[str, Any]]) -> None:
    ensure_dirs()
    payload = {"agents": agents}
    with STAFFROOM_AGENTS_YAML.open("w") as f:
        _yaml.dump(payload, f)


def seed_default_agents() -> None:
    """Mirrors the example agents from the Staff Room OS mock."""
    defaults = [
        {
            "id": "analyst",
            "name": "Analyst",
            "slug": "analyst",
            "role": "System reviewer",
            "description": "Watches every system change and flags regressions.",
            "icon": "🔬",
            "organization": "staffroom",
            "model": "claude-sonnet-4-6",
            "system_prompt": "You are the Analyst. Audit changes and surface anomalies.",
            "toolset": "default",
            "enabled": True,
        },
        {
            "id": "boss",
            "name": "Boss",
            "slug": "boss",
            "role": "Chief of staff / Orchestrator",
            "description": "Delegates tasks across the agent roster.",
            "icon": "🎩",
            "organization": "staffroom",
            "model": "claude-opus-4-7",
            "system_prompt": "You are the Boss. Delegate, sequence, and unblock.",
            "toolset": "default",
            "enabled": True,
        },
        {
            "id": "captain",
            "name": "Captain",
            "slug": "captain",
            "role": "Community + conversion ops",
            "description": "Owns the community funnel and conversion experiments.",
            "icon": "🧭",
            "organization": "staffroom",
            "model": "claude-sonnet-4-6",
            "system_prompt": "You are the Captain. Steer community + conversion.",
            "toolset": "default",
            "enabled": True,
        },
    ]
    save_agents(defaults)


# ---------------------------------------------------------------------------
# Process registry (one hermes subprocess per agent)
# ---------------------------------------------------------------------------
def _pidfile(agent_id: str) -> Path:
    return STAFFROOM_RUNTIME_DIR / f"{agent_id}.pid"


def agent_pid(agent_id: str) -> Optional[int]:
    pf = _pidfile(agent_id)
    if not pf.exists():
        return None
    try:
        pid = int(pf.read_text().strip())
    except (ValueError, OSError):
        return None
    if not psutil.pid_exists(pid):
        pf.unlink(missing_ok=True)
        return None
    return pid


def _uptime_file(agent_id: str) -> Path:
    return STAFFROOM_RUNTIME_DIR / f"{agent_id}.uptime"


def agent_started_at(agent_id: str) -> Optional[float]:
    uf = _uptime_file(agent_id)
    if not uf.exists():
        return None
    try:
        return float(uf.read_text().strip())
    except (ValueError, OSError):
        return None


def start_agent(agent: dict[str, Any]) -> int:
    ensure_dirs()
    if (pid := agent_pid(agent["id"])) is not None:
        return pid
    log_path = STAFFROOM_RUNTIME_DIR / f"{agent['id']}.log"
    _uptime_file(agent["id"]).write_text(str(time.time()))
    # We shell out rather than importing AIAgent to insulate the bridge from
    # upstream class signature changes. The exact `hermes` invocation will need
    # tuning per HERMÉS release — this is the well-known fragile seam from the
    # plan's Risks section.
    # Toolset selection: prefer the new `toolsets` list, fall back to the
    # legacy single `toolset` field. Empty / [default] → don't pass -t at all
    # so HERMÉS uses its default toolset.
    toolsets_list = agent.get("toolsets")
    if not toolsets_list:
        legacy = agent.get("toolset", "default")
        toolsets_list = [legacy] if legacy and legacy != "default" else []
    toolsets_arg = ",".join(t for t in toolsets_list if t and t != "default")

    cmd = [
        HERMES_BIN,
        "chat",
        "--non-interactive",
        "--model",
        agent.get("model", "claude-sonnet-4-6"),
        "--system",
        agent.get("system_prompt") or agent.get("description", ""),
    ]
    if toolsets_arg:
        cmd.extend(["-t", toolsets_arg])
    with log_path.open("a") as logf:
        proc = subprocess.Popen(
            cmd,
            stdout=logf,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=sanitized_env({"STAFFROOM_AGENT_ID": agent["id"]}),
        )
    _pidfile(agent["id"]).write_text(str(proc.pid))
    return proc.pid


def stop_agent(agent_id: str) -> bool:
    pid = agent_pid(agent_id)
    if pid is None:
        _uptime_file(agent_id).unlink(missing_ok=True)
        return False
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    _pidfile(agent_id).unlink(missing_ok=True)
    _uptime_file(agent_id).unlink(missing_ok=True)
    return True


def count_agent_sessions_today(agent_id: str) -> int:
    """Real per-agent attribution via the staffroom-audit JSONL.

    Counts distinct sessions that started TODAY where session_start was
    tagged with agent_id == this one. Falls back to the uptime-window
    heuristic when the audit log is unavailable (e.g. audit plugin disabled).
    """
    import json as _json
    from datetime import datetime as _dt
    from .config import STAFFROOM_HOME as _SH

    audit_path = _SH / "audit" / f"{_dt.utcnow():%Y-%m-%d}.jsonl"
    if audit_path.exists():
        seen: set[str] = set()
        try:
            for line in audit_path.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    evt = _json.loads(line)
                except _json.JSONDecodeError:
                    continue
                if (
                    evt.get("event") == "session_start"
                    and evt.get("agent_id") == agent_id
                    and evt.get("session_id")
                ):
                    seen.add(evt["session_id"])
            return len(seen)
        except OSError:
            pass

    # Fallback: uptime-window heuristic
    started = agent_started_at(agent_id)
    if started is None:
        return 0
    midnight = time.time() - (time.time() % 86400)
    since = max(started, midnight)
    return count_sessions(since)


def agent_runtime_status(agent_id: str) -> tuple[str, Optional[int], Optional[float]]:
    pid = agent_pid(agent_id)
    if pid is None:
        return "down", None, None
    try:
        p = psutil.Process(pid)
        last_seen = p.create_time()
        # Stale = process alive but inactive for >5 min based on CPU times.
        # Cheap heuristic; replace with a heartbeat file when available.
        idle_for = time.time() - last_seen
        status = "stale" if idle_for > 300 and p.cpu_percent(interval=0.0) < 0.1 else "healthy"
        return status, pid, last_seen
    except psutil.NoSuchProcess:
        return "down", None, None


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------
def list_skills() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for root in (HERMES_SKILLS_DIR, VENDOR_SKILLS_DIR):
        if not root.exists():
            continue
        for skill_md in root.rglob("SKILL.md"):
            try:
                meta = _parse_skill_frontmatter(skill_md)
            except Exception:
                continue
            rel = skill_md.relative_to(root)
            parts = rel.parts
            category = parts[0] if len(parts) > 2 else "uncategorized"
            name = meta.get("name") or skill_md.parent.name
            out.append(
                {
                    "category": category,
                    "name": name,
                    "description": meta.get("description", ""),
                    "version": str(meta.get("version", "")),
                    "path": str(skill_md),
                }
            )
    # Deduplicate by (category, name) preferring user dir over vendor.
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for s in out:
        seen.setdefault((s["category"], s["name"]), s)
    return sorted(seen.values(), key=lambda s: (s["category"], s["name"]))


def _parse_skill_frontmatter(path: Path) -> dict[str, Any]:
    text = path.read_text(errors="replace")
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    return yaml.safe_load(text[3:end]) or {}


def read_skill(category: str, name: str) -> Optional[dict[str, Any]]:
    for skill in list_skills():
        if skill["category"] == category and skill["name"] == name:
            try:
                body = Path(skill["path"]).read_text(errors="replace")
            except OSError:
                body = ""
            return {**skill, "body": body}
    return None


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------
def list_log_files() -> list[Path]:
    paths: list[Path] = []
    if HERMES_LOGS_DIR.exists():
        paths.extend(sorted(HERMES_LOGS_DIR.glob("*.log")))
    if STAFFROOM_RUNTIME_DIR.exists():
        paths.extend(sorted(STAFFROOM_RUNTIME_DIR.glob("*.log")))
    return paths


def tail_log(path: Path, lines: int = 200) -> list[str]:
    if not path.exists():
        return []
    # Memory-cheap tail. For very large logs, swap in a reverse-read.
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        block = 4096
        data = b""
        while size > 0 and data.count(b"\n") <= lines:
            read_size = min(block, size)
            size -= read_size
            f.seek(size)
            data = f.read(read_size) + data
    return data.decode("utf-8", errors="replace").splitlines()[-lines:]
