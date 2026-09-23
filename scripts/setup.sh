#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo 'Install ffmpeg first (macOS: brew install ffmpeg).'; exit 1; }
command -v ffprobe >/dev/null
"${PYTHON:-python3}" -m venv .venv
.venv/bin/python -m pip install 'pip==25.0.1'
.venv/bin/python -m pip install -c requirements-core.lock -e '.[test]'
.venv/bin/pagevoice doctor
