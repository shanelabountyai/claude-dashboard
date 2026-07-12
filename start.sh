#!/usr/bin/env bash
# Claude Dashboard launcher.
#
# Double-click this file (macOS: via start.command, which just calls this) or
# run `./start.sh` / `npm start` from a terminal. Installs dependencies on
# first run, starts the server, and opens the dashboard in your browser.

set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

PORT="${PORT:-4173}"
URL="http://localhost:${PORT}"

echo ""
echo "  Claude Dashboard"
echo "  starting at ${URL}"
echo ""

# Best-effort: open the browser once the server is likely up. Not fatal if
# `open` isn't available (e.g. non-macOS).
( sleep 1.2 && command -v open >/dev/null 2>&1 && open "$URL" ) &

PORT="$PORT" node server.js
