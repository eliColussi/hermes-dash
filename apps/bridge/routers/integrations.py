"""Integrations: manage HERMÉS gateway daemon + credentials for Slack/Telegram.

We write credentials to ~/.hermes/.env (the location HERMÉS reads from) and
spawn `hermes gateway` as a long-running subprocess tracked by pidfile.
"""
from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path
from typing import Optional

import psutil
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import vault as _vault
from ..config import HERMES_BIN, HERMES_HOME, STAFFROOM_RUNTIME_DIR, ensure_dirs
from ..services.subprocess_env import sanitized_env

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

ENV_FILE = HERMES_HOME / ".env"
GATEWAY_PIDFILE = STAFFROOM_RUNTIME_DIR / "gateway.pid"
GATEWAY_LOG = STAFFROOM_RUNTIME_DIR / "gateway.log"


PROVIDERS = {
    "openrouter": {
        "label": "OpenRouter (AI models)",
        "icon": "🧠",
        "fields": [
            {"key": "OPENROUTER_API_KEY", "label": "API Key", "secret": True,
             "help": "From openrouter.ai/keys. Unlocks every model in the Add Agent picker."},
            {"key": "OPENROUTER_SITE_URL", "label": "Site URL (optional)", "secret": False,
             "help": "Shown on OpenRouter analytics; set to your client's domain."},
            {"key": "OPENROUTER_APP_NAME", "label": "App name (optional)", "secret": False,
             "help": "Shown on OpenRouter analytics."},
        ],
    },
    "anthropic": {
        "label": "Anthropic (direct)",
        "icon": "🟧",
        "fields": [
            {"key": "ANTHROPIC_API_KEY", "label": "API Key", "secret": True,
             "help": "Only needed if you want to bypass OpenRouter for Claude models."},
        ],
    },
    "openai": {
        "label": "OpenAI (direct)",
        "icon": "⚫",
        "fields": [
            {"key": "OPENAI_API_KEY", "label": "API Key", "secret": True,
             "help": "Only needed if you want to bypass OpenRouter for GPT models."},
        ],
    },
    "telegram": {
        "label": "Telegram",
        "icon": "✈️",
        "fields": [
            {"key": "TELEGRAM_BOT_TOKEN", "label": "Bot Token", "secret": True,
             "help": "From @BotFather. Looks like 1234567:ABC-..."},
        ],
    },
    "slack": {
        "label": "Slack",
        "icon": "💬",
        "fields": [
            {"key": "SLACK_BOT_TOKEN", "label": "Bot Token", "secret": True,
             "help": "Begins with xoxb-..."},
            {"key": "SLACK_APP_TOKEN", "label": "App Token", "secret": True,
             "help": "Begins with xapp-... (Socket Mode)"},
            {"key": "SLACK_ALLOWED_USERS", "label": "Allowed user IDs (comma-sep)", "secret": False,
             "help": "Optional. Restrict who can DM the bot."},
        ],
    },
    "discord": {
        "label": "Discord",
        "icon": "🎮",
        "fields": [
            {"key": "DISCORD_BOT_TOKEN", "label": "Bot Token", "secret": True, "help": ""},
        ],
    },
}


class IntegrationCreds(BaseModel):
    provider: str
    values: dict[str, str]


