#!/usr/bin/env bash
# Local dev server. ES modules don't load over file://, so serve over http.
# Usage: ./serve.sh [port]   (default 8080)

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8080}"

if command -v python3 >/dev/null 2>&1; then
  echo "Hider Deck → http://localhost:${PORT}"
  exec python3 -m http.server "$PORT"
fi

if command -v npx >/dev/null 2>&1; then
  echo "Hider Deck → http://localhost:${PORT}"
  exec npx --yes serve . -l "$PORT"
fi

echo "Need python3 or npx to serve this folder." >&2
exit 1
