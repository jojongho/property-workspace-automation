#!/usr/bin/env bash
set -euo pipefail

echo "This repository is already standalone."
echo "Use it directly as the property workspace automation repo."
echo "Current path: $(cd "$(dirname "$0")/.." && pwd)"
