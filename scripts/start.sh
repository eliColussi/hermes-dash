#!/usr/bin/env bash
# Single-container start: bridge in background, web in foreground.
set -euo pipefail

mkdir -p "${HERMES_HOME:-/data/hermes}" "${STAFFROOM_HOME:-/data/staffroom}"
mkdir -p "${HERMES_HOME:-/data/hermes}/plugins"

# Rotate large log files at boot so /data doesn't fill up over weeks of
# uptime. Anything bigger than 50 MB gets renamed with a timestamp; the
# oldest two rotated copies per log are kept. Cheap, no daemon needed —
# the container restarts often enough that boot-time rotation is fine.
LOG_DIRS="${HERMES_HOME:-/data/hermes}/logs ${STAFFROOM_HOME:-/data/staffroom}/runtime"
for dir in $LOG_DIRS; do
  [ -d "$dir" ] || continue
  find "$dir" -maxdepth 1 -type f -name '*.log' -size +50M 2>/dev/null | while read -r f; do
    mv "$f" "${f}.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    echo "[start] rotated oversized log: $f"
  done
  # Keep at most 2 rotated copies per base name.
  for base in $(find "$dir" -maxdepth 1 -type f -name '*.log.*' 2>/dev/null \
                | sed -E 's/\.[0-9]{8}-[0-9]{6}$//' | sort -u); do
    ls -1t "${base}".* 2>/dev/null | tail -n +3 | xargs -r rm -f
  done
done

# Persistence check — same logic the bridge uses, surfaced loudly in Railway
# logs so an operator never silently runs ephemeral.
if [ -d /data ]; then
  DATA_DEV="$(stat -c '%d' /data 2>/dev/null || echo '')"
  ROOT_DEV="$(stat -c '%d' / 2>/dev/null || echo '')"
  if [ -n "$DATA_DEV" ] && [ "$DATA_DEV" = "$ROOT_DEV" ]; then
    echo ""
    echo "========================================================================"
    echo "⚠️  PERSISTENCE NOT CONFIGURED — DATA WILL BE LOST ON NEXT REDEPLOY"
    echo "========================================================================"
    echo "   /data is on the container's ephemeral filesystem."
    echo "   Mount a Railway Volume at /data (Service → Volumes → New Volume)."
    echo "========================================================================"
    echo ""
  else
    echo "[start] persistence: OK (/data is a real volume mount)"
  fi
fi

