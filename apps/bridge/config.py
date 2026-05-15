"""Paths and constants for the Staff Room OS bridge."""
from __future__ import annotations

import os
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()
HERMES_STATE_DB = HERMES_HOME / "state.db"
HERMES_KANBAN_DB = HERMES_HOME / "kanban.db"
HERMES_SKILLS_DIR = HERMES_HOME / "skills"
HERMES_LOGS_DIR = HERMES_HOME / "logs"
HERMES_CONFIG_YAML = HERMES_HOME / "config.yaml"

STAFFROOM_HOME = Path(
    os.environ.get("STAFFROOM_HOME", Path.home() / ".staff-room-os")
).expanduser()
STAFFROOM_AGENTS_YAML = STAFFROOM_HOME / "agents.yaml"
STAFFROOM_RUNTIME_DIR = STAFFROOM_HOME / "runtime"

# Fall back to bundled skills shipped inside vendor/ when the user's HERMES_HOME
# has not been populated yet (fresh install).
VENDOR_HERMES = Path(__file__).resolve().parent.parent.parent / "vendor" / "hermes-agent"
VENDOR_SKILLS_DIR = VENDOR_HERMES / "skills"

# Path to the hermes CLI. Prefer the one in our bridge venv, fall back to PATH.
_BRIDGE_VENV_BIN = Path(__file__).resolve().parent / ".venv" / "bin"
HERMES_BIN = (
    str(_BRIDGE_VENV_BIN / "hermes")
    if (_BRIDGE_VENV_BIN / "hermes").exists()
    else "hermes"
)


def ensure_dirs() -> None:
    STAFFROOM_HOME.mkdir(parents=True, exist_ok=True)
    STAFFROOM_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
