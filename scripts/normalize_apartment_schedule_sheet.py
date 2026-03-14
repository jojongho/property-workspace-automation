#!/usr/bin/env python3
"""Normalize the apartment schedule sheet using the same migration rules."""

from __future__ import annotations

import argparse
import json
import sys

from migrate_notion_property_dbs_to_sheets import (
    DATASET_CONFIGS,
    GoogleApiClient,
    apply_apartment_schedule_business_rules,
    normalize_text,
    row_dict_from_sheet,
)


TARGET_HEADER = ["단지명", "일정명", "시작일", "종료일", "비고"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = DATASET_CONFIGS["apartment_schedule"]
    client = GoogleApiClient()
    sheet_rows = client.get_sheet_values(config.spreadsheet_id, config.sheet_name)
    if not sheet_rows:
        raise RuntimeError("Target sheet is empty")

    current_header = [normalize_text(value) for value in sheet_rows[0]]
    current_rows = sheet_rows[1:]

    normalized_input: list[dict[str, str]] = []
    for row in current_rows:
        row_dict = row_dict_from_sheet(current_header, row)
        normalized_input.append({column: normalize_text(row_dict.get(column)) for column in TARGET_HEADER})

    normalized_rows = apply_apartment_schedule_business_rules(normalized_input)
    output_values = [TARGET_HEADER]
    for row in normalized_rows:
        output_values.append([row.get(column, "") for column in TARGET_HEADER])

    if not args.dry_run:
        client.ensure_sheet_grid(config.spreadsheet_id, config.sheet_name, len(output_values), len(TARGET_HEADER))
        client.batch_update_values(
            config.spreadsheet_id,
            [
                {
                    "range": f"{config.sheet_name}!A1:E{len(output_values)}",
                    "majorDimension": "ROWS",
                    "values": output_values,
                }
            ],
        )

    issue_rows = 0
    for row in normalized_rows:
        if row.get("시작일") and len(normalize_text(row["시작일"])) != 10:
            issue_rows += 1
        if row.get("종료일") and len(normalize_text(row["종료일"])) != 10:
            issue_rows += 1

    print(
        json.dumps(
            {
                "sheet": config.sheet_name,
                "rows": len(normalized_rows),
                "dry_run": args.dry_run,
                "header": TARGET_HEADER,
                "remaining_non_iso_issue_count": issue_rows,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
