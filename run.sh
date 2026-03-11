#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null

uvicorn building_ledger_api.main:app --app-dir src --host "${HOST:-0.0.0.0}" --port "${PORT:-8080}" --reload
