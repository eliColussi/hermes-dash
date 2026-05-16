#!/usr/bin/env bash
# Single-container start: bridge in background, web in foreground.
set -euo pipefail

mkdir -p "${HERMES_HOME:-/data/hermes}" "${STAFFROOM_HOME:-/data/staffroom}"
mkdir -p "${HERMES_HOME:-/data/hermes}/plugins"

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
    while true; do
      # `gateway run` is the foreground subcommand — bare `gateway` just
      # prints help and exits 0, which would tight-loop the restart wrapper.
      "$HERMES_BIN_PATH" gateway run 2>&1 | sed 's/^/[gateway] /' || true
      echo "[start] hermes gateway exited; restarting in 5s"
      sleep 5
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
