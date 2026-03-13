#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "This repository does not run a long-lived server."
echo "Use one of the following instead:"
echo "  make check"
echo "  python3 scripts/gws_push_apps_script_project.py --script-id <SCRIPT_ID> --verify"
echo "  python3 scripts/backfill_property_folder_links.py --canonical-sheet 건물 --row-start 2 --row-end 60"
