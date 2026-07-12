#!/usr/bin/env bash
# macOS Finder double-clicks *.command files and runs them in Terminal.
# This just hands off to start.sh so there's one source of truth.
cd "$(dirname "$0")"
./start.sh
