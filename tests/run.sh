#!/usr/bin/env bash
# Activate the local venv and run pytest. Quiet wrapper used in cron jobs.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No .venv here — run:"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

# shellcheck source=/dev/null
source .venv/bin/activate
exec pytest -v --tb=short "$@"