# Symlink our shipped plugins into HERMÉS's user plugin dir so they auto-load
# without bloating the vendored hermes-agent tree. Idempotent.
PLUGIN_NAMES=""
for plugin_src in /app/plugins/*/; do
  plugin_name="$(basename "$plugin_src")"
  plugin_dst="${HERMES_HOME:-/data/hermes}/plugins/$plugin_name"
  if [ ! -e "$plugin_dst" ]; then
    ln -s "$plugin_src" "$plugin_dst"
    echo "[start] linked plugin: $plugin_name"
  fi
  PLUGIN_NAMES="$PLUGIN_NAMES $plugin_name"
done

# Client pack (lead-magnet builds): copy client SOP/playbook skills into
# HERMÉS's skills dir so agents can read them and the Skills page lists them.
# Always overwrites — the repo is the source of truth for these files.
if [ -d /app/client/skills ]; then
  mkdir -p "${HERMES_HOME:-/data/hermes}/skills"
  cp -R /app/client/skills/. "${HERMES_HOME:-/data/hermes}/skills/"
  echo "[start] client skills seeded from /app/client/skills"
fi

# Idempotent first-boot config: auto-write the minimal hermes config.yaml
# from whichever provider API key is set in Railway env vars, and enable our
# shipped plugins. Lets a fresh client deploy start working the moment the
# agency drops OPENROUTER_API_KEY / ANTHROPIC_API_KEY into env — no manual
# `hermes setup` step.
PLUGIN_NAMES="$PLUGIN_NAMES" HERMES_HOME="${HERMES_HOME:-/data/hermes}" python3 - <<'PYEOF'
import os, yaml
path = os.path.join(os.environ["HERMES_HOME"], "config.yaml")
cfg = {}
if os.path.exists(path):
    with open(path) as f:
        cfg = yaml.safe_load(f) or {}
changed = False

# ── Agent defaults: chat is conversational, kill the default reasoning_effort
#    that adds 5-20s per turn on chain-of-thought models. Operators can crank
#    it back up by setting HERMES_REASONING_EFFORT=medium / high in Railway.
agent_cfg = cfg.setdefault("agent", {})
desired_effort = os.environ.get("HERMES_REASONING_EFFORT", "minimal")
if agent_cfg.get("reasoning_effort") != desired_effort:
    agent_cfg["reasoning_effort"] = desired_effort
    print(f"[start] agent.reasoning_effort = {desired_effort}")
    changed = True

# ── Subagent model pairing: when the main agent delegates a sub-task,
#    use a cheaper model for that. Cuts cost on delegation-heavy work
#    without dropping the quality of the main agent's reasoning. Override
#    with HERMES_SUBAGENT_MODEL in Railway env to pin a different worker.
subagents_cfg = cfg.setdefault("subagents", {})
desired_subagent = os.environ.get("HERMES_SUBAGENT_MODEL", "anthropic/claude-haiku-4.5")
if subagents_cfg.get("model") != desired_subagent:
    subagents_cfg["model"] = desired_subagent
    print(f"[start] subagents.model = {desired_subagent}")
    changed = True

# ── Model provider (only set if not already configured) ───────────────────
model = cfg.setdefault("model", {})
if not model.get("provider") or model.get("provider") == "auto" and not model.get("default"):
    if os.environ.get("OPENROUTER_API_KEY"):
        model["provider"] = "openrouter"
        model["base_url"] = "https://openrouter.ai/api/v1"
        # Sonnet 4.6 by default: results > pennies for the buyer persona.
        # Clients pay $15-25k for agents that actually work; choosing a
        # lesser model to save $0.03/turn is the wrong tradeoff. Operators
        # can drop to Haiku or pick a sleeper model per-agent for cost-
        # sensitive workloads.
        model.setdefault("default", "anthropic/claude-sonnet-4.6")
        print("[start] model provider: openrouter (default: claude-sonnet-4.6)")
        changed = True
    elif os.environ.get("ANTHROPIC_API_KEY"):
        model["provider"] = "anthropic"
        model.setdefault("default", "claude-sonnet-4-6")
        print("[start] model provider: anthropic (default: claude-sonnet-4-6)")
        changed = True
    elif os.environ.get("OPENAI_API_KEY"):
        model["provider"] = "openai"
        model.setdefault("default", "gpt-5")
        print("[start] model provider: openai (auto-configured from OPENAI_API_KEY)")
        changed = True
    else:
        print("[start] ⚠️  no LLM provider key found in env — agents will not be able to chat")
        print("[start]    set one of OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY in Railway")

# ── Plugins (always ensure shipped plugins are enabled) ───────────────────
plugins = cfg.setdefault("plugins", {})
enabled = plugins.setdefault("enabled", [])
shipped = [n for n in os.environ.get("PLUGIN_NAMES", "").split() if n]
for name in shipped:
    if name not in enabled:
        enabled.append(name)
        changed = True

if changed:
    with open(path, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    print(f"[start] wrote config.yaml (plugins: {shipped})")
PYEOF

# Mint a token on first boot if one isn't supplied, persist for both services.
if [ -z "${STAFFROOM_AUTH_TOKEN:-}" ] && [ -z "${STAFFROOM_AUTH_DISABLED:-}" ]; then
  TOKEN_FILE="${STAFFROOM_HOME:-/data/staffroom}/token"
  if [ ! -s "$TOKEN_FILE" ]; then
    python3 -c "import secrets; print(secrets.token_urlsafe(32))" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
  export STAFFROOM_AUTH_TOKEN="$(cat "$TOKEN_FILE")"
fi

# Mint API_SERVER_KEY *before* launching the bridge so the bridge process
# inherits it in its env (used to authenticate session-continuation calls
# to the gateway's api_server). Also exported here so the gateway, launched
# later in this script, sees the same value.
export API_SERVER_ENABLED="${API_SERVER_ENABLED:-true}"
export API_SERVER_HOST="${API_SERVER_HOST:-127.0.0.1}"
export API_SERVER_PORT="${API_SERVER_PORT:-8642}"
API_SERVER_KEY_FILE="${STAFFROOM_HOME:-/data/staffroom}/api-server-key"
if [ -z "${API_SERVER_KEY:-}" ]; then
  if [ ! -s "$API_SERVER_KEY_FILE" ]; then
    python3 -c "import secrets; print(secrets.token_urlsafe(32))" > "$API_SERVER_KEY_FILE"
    chmod 600 "$API_SERVER_KEY_FILE"
  fi
  export API_SERVER_KEY="$(cat "$API_SERVER_KEY_FILE")"
fi

# Session cookie signing secret for the dashboard login. Persists on the
# data volume so existing sessions survive redeploys. Never shown to users.
SESSION_SECRET_FILE="${STAFFROOM_HOME:-/data/staffroom}/session-secret"
if [ -z "${STAFFROOM_SESSION_SECRET:-}" ]; then
  if [ ! -s "$SESSION_SECRET_FILE" ]; then
    python3 -c "import secrets; print(secrets.token_urlsafe(48))" > "$SESSION_SECRET_FILE"
    chmod 600 "$SESSION_SECRET_FILE"
  fi
  export STAFFROOM_SESSION_SECRET="$(cat "$SESSION_SECRET_FILE")"
fi

# Admin credentials. Without these, the dashboard refuses logins (the
# operator must ask their agency to set them in Railway). Default username
# is "admin" if not specified.
export STAFFROOM_ADMIN_USER="${STAFFROOM_ADMIN_USER:-admin}"
if [ -z "${STAFFROOM_ADMIN_PASSWORD:-}" ]; then
  echo ""
  echo "========================================================================"
  echo "⚠️  STAFFROOM_ADMIN_PASSWORD not set — dashboard logins will fail."
  echo "========================================================================"
  echo "   Set STAFFROOM_ADMIN_PASSWORD in Railway env vars."
  echo "   Default username is 'admin' (override with STAFFROOM_ADMIN_USER)."
  echo "========================================================================"
  echo ""
fi

# Auto-derive PUBLIC_BASE_URL from Railway's injected domain so the webhook
# router can construct working URLs without needing the operator to hard-code
# anything. The router now refuses to trust X-Forwarded-* headers blindly, so
# we set this explicitly for the trusted hosting path.
if [ -z "${PUBLIC_BASE_URL:-}" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  export PUBLIC_BASE_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  echo "[start] PUBLIC_BASE_URL = $PUBLIC_BASE_URL (from RAILWAY_PUBLIC_DOMAIN)"
fi

# Bridge runs on a fixed internal port; not exposed externally.
echo "[start] launching bridge on 127.0.0.1:8787"
cd /app
python -m uvicorn apps.bridge.main:app --host 127.0.0.1 --port 8787 &
BRIDGE_PID=$!

# Wait briefly for bridge to come up before starting web (so healthcheck passes faster).
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done

trap 'kill $BRIDGE_PID $GATEWAY_PID 2>/dev/null || true' EXIT INT TERM

# Auto-start the HERMÉS gateway in a restart loop. Hosts the api_server
# platform (POST /v1/chat/completions) for the dashboard chat plus the
# messaging platforms (Telegram/Slack/Discord/webhook) when configured.
# hermes is installed system-wide (uv pip install --system) in the Docker
# build, so just resolve via PATH instead of a hard-coded venv path.
HERMES_BIN_PATH="$(command -v hermes || true)"
if [ -n "$HERMES_BIN_PATH" ]; then
  echo "[start] hermes found at $HERMES_BIN_PATH — starting gateway with api_server on :$API_SERVER_PORT"
  (
    # Exponential backoff so a bad config doesn't tight-loop the gateway
    # and peg CPU / fill logs. Reset to 5s after a process that ran
    # longer than 60s (clean recovery).
    delay=5
    while true; do
      start_ts=$(date +%s)
      # `gateway run` is the foreground subcommand — bare `gateway` just
      # prints help and exits 0, which would tight-loop the restart wrapper.
      "$HERMES_BIN_PATH" gateway run 2>&1 | sed 's/^/[gateway] /' || true
      end_ts=$(date +%s)
      if [ $((end_ts - start_ts)) -ge 60 ]; then
        delay=5
      else
        delay=$((delay < 60 ? delay * 2 : 60))
      fi
      echo "[start] hermes gateway exited; restarting in ${delay}s"
      sleep "$delay"
    done
  ) &
  GATEWAY_PID=$!
else
  echo "[start] ⚠️  hermes CLI not on PATH — chat will not work. Check the Docker build logs."
fi

# Web binds to $PORT (Railway/Render contract).
echo "[start] launching web on 0.0.0.0:${PORT:-3737}"
cd /app/apps/web
exec node server.js
