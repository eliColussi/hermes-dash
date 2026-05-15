#!/usr/bin/env bash
# Single-container start: bridge in background, web in foreground.
set -euo pipefail

mkdir -p "${HERMES_HOME:-/data/hermes}" "${STAFFROOM_HOME:-/data/staffroom}"

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

trap 'kill $BRIDGE_PID 2>/dev/null || true' EXIT INT TERM

# Web binds to $PORT (Railway/Render contract).
echo "[start] launching web on 0.0.0.0:${PORT:-3737}"
cd /app/apps/web
exec node server.js
