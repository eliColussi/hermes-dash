#!/usr/bin/env bash
# upstream-sync.sh — diff vendored HERMÉS against latest upstream.
#
# Usage:
#   scripts/upstream-sync.sh                 # show what changed, no writes
#   scripts/upstream-sync.sh --apply         # overwrite vendor/ and bump SHA
#
# The default mode is read-only on purpose. You review the summary, decide
# which changes you want, and only then re-run with --apply. The script
# never touches anything outside vendor/hermes-agent and prints what it's
# about to do before doing it.
#
# Categories in the summary surface the diffs that need the most thought:
#   gateway/         — runtime behaviour (most likely to break things)
#   cron/            — scheduling engine
#   hermes_state.py  — SQLite schema (migrations land here)
#   gateway/platforms/  — channel adapters (telegram, slack, etc.)
#   plugins/         — bundled plugins (could conflict with ours)
#   tests/, docs/    — safe to take wholesale
set -euo pipefail

REPO_URL="${HERMES_UPSTREAM_URL:-https://github.com/NousResearch/hermes-agent}"
REPO_BRANCH="${HERMES_UPSTREAM_BRANCH:-main}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$HERE/vendor/hermes-agent"
SHA_FILE="$VENDOR_DIR/.upstream-sha"
APPLY=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    -h|--help)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//' | head -25
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -d "$VENDOR_DIR" ]; then
  echo "vendor/hermes-agent missing — nothing to sync against." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[sync] cloning $REPO_URL@$REPO_BRANCH (shallow)…"
git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$TMP/hermes-upstream" >/dev/null 2>&1

UPSTREAM_SHA=$(git -C "$TMP/hermes-upstream" rev-parse HEAD)
UPSTREAM_DATE=$(git -C "$TMP/hermes-upstream" log -1 --format=%ci HEAD | cut -d' ' -f1)
CURRENT_SHA=$(awk '/^sha:/ {print $2; exit}' "$SHA_FILE" 2>/dev/null || echo "unknown")

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "  upstream HEAD: $UPSTREAM_SHA  ($UPSTREAM_DATE)"
echo "  vendored at:   $CURRENT_SHA"
echo "─────────────────────────────────────────────────────────────"
echo ""

# Categorise: count files changed per top-level area. We don't show every
# diff (that scrolls forever) — just the shape, so you know where to dig.
CHANGES=$(diff -rq "$VENDOR_DIR" "$TMP/hermes-upstream" 2>/dev/null \
  | grep -v "^Only in $VENDOR_DIR:" \
  | grep -v "\.upstream-sha" \
  | grep -v "__pycache__" \
  || true)

if [ -z "$CHANGES" ]; then
  echo "[sync] no changes — already up to date with upstream."
  exit 0
fi

echo "Changes by area (file count):"
echo "$CHANGES" | sed "s|$TMP/hermes-upstream/||;s|$VENDOR_DIR/||" \
  | awk '{
      for (i=1;i<=NF;i++) if ($i ~ /\//) { print $i; break }
    }' \
  | awk -F/ '{print $1}' \
  | sort | uniq -c | sort -rn

echo ""
echo "Hot areas to review carefully:"
for area in gateway/platforms gateway hermes_state.py cron plugins; do
  count=$(echo "$CHANGES" | grep -c "$area" || true)
  [ "$count" -gt 0 ] && printf "  %-25s %s files\n" "$area" "$count"
done

echo ""
echo "Full diff (file list only):"
echo "$CHANGES" | sed "s|$TMP/hermes-upstream/||;s|$VENDOR_DIR/||" | head -50
TOTAL=$(echo "$CHANGES" | wc -l | tr -d ' ')
if [ "$TOTAL" -gt 50 ]; then
  echo "  …and $((TOTAL - 50)) more. Re-run with: diff -rq vendor/hermes-agent $TMP/hermes-upstream"
fi

if ! $APPLY; then
  echo ""
  echo "[sync] read-only mode. Review the changes above, then re-run with --apply"
  echo "       to overwrite vendor/hermes-agent and bump the SHA pin."
  exit 0
fi

# --apply: do the actual sync. Stage everything atomically.
echo ""
echo "[sync] applying upstream… (overwriting $VENDOR_DIR)"
read -p "  This will replace the vendored tree. Continue? [y/N] " ack
case "$ack" in
  y|Y|yes|YES) ;;
  *) echo "[sync] aborted."; exit 0 ;;
esac

# Preserve the .upstream-sha file's notes (operator may have annotated).
NOTES_BLOCK=$(awk '/^notes:/{p=1} p' "$SHA_FILE" 2>/dev/null || true)

rm -rf "$VENDOR_DIR"
mv "$TMP/hermes-upstream" "$VENDOR_DIR"
rm -rf "$VENDOR_DIR/.git"  # we vendor a snapshot, not a sub-repo

cat > "$SHA_FILE" <<EOF
# HERMÉS upstream pin (auto-written by scripts/upstream-sync.sh)

repo: $REPO_URL
sha: $UPSTREAM_SHA
date: $(date -u +%Y-%m-%d)
branch: $REPO_BRANCH
EOF
if [ -n "$NOTES_BLOCK" ]; then
  echo "$NOTES_BLOCK" >> "$SHA_FILE"
fi

echo "[sync] done. New SHA recorded in $SHA_FILE"
echo "       Next: run your test suite, smoke-test the Telegram bot, then"
echo "       commit and push. Railway will deploy to clients on next push."
