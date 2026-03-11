#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from building_ledger_api.config import Settings
from building_ledger_api.service import LedgerLookupService


def main() -> int:
    parser = argparse.ArgumentParser(description="One-off building ledger lookup")
    parser.add_argument("--address", required=True, help="지번 주소")
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    settings = Settings.load()
    service = LedgerLookupService(settings)
    result = service.lookup(args.address, force_refresh=args.force_refresh)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
