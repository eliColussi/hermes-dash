#!/usr/bin/env bash
set -euo pipefail

# Staff Room OS installer (single-tenant).
# Installs the Python bridge + Next.js dashboard side-by-side with vendored HERMÉS.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\033[1;34m[staffroom]\033[0m %s\n" "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }

say "Verifying prerequisites…"
need python3
need node
need npm

if ! command -v uv >/dev/null 2>&1; then
  say "Installing uv (fast Python package manager)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

say "Setting up Python venv for the bridge…"
cd "$REPO_ROOT/apps/bridge"
uv venv --python 3.11
export VIRTUAL_ENV="$REPO_ROOT/apps/bridge/.venv"
uv pip install -e .
# Also install vendored HERMÉS so the bridge can import its modules later.
uv pip install -e "$REPO_ROOT/vendor/hermes-agent" || \
  say "Skipped editable install of hermes-agent (some optional deps may have failed); CLI shellout still works."

say "Installing Next.js dashboard…"
cd "$REPO_ROOT/apps/web"
npm install

mkdir -p "$HOME/.staff-room-os"

say "Done."
cat <<EOF

  Start the stack with:

    cd $REPO_ROOT && ./installer/run.sh

  Then open http://localhost:3737

EOF
