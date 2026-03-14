#!/usr/bin/env python3
"""Extract a Notion MCP query-database-view JSON payload from a Codex session log."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def iter_jsonl(path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-log", required=True)
    parser.add_argument("--view-url", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    session_log = Path(args.session_log)
    output_path = Path(args.output)
    entries = iter_jsonl(session_log)

    matched_call_id = None
    for entry in reversed(entries):
        payload = entry.get("payload") or {}
        if payload.get("type") != "function_call":
            continue
        if payload.get("name") != "mcp__notion__notion-query-database-view":
            continue
        arguments = payload.get("arguments") or ""
        if args.view_url not in arguments:
            continue
        matched_call_id = payload.get("call_id")
        break

    if not matched_call_id:
        raise SystemExit(f"No matching query call found for view URL: {args.view_url}")

    for entry in reversed(entries):
        payload = entry.get("payload") or {}
        if payload.get("type") != "function_call_output":
            continue
        if payload.get("call_id") != matched_call_id:
            continue
        raw_output = payload.get("output") or ""
        parsed = json.loads(raw_output)
        if isinstance(parsed, list):
            text_payload = next(
                (
                    item.get("text")
                    for item in parsed
                    if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
                ),
                None,
            )
            if text_payload is None:
                raise SystemExit(f"Unexpected output payload for call_id: {matched_call_id}")
            parsed = json.loads(text_payload)
        output_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
        print(str(output_path))
        return 0

    raise SystemExit(f"No output found for call_id: {matched_call_id}")


if __name__ == "__main__":
    raise SystemExit(main())
