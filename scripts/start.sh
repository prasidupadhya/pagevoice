#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! test -x .venv/bin/pagevoice-server || ! test -f web/dist/index.html; then
  ./scripts/setup.sh
fi
exec .venv/bin/pagevoice-server
