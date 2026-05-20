"""Sanitized environment for HERMÉS subprocesses.

The bridge holds secrets that the agent / gateway subprocesses must NEVER
see — the admin password, the web session HMAC key, the vault encryption
key, the bridge bearer token. A prompt-injected agent with terminal access
can `printenv` and exfiltrate anything in its env, so we strip those vars
before spawning.

Provider API keys (OPENROUTER_API_KEY, COMPOSIO_API_KEY, etc.) are loaded
into os.environ by the vault at boot and ARE meant to be inherited — that
is the documented contract with HERMÉS. So this is a targeted blocklist of
our own STAFFROOM_* vars, not a general whitelist.
"""
from __future__ import annotations

import os

# STAFFROOM_* vars that ARE safe to expose to the agent / gateway.
# Anything else with the STAFFROOM_ prefix is stripped by default — this
# fail-safe means a future security-sensitive STAFFROOM_FOO var is blocked
# unless someone explicitly adds it here.
_SAFE_STAFFROOM_VARS = {
    "STAFFROOM_HOME",      # path; not a secret
    "STAFFROOM_AGENT_ID",  # set per-spawn for audit attribution
}

# Web-tier tuning vars the agent has no business reading.
_BLOCKED_OTHER = {
    "LOGIN_MAX_FAILURES",
    "LOGIN_WINDOW_MS",
    "WEBHOOK_MAX_BODY_BYTES",
    "WEBHOOK_TIMEOUT_MS",
    "WEBHOOK_RATE_LIMIT_PER_MIN",
}


def sanitized_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Return a copy of os.environ with bridge-only secrets removed.

    Pass the result as the `env=` kwarg to subprocess.Popen. Optional `extra`
    is merged in last and wins on conflict (e.g. STAFFROOM_AGENT_ID per spawn).
    """
    out: dict[str, str] = {}
    for k, v in os.environ.items():
        if k.startswith("STAFFROOM_") and k not in _SAFE_STAFFROOM_VARS:
            continue
        if k in _BLOCKED_OTHER:
            continue
        out[k] = v
    if extra:
        out.update(extra)
    return out
