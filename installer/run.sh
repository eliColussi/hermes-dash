#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  pkill -P $$ || true
}
trap cleanup EXIT INT TERM

cd "$REPO_ROOT/apps/bridge"
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8787 --reload &
BRIDGE_PID=$!

cd "$REPO_ROOT/apps/web"
BRIDGE_URL=http://127.0.0.1:8787 npm run dev &
WEB_PID=$!

echo "Bridge: http://127.0.0.1:8787  (pid $BRIDGE_PID)"
echo "Web:    http://127.0.0.1:3737  (pid $WEB_PID)"

wait