# ---------------------------------------------------------------------------
# .env parsing (no third-party dep needed for this format)
# ---------------------------------------------------------------------------
def _read_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        return {}
    out: dict[str, str] = {}
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _write_env(values: dict[str, str]) -> None:
    ensure_dirs()
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    written: set[str] = set()
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text().splitlines():
            stripped = raw.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                lines.append(raw)
                continue
            k = stripped.partition("=")[0].strip()
            if k in values:
                lines.append(f"{k}={values[k]}")
                written.add(k)
            else:
                lines.append(raw)
    for k, v in values.items():
        if k not in written:
            lines.append(f"{k}={v}")
    ENV_FILE.write_text("\n".join(lines) + "\n")
    try:
        os.chmod(ENV_FILE, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Gateway lifecycle
# ---------------------------------------------------------------------------
def _gateway_pid() -> Optional[int]:
    if not GATEWAY_PIDFILE.exists():
        return None
    try:
        pid = int(GATEWAY_PIDFILE.read_text().strip())
    except (ValueError, OSError):
        return None
    if not psutil.pid_exists(pid):
        GATEWAY_PIDFILE.unlink(missing_ok=True)
        return None
    return pid


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * (len(value) - 8) + value[-4:]


def _read_merged() -> dict[str, str]:
    """.env + vault, vault wins (encrypted source-of-truth when configured)."""
    merged = _read_env()
    merged.update(_vault.load_all())
    return merged


@router.get("")
def list_integrations() -> dict:
    env = _read_merged()
    integrations = []
    for slug, meta in PROVIDERS.items():
        configured = all(env.get(f["key"]) for f in meta["fields"] if f["secret"])
        values = {
            f["key"]: (_mask(env[f["key"]]) if f["secret"] and env.get(f["key"]) else env.get(f["key"], ""))
            for f in meta["fields"]
        }
        integrations.append(
            {
                "id": slug,
                "label": meta["label"],
                "icon": meta["icon"],
                "fields": meta["fields"],
                "values": values,
                "configured": configured,
            }
        )
    return {
        "integrations": integrations,
        "gateway": {
            "running": _gateway_pid() is not None,
            "pid": _gateway_pid(),
            "log": GATEWAY_LOG.name,
        },
        "vault_active": bool(os.environ.get("STAFFROOM_SECRETS_KEY")) or _vault.is_configured(),
    }


def _verify_channel_token(provider: str, values: dict[str, str]) -> Optional[str]:
    """Hit each platform's "who am I" endpoint with the supplied token.

    Returns None on success, or a human-readable error string on failure.
    Stops bad tokens from ever reaching disk — without this, a typo crashes
    the gateway in a tight restart loop until someone manually intervenes.

    Only called for messaging channels (telegram/slack/discord). Model API
    keys are not verified here — providers have inconsistent /me-style
    endpoints and OpenRouter doesn't expose one.
    """
    import httpx
    try:
        if provider == "telegram":
            tok = values.get("TELEGRAM_BOT_TOKEN", "")
            if not tok:
                return None  # nothing to verify
            r = httpx.get(f"https://api.telegram.org/bot{tok}/getMe", timeout=8.0)
            if r.status_code == 200 and r.json().get("ok"):
                return None
            return "Telegram rejected this token. Double-check you copied the whole thing from BotFather."
        if provider == "slack":
            tok = values.get("SLACK_BOT_TOKEN", "")
            if not tok:
                return None
            r = httpx.post(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {tok}"},
                timeout=8.0,
            )
            if r.status_code == 200 and r.json().get("ok"):
                return None
            return "Slack rejected this bot token. Re-copy it from your app's Install App page (starts with xoxb-)."
        if provider == "discord":
            tok = values.get("DISCORD_BOT_TOKEN", "")
            if not tok:
                return None
            r = httpx.get(
                "https://discord.com/api/v10/users/@me",
                headers={"Authorization": f"Bot {tok}"},
                timeout=8.0,
            )
            if r.status_code == 200:
                return None
            return "Discord rejected this bot token. Generate a fresh one from the Bot tab (the old one stops working after Reset Token)."
    except httpx.RequestError:
        # Network blip — don't block save on our connectivity issue.
        return None
    return None


@router.put("")
def save_integration(payload: IntegrationCreds) -> dict:
    if payload.provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {payload.provider}")
    valid_keys = {f["key"] for f in PROVIDERS[payload.provider]["fields"]}
    filtered = {k: v for k, v in payload.values.items() if k in valid_keys and v != ""}
    if not filtered:
        raise HTTPException(400, "No values provided")
    err = _verify_channel_token(payload.provider, filtered)
    if err:
        raise HTTPException(400, err)
    # When the operator has opted into encryption (key env var set, OR a
    # vault file already exists from a prior call), route writes through the
    # vault. Otherwise fall back to plain .env for backwards compatibility.
    if os.environ.get("STAFFROOM_SECRETS_KEY") or _vault.is_configured():
        for k, v in filtered.items():
            _vault.set_secret(k, v)
        return {"ok": True, "storage": "vault"}
    _write_env(filtered)
    return {"ok": True, "storage": "env"}


@router.post("/gateway/start")
def gateway_start() -> dict:
    if _gateway_pid() is not None:
        return {"running": True, "pid": _gateway_pid()}
    ensure_dirs()
    with GATEWAY_LOG.open("a") as logf:
        proc = subprocess.Popen(
            [HERMES_BIN, "gateway"],
            stdout=logf,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=sanitized_env(),
        )
    GATEWAY_PIDFILE.write_text(str(proc.pid))
    return {"running": True, "pid": proc.pid}


@router.post("/gateway/stop")
def gateway_stop() -> dict:
    pid = _gateway_pid()
    if pid is None:
        return {"running": False}
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    GATEWAY_PIDFILE.unlink(missing_ok=True)
    return {"running": False}
