#!/usr/bin/env python3
"""Extract a JSON-ish tool output payload from a Codex session log."""

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


def unwrap_output(raw_output: str) -> Any:
    parsed = json.loads(raw_output)
    if not isinstance(parsed, list):
        return parsed

    text_payload = next(
        (
            item.get("text")
            for item in parsed
            if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
        ),
        None,
    )
    if text_payload is None:
        return parsed
    try:
        return json.loads(text_payload)
    except json.JSONDecodeError:
        return {"text": text_payload}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-log", required=True)
    parser.add_argument("--tool-name", required=True)
    parser.add_argument("--argument-substring", required=True)
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
        if payload.get("name") != args.tool_name:
            continue
        arguments = payload.get("arguments") or ""
        if args.argument_substring not in arguments:
            continue
        matched_call_id = payload.get("call_id")
        break

    if not matched_call_id:
        raise SystemExit(
            f"No matching call found for tool={args.tool_name} argument containing: {args.argument_substring}"
        )

    for entry in reversed(entries):
        payload = entry.get("payload") or {}
        if payload.get("type") != "function_call_output":
            continue
        if payload.get("call_id") != matched_call_id:
            continue
        parsed = unwrap_output(payload.get("output") or "")
        output_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
        print(str(output_path))
        return 0

    raise SystemExit(f"No output found for call_id: {matched_call_id}")


if __name__ == "__main__":
    raise SystemExit(main())
