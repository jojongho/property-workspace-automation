#!/usr/bin/env bash
set -euo pipefail

echo "This repository is already standalone."
echo "Use it directly from its own path instead of exporting from a workspace copy."
echo "Current path: $(cd "$(dirname "$0")/.." && pwd)"
