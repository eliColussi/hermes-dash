#!/usr/bin/env bash
# Single-container start: bridge in background, web in foreground.
set -euo pipefail

mkdir -p "${HERMES_HOME:-/data/hermes}" "${STAFFROOM_HOME:-/data/staffroom}"
mkdir -p "${HERMES_HOME:-/data/hermes}/plugins"

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

# HERMÉS plugins are opt-in via plugins.enabled in config.yaml. Make sure
# every plugin we shipped is enabled. Idempotent — preserves any other config.
PLUGIN_NAMES="$PLUGIN_NAMES" HERMES_HOME="${HERMES_HOME:-/data/hermes}" python3 - <<'PYEOF'
import os, yaml
path = os.path.join(os.environ["HERMES_HOME"], "config.yaml")
cfg = {}
if os.path.exists(path):
    with open(path) as f:
        cfg = yaml.safe_load(f) or {}
plugins = cfg.setdefault("plugins", {})
enabled = plugins.setdefault("enabled", [])
shipped = [n for n in os.environ.get("PLUGIN_NAMES", "").split() if n]
added = False
for name in shipped:
    if name not in enabled:
        enabled.append(name)
        added = True
if added:
    with open(path, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    print(f"[start] enabled plugins: {shipped}")
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

# Auto-start the HERMÉS gateway in a restart loop. Clients never see this; it
# just hums in the background so Telegram/Slack/webhook traffic gets handled.
# Suppressed entirely unless at least one messaging or webhook channel is
# configured (no point spinning up a gateway with nothing to route).
HERMES_BIN_PATH="/app/apps/bridge/.venv/bin/hermes"
if [ -x "$HERMES_BIN_PATH" ] && {
     [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || [ -n "${SLACK_BOT_TOKEN:-}" ] || \
     [ -n "${DISCORD_BOT_TOKEN:-}" ] || [ -n "${WEBHOOK_ENABLED:-}" ];
   }; then
  (
    while true; do
      echo "[start] launching hermes gateway"
      "$HERMES_BIN_PATH" gateway || echo "[start] hermes gateway exited; restarting in 5s"
      sleep 5
    done
  ) &
  GATEWAY_PID=$!
fi

# Web binds to $PORT (Railway/Render contract).
echo "[start] launching web on 0.0.0.0:${PORT:-3737}"
cd /app/apps/web
exec node server.js
