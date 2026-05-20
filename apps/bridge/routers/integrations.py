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

from .. import hermes_client as hc
from .. import vault as _vault
from ..config import HERMES_BIN, HERMES_CONFIG_YAML, HERMES_HOME, STAFFROOM_RUNTIME_DIR, ensure_dirs
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
    "mattermost": {
        "label": "Mattermost",
        "icon": "🛰️",
        "fields": [
            {"key": "MATTERMOST_URL", "label": "Server URL", "secret": False,
             "help": "e.g. https://mm.example.com (no trailing slash)"},
            {"key": "MATTERMOST_TOKEN", "label": "Bot Token", "secret": True,
             "help": "Personal-access token or bot account token."},
        ],
    },
    "email": {
        "label": "Email (IMAP/SMTP)",
        "icon": "✉️",
        "fields": [
            {"key": "EMAIL_ADDRESS", "label": "Email address", "secret": False,
             "help": "The mailbox the agent reads & sends from."},
            {"key": "EMAIL_PASSWORD", "label": "App password", "secret": True,
             "help": "Provider-specific app password (not your login password)."},
            {"key": "EMAIL_IMAP_HOST", "label": "IMAP host", "secret": False,
             "help": "e.g. imap.gmail.com"},
            {"key": "EMAIL_IMAP_PORT", "label": "IMAP port", "secret": False,
             "help": "Usually 993."},
            {"key": "EMAIL_SMTP_HOST", "label": "SMTP host", "secret": False,
             "help": "e.g. smtp.gmail.com"},
            {"key": "EMAIL_SMTP_PORT", "label": "SMTP port", "secret": False,
             "help": "Usually 587."},
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
        if provider == "mattermost":
            url = values.get("MATTERMOST_URL", "").rstrip("/")
            tok = values.get("MATTERMOST_TOKEN", "")
            if not url or not tok:
                return None
            r = httpx.get(
                f"{url}/api/v4/users/me",
                headers={"Authorization": f"Bearer {tok}"},
                timeout=8.0,
            )
            if r.status_code == 200:
                return None
            if r.status_code == 401:
                return "Mattermost rejected this token. Generate a new Personal Access Token in your profile settings."
            return f"Couldn't reach Mattermost at {url} (HTTP {r.status_code}). Double-check the server URL."
        if provider == "email":
            # Only verify if all the IMAP fields are supplied — partial updates
            # (e.g. just rotating the password) are common and we shouldn't
            # demand the operator re-paste everything.
            host = values.get("EMAIL_IMAP_HOST", "")
            port_str = values.get("EMAIL_IMAP_PORT", "")
            addr = values.get("EMAIL_ADDRESS", "")
            pw = values.get("EMAIL_PASSWORD", "")
            if not (host and port_str and addr and pw):
                return None
            try:
                port = int(port_str)
            except ValueError:
                return "IMAP port must be a number (usually 993)."
            import imaplib
            try:
                m = imaplib.IMAP4_SSL(host, port, timeout=10)
                try:
                    m.login(addr, pw)
                finally:
                    try:
                        m.logout()
                    except Exception:
                        pass
            except imaplib.IMAP4.error:
                return "IMAP login failed. For Gmail / Outlook, you need an APP PASSWORD — not your normal account password. See the help text below the field."
            except OSError as exc:
                return f"Couldn't reach IMAP server {host}:{port} ({exc.__class__.__name__}). Check host and port."
            return None
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


# ---------------------------------------------------------------------------
# Channel agent — which Staff Room agent represents the operator on chat
# platforms. HERMÉS reads agent.system_prompt from ~/.hermes/config.yaml and
# applies it to every messaging adapter. So setting this single field makes
# the chosen agent the voice on Telegram + Slack + Discord + Mattermost +
# Email simultaneously.
#
# Per-channel overrides (different agents per platform) would need a HERMÉS
# fork — that's the v1.2 work in the PRD. This endpoint is the v1 answer.
# ---------------------------------------------------------------------------

class ChannelAgentPayload(BaseModel):
    agent_id: str


@router.get("/channel-agent")
def get_channel_agent() -> dict:
    """Return which agent is currently set as the channel voice, by matching
    the system_prompt persisted in config.yaml against our agents.yaml."""
    if not HERMES_CONFIG_YAML.exists():
        return {"agent_id": None, "agent_name": None}
    import yaml as _y
    try:
        with HERMES_CONFIG_YAML.open(encoding="utf-8") as f:
            cfg = _y.safe_load(f) or {}
    except Exception:
        return {"agent_id": None, "agent_name": None}
    current_prompt = (cfg.get("agent", {}) or {}).get("system_prompt", "") or ""
    if not current_prompt.strip():
        return {"agent_id": None, "agent_name": None}
    for a in hc.load_agents():
        if (a.get("system_prompt") or "").strip() == current_prompt.strip():
            return {"agent_id": a.get("id"), "agent_name": a.get("name")}
    # Operator may have hand-edited config.yaml — report as "custom".
    return {"agent_id": None, "agent_name": "custom (set outside the dashboard)"}


@router.put("/channel-agent")
def set_channel_agent(payload: ChannelAgentPayload) -> dict:
    """Set the Staff Room agent that responds on every chat platform.

    Writes the chosen agent's system_prompt into HERMÉS's config.yaml at
    agent.system_prompt — the location its gateway reads on session start.
    The gateway needs to be restarted after this for the change to take
    effect (use POST /api/integrations/gateway/stop + /start).
    """
    agents = hc.load_agents()
    chosen = next((a for a in agents if a.get("id") == payload.agent_id), None)
    if not chosen:
        raise HTTPException(404, f"Agent '{payload.agent_id}' not found")

    import yaml as _y
    ensure_dirs()
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    cfg: dict = {}
    if HERMES_CONFIG_YAML.exists():
        try:
            with HERMES_CONFIG_YAML.open(encoding="utf-8") as f:
                cfg = _y.safe_load(f) or {}
        except Exception:
            cfg = {}
    agent_cfg = cfg.setdefault("agent", {})
    agent_cfg["system_prompt"] = (chosen.get("system_prompt") or "").strip()
    # Also stash the identity so the gateway logs are readable + a future
    # operator opening config.yaml can tell which Staff Room agent is wired.
    agent_cfg["name"] = chosen.get("name") or chosen.get("id")
    tmp = HERMES_CONFIG_YAML.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        _y.safe_dump(cfg, f, sort_keys=False)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, HERMES_CONFIG_YAML)
    return {
        "agent_id": chosen.get("id"),
        "agent_name": chosen.get("name"),
        "note": "Restart the messaging service for the change to take effect.",
    }


# ---------------------------------------------------------------------------
# Bot pairing approvals — HERMÉS default-denies messages from unknown users
# on every platform; the user gets a pairing code in their first DM, the
# operator approves it from the dashboard. We talk to the same PairingManager
# the gateway uses (file-backed under HERMES_HOME/platforms/pairing), so
# approvals take effect immediately with no restart.
# ---------------------------------------------------------------------------

def _pairing_manager():
    """Import lazily — pulls in the vendored HERMÉS package, which is heavy.
    The class is named PairingStore upstream (despite the docstring elsewhere
    in HERMÉS calling it the 'pairing manager')."""
    from gateway.pairing import PairingStore
    return PairingStore()


@router.get("/pairing/pending")
def list_pending_pairings() -> dict:
    """Return everyone currently waiting for the operator to approve them on
    a bot. Empty list when there are none — the UI hides the banner.

    Pairing codes expire after 1 hour (HERMÉS default), so if a user
    messaged the bot more than an hour ago the list will be empty even
    though they're still waiting; tell them to message again."""
    try:
        items = _pairing_manager().list_pending() or []
        return {"items": items, "count": len(items)}
    except ImportError as exc:
        # Vendored HERMÉS isn't installed in this environment — bridge
        # is running standalone (e.g. local dev without the gateway).
        # Return a clear error rather than pretending all is well.
        raise HTTPException(
            503,
            f"HERMÉS gateway package not available ({exc}). The bridge can't read pending pairings without it.",
        )


class PairingApprovePayload(BaseModel):
    platform: str
    code: str


@router.post("/pairing/approve")
def approve_pairing(payload: PairingApprovePayload) -> dict:
    """Approve a single pending pairing code. The user can then DM the bot."""
    try:
        pm = _pairing_manager()
    except ImportError as exc:
        raise HTTPException(
            503,
            f"HERMÉS gateway package not available ({exc}). Ask your team to redeploy.",
        )
    result = pm.approve_code(payload.platform, payload.code.strip().upper())
    if not result:
        raise HTTPException(
            400,
            "That code is invalid or expired. Ask the user to message the bot again to get a fresh one.",
        )
    return {"approved": True, **result}
