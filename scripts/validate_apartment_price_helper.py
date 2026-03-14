#!/usr/bin/env python3
"""Validate whether the apartment price helper can be built from the live sheet."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path


SOURCE_SHEET = "분양가_source"
HELPER_SHEET = "분양가_helper"
ERROR_SHEET = "분양가_helper_errors"
COMPLEX_SHEET = "아파트단지"
LEGACY_SHEET = "분양가"
FORM_SHEET = "아파트등록"

SOURCE_HEADERS = [
    "source_id",
    "active",
    "priority",
    "단지ID",
    "단지명",
    "타입",
    "동_raw",
    "라인_raw",
    "층_from",
    "층_to",
    "분양가",
    "계약금",
    "중도금",
    "잔금",
    "note",
]

HELPER_HEADERS = [
    "helper_key",
    "source_id",
    "단지ID",
    "단지명",
    "타입",
    "동",
    "층",
    "라인",
    "분양가",
    "계약금",
    "중도금",
    "잔금",
    "source_row",
    "generated_at",
]

ERROR_HEADERS = [
    "error_type",
    "source_id",
    "source_row",
    "detail",
    "conflicting_key",
    "conflicting_source_id",
    "logged_at",
]

DONG_CHAR = "\ub3d9"
HO_CHAR = "\ud638"

SRC_SOURCE_ID = 0
SRC_ACTIVE = 1
SRC_PRIORITY = 2
SRC_COMPLEX_ID = 3
SRC_COMPLEX_NAME = 4
SRC_TYPE = 5
SRC_DONG_RAW = 6
SRC_LINE_RAW = 7
SRC_FLOOR_FROM = 8
SRC_FLOOR_TO = 9
SRC_SALE_PRICE = 10
SRC_NOTE = 14

LEG_COMPLEX_NAME = 0
LEG_DONG = 1
LEG_HO = 2
LEG_TYPE = 3
LEG_SALE_PRICE = 7

CPX_NAME = 0
CPX_ID = 54


class ValidationError(RuntimeError):
    """Raised when the validator cannot complete the live check."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", required=True, help="Google Spreadsheet ID")
    parser.add_argument("--max-examples", type=int, default=5, help="Maximum examples per category")
    return parser.parse_args()


def resolve_gws_command() -> list[str]:
    gws = shutil.which("gws") or shutil.which("gws.cmd")
    if gws:
        return [gws]

    node = shutil.which("node")
    appdata = os.environ.get("APPDATA", "")
    run_gws = Path(appdata) / "npm" / "node_modules" / "@googleworkspace" / "cli" / "run-gws.js"
    if node and run_gws.exists():
        return [node, str(run_gws)]

    raise ValidationError("Unable to locate gws CLI. Ensure gws is installed and on PATH.")


def extract_json(text: str) -> dict:
    lines = [line for line in text.splitlines() if line and not line.startswith("Using keyring backend:")]
    payload = "\n".join(lines).strip()
    if not payload:
        raise ValidationError("No JSON payload returned from gws")
    return json.loads(payload)


def run_gws_json(command_prefix: list[str], *args: str) -> dict:
    result = subprocess.run(command_prefix + list(args), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"command failed: {' '.join(command_prefix + list(args))}"
        raise ValidationError(message)
    return extract_json(result.stdout)


def mint_access_token(command_prefix: list[str]) -> str:
    credentials = run_gws_json(command_prefix, "auth", "export", "--unmasked")
    payload = urllib.parse.urlencode(
        {
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": credentials["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            token_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ValidationError(f"Failed to mint access token: {detail}") from error

    return token_payload["access_token"]


def sheets_api_json(method: str, url: str, access_token: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ValidationError(f"Sheets API request failed: {detail}") from error


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def normalize_number(value: object) -> int | None:
    cleaned = re.sub(r"[^0-9.-]", "", str(value or ""))
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def parse_integer_cell(value: object) -> int | None:
    raw = normalize_text(value)
    if not raw:
        return None
    if not re.fullmatch(r"-?\d+", raw):
        return None
    return int(raw)


def parse_dong_tokens(raw_value: object) -> tuple[list[str], str]:
    raw = normalize_text(raw_value)
    if not raw:
        return [], "MISSING_DONG_RAW"

    normalized = raw.replace(",", " ")
    if re.search(fr"{DONG_CHAR}\d", normalized):
        return [], "MALFORMED_DONG_SEPARATOR"

    parts = [part for part in re.split(r"\s+", normalized) if part]
    tokens: list[str] = []
    seen: set[str] = set()
    for part in parts:
        match = re.fullmatch(fr"(\d+)(?:~(\d+))?{DONG_CHAR}?", part)
        if not match:
            return [], f"INVALID_DONG_PART:{part}"
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        if start > end:
            return [], f"INVALID_DONG_RANGE:{part}"
        for value in range(start, end + 1):
            token = str(value)
            if token not in seen:
                seen.add(token)
                tokens.append(token)
    return tokens, ""


def pad_line_token(value: object) -> str:
    numeric = re.sub(r"[^0-9]", "", str(value or ""))
    if not numeric:
        raise ValidationError(f"Unable to normalize line token: {value}")
    return numeric if len(numeric) >= 2 else f"0{numeric}"


def parse_line_tokens(raw_value: object) -> tuple[list[str], str]:
    raw = normalize_text(raw_value)
    if not raw:
        return [], "MISSING_LINE_RAW"

    normalized = raw.replace(",", " ")
    if re.search(fr"{HO_CHAR}\d", normalized):
        return [], "MALFORMED_LINE_SEPARATOR"

    parts = [part for part in re.split(r"\s+", normalized) if part]
    tokens: list[str] = []
    seen: set[str] = set()
    for part in parts:
        match = re.fullmatch(fr"(\d+)(?:~(\d+))?{HO_CHAR}?", part)
        if not match:
            return [], f"INVALID_LINE_PART:{part}"
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        if start > end:
            return [], f"INVALID_LINE_RANGE:{part}"
        for value in range(start, end + 1):
            token = pad_line_token(value)
            if token not in seen:
                seen.add(token)
                tokens.append(token)
    return tokens, ""


def parse_floor_range(from_value: object, to_value: object) -> tuple[list[str], str]:
    start = parse_integer_cell(from_value)
    if start is None:
        return [], "INVALID_FLOOR_FROM"

    end = start if not normalize_text(to_value) else parse_integer_cell(to_value)
    if end is None:
        return [], "INVALID_FLOOR_TO"
    if start > end:
        return [], "INVALID_FLOOR_RANGE"

    return [str(value) for value in range(start, end + 1)], ""


def normalize_dong_lookup(dong: object) -> str:
    raw = normalize_text(dong)
    match = re.fullmatch(fr"(\d+){DONG_CHAR}?", raw)
    if not match:
        raise ValidationError(f"Unable to normalize dong value: {dong}")
    return str(int(match.group(1)))


def parse_ho_for_lookup(ho: object) -> tuple[str, str]:
    digits = re.sub(r"[^0-9]", "", str(ho or ""))
    if len(digits) < 3:
        raise ValidationError(f"Unable to split floor/line from ho value: {ho}")
    floor = str(int(digits[:-2]))
    line = pad_line_token(digits[-2:])
    return floor, line


def build_helper_key(complex_id: object, type_name: object, dong: object, line: object, floor: object) -> str:
    parts = [
        normalize_text(complex_id),
        normalize_text(type_name),
        normalize_text(dong),
        normalize_text(line),
        normalize_text(floor),
    ]
    if any(not part for part in parts):
        raise ValidationError("Helper key contains an empty component")
    return "|".join(parts)


def count_data_rows(values: list[list[object]]) -> int:
    if not values:
        return 0
    return sum(1 for row in values[1:] if any(normalize_text(cell) for cell in row))


def find_sheet(metadata: dict, title: str) -> dict:
    for sheet in metadata.get("sheets", []):
        if sheet.get("properties", {}).get("title") == title:
            return sheet
    raise ValidationError(f"Sheet not found: {title}")


def build_grid_range(sheet: dict, end_column_index: int | None = None) -> dict:
    props = sheet["properties"]
    grid = props["gridProperties"]
    return {
        "sheetId": props["sheetId"],
        "startRowIndex": 0,
        "endRowIndex": grid["rowCount"],
        "startColumnIndex": 0,
        "endColumnIndex": end_column_index if end_column_index is not None else grid["columnCount"],
    }


def collect_form_snapshot(form_values: list[list[object]]) -> dict:
    def row_value(row_index: int, column_index: int) -> str:
        if row_index >= len(form_values):
            return ""
        row = form_values[row_index]
        if column_index >= len(row):
            return ""
        return normalize_text(row[column_index])

    return {
        "단지명": row_value(1, 2),
        "동": row_value(2, 2),
        "호": row_value(3, 2),
        "타입": row_value(4, 2),
        "분양가": row_value(7, 2),
    }


def main() -> int:
    args = parse_args()
    command_prefix = resolve_gws_command()
    access_token = mint_access_token(command_prefix)
    metadata = sheets_api_json(
        "GET",
        f"https://sheets.googleapis.com/v4/spreadsheets/{args.spreadsheet_id}",
        access_token,
    )

    source_sheet = find_sheet(metadata, SOURCE_SHEET)
    helper_sheet = find_sheet(metadata, HELPER_SHEET)
    error_sheet = find_sheet(metadata, ERROR_SHEET)
    complex_sheet = find_sheet(metadata, COMPLEX_SHEET)
    legacy_sheet = find_sheet(metadata, LEGACY_SHEET)
    form_sheet = find_sheet(metadata, FORM_SHEET)

    values_payload = sheets_api_json(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{args.spreadsheet_id}/values:batchGetByDataFilter",
        access_token,
        body={
            "dataFilters": [
                {"gridRange": build_grid_range(source_sheet, len(SOURCE_HEADERS))},
                {"gridRange": build_grid_range(helper_sheet, len(HELPER_HEADERS))},
                {"gridRange": build_grid_range(error_sheet, len(ERROR_HEADERS))},
                {"gridRange": build_grid_range(complex_sheet)},
                {"gridRange": build_grid_range(legacy_sheet, 19)},
                {
                    "gridRange": {
                        "sheetId": form_sheet["properties"]["sheetId"],
                        "startRowIndex": 2,
                        "endRowIndex": 15,
                        "startColumnIndex": 0,
                        "endColumnIndex": 17,
                    }
                },
            ],
            "majorDimension": "ROWS",
            "valueRenderOption": "FORMATTED_VALUE",
        },
    )

    values_by_sheet_id: dict[int, list[list[object]]] = {}
    for value_range in values_payload.get("valueRanges", []):
        grid_range = value_range["dataFilters"][0]["gridRange"]
        values_by_sheet_id[grid_range["sheetId"]] = value_range["valueRange"].get("values", [])

    source_values = values_by_sheet_id[source_sheet["properties"]["sheetId"]]
    helper_values = values_by_sheet_id[helper_sheet["properties"]["sheetId"]]
    error_values = values_by_sheet_id[error_sheet["properties"]["sheetId"]]
    complex_values = values_by_sheet_id[complex_sheet["properties"]["sheetId"]]
    legacy_values = values_by_sheet_id[legacy_sheet["properties"]["sheetId"]]
    form_values = values_by_sheet_id[form_sheet["properties"]["sheetId"]]

    complex_id_by_name: dict[str, str] = {}
    complex_name_by_id: dict[str, str] = {}
    for row in complex_values[1:]:
        complex_name = normalize_text(row[0] if len(row) > 0 else "")
        complex_id = normalize_text(row[54] if len(row) > 54 else "")
        if complex_name and complex_id:
            complex_id_by_name[complex_name] = complex_id
            complex_name_by_id[complex_id] = complex_name

    error_counts: Counter[str] = Counter()
    invalid_line_examples: list[dict[str, object]] = []
    invalid_dong_examples: list[dict[str, object]] = []
    comma_range_examples: list[dict[str, object]] = []
    duplicate_key_examples: list[dict[str, object]] = []

    virtual_helper: dict[str, dict[str, object]] = {}
    active_source_rows = 0
    valid_source_rows = 0

    for row_number, row in enumerate(source_values[1:], start=2):
        active = normalize_text(row[SRC_ACTIVE] if len(row) > SRC_ACTIVE else "")
        if active.upper() not in {"TRUE", "Y", "YES", "1"}:
            continue

        active_source_rows += 1
        source_id = normalize_text(row[SRC_SOURCE_ID] if len(row) > SRC_SOURCE_ID else "")
        complex_id = normalize_text(row[SRC_COMPLEX_ID] if len(row) > SRC_COMPLEX_ID else "")
        complex_name = normalize_text(row[SRC_COMPLEX_NAME] if len(row) > SRC_COMPLEX_NAME else "")
        type_name = normalize_text(row[SRC_TYPE] if len(row) > SRC_TYPE else "")
        dong_raw = normalize_text(row[SRC_DONG_RAW] if len(row) > SRC_DONG_RAW else "")
        line_raw = normalize_text(row[SRC_LINE_RAW] if len(row) > SRC_LINE_RAW else "")
        floor_from = row[SRC_FLOOR_FROM] if len(row) > SRC_FLOOR_FROM else ""
        floor_to = row[SRC_FLOOR_TO] if len(row) > SRC_FLOOR_TO else ""
        sale_price = normalize_number(row[SRC_SALE_PRICE] if len(row) > SRC_SALE_PRICE else "")

        if "," in dong_raw and "~" in dong_raw and len(comma_range_examples) < args.max_examples:
            comma_range_examples.append(
                {
                    "row": row_number,
                    "source_id": source_id,
                    "complex_id": complex_id,
                    "type": type_name,
                    "dong_raw": dong_raw,
                    "line_raw": line_raw,
                    "floor_from": normalize_text(floor_from),
                    "floor_to": normalize_text(floor_to),
                }
            )

        dong_tokens, dong_error = parse_dong_tokens(dong_raw)
        if dong_error:
            error_counts["INVALID_DONG_TOKEN"] += 1
            if len(invalid_dong_examples) < args.max_examples:
                invalid_dong_examples.append(
                    {
                        "row": row_number,
                        "source_id": source_id,
                        "detail": dong_error,
                        "dong_raw": dong_raw,
                        "line_raw": line_raw,
                    }
                )
            continue

        line_tokens, line_error = parse_line_tokens(line_raw)
        if line_error:
            error_counts["INVALID_LINE_TOKEN"] += 1
            if len(invalid_line_examples) < args.max_examples * 2:
                invalid_line_examples.append(
                    {
                        "row": row_number,
                        "source_id": source_id,
                        "detail": line_error,
                        "complex_id": complex_id,
                        "type": type_name,
                        "dong_raw": dong_raw,
                        "line_raw": line_raw,
                        "floor_from": normalize_text(floor_from),
                        "floor_to": normalize_text(floor_to),
                    }
                )
            continue

        floor_tokens, floor_error = parse_floor_range(floor_from, floor_to)
        if floor_error:
            error_counts["INVALID_FLOOR_RANGE"] += 1
            continue

        valid_source_rows += 1
        key_base = complex_id or complex_name
        resolved_complex_name = complex_name_by_id.get(complex_id, complex_name)
        for dong in dong_tokens:
            for line in line_tokens:
                for floor in floor_tokens:
                    helper_key = build_helper_key(key_base, type_name, dong, line, floor)
                    if helper_key in virtual_helper:
                        error_counts["DUPLICATE_HELPER_KEY"] += 1
                        if len(duplicate_key_examples) < args.max_examples:
                            duplicate_key_examples.append(
                                {
                                    "helper_key": helper_key,
                                    "first_row": virtual_helper[helper_key]["row"],
                                    "second_row": row_number,
                                }
                            )
                        continue
                    virtual_helper[helper_key] = {
                        "row": row_number,
                        "complex_id": complex_id,
                        "complex_name": resolved_complex_name,
                        "type": type_name,
                        "dong": dong,
                        "line": line,
                        "floor": floor,
                        "sale_price": sale_price,
                    }

    legacy_index: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
    same_unit_diff_type: defaultdict[tuple[str, str, str], set[str]] = defaultdict(set)
    for row_number, row in enumerate(legacy_values[1:], start=2):
        if len(row) <= LEG_SALE_PRICE:
            continue
        complex_name = normalize_text(row[LEG_COMPLEX_NAME])
        complex_id = complex_id_by_name.get(complex_name, "")
        dong = normalize_text(row[LEG_DONG])
        ho = normalize_text(row[LEG_HO])
        type_name = normalize_text(row[LEG_TYPE])
        sale_price = normalize_number(row[LEG_SALE_PRICE])
        if not (complex_id and dong and ho and type_name):
            continue
        try:
            floor, line = parse_ho_for_lookup(ho)
            normalized_dong = normalize_dong_lookup(dong)
        except ValidationError:
            continue
        helper_key = build_helper_key(complex_id, type_name, normalized_dong, line, floor)
        legacy_index[helper_key].append(
            {
                "row": row_number,
                "complex_name": complex_name,
                "dong": normalized_dong,
                "ho": ho,
                "type": type_name,
                "sale_price": sale_price,
            }
        )
        same_unit_diff_type[(complex_name, normalized_dong, ho)].add(type_name)

    price_match_examples: list[dict[str, object]] = []
    additional_legacy_examples: list[dict[str, object]] = []
    for helper_key, helper_row in virtual_helper.items():
        legacy_matches = legacy_index.get(helper_key, [])
        if not legacy_matches:
            continue
        exact_matches = [match for match in legacy_matches if match["sale_price"] == helper_row["sale_price"]]
        if exact_matches and len(price_match_examples) < args.max_examples:
            match = exact_matches[0]
            price_match_examples.append(
                {
                    "helper_key": helper_key,
                    "complex_name": helper_row["complex_name"],
                    "dong": helper_row["dong"],
                    "ho": match["ho"],
                    "type": helper_row["type"],
                    "source_row": helper_row["row"],
                    "legacy_row": match["row"],
                    "sale_price": helper_row["sale_price"],
                }
            )
            continue
        if exact_matches and len(additional_legacy_examples) < args.max_examples:
            match = exact_matches[0]
            additional_legacy_examples.append(
                {
                    "helper_key": helper_key,
                    "complex_name": helper_row["complex_name"],
                    "dong": helper_row["dong"],
                    "ho": match["ho"],
                    "type": helper_row["type"],
                    "source_row": helper_row["row"],
                    "legacy_row": match["row"],
                    "sale_price": helper_row["sale_price"],
                }
            )
            continue
        if len(additional_legacy_examples) < args.max_examples:
            match = legacy_matches[0]
            additional_legacy_examples.append(
                {
                    "helper_key": helper_key,
                    "complex_name": helper_row["complex_name"],
                    "dong": helper_row["dong"],
                    "ho": match["ho"],
                    "type": helper_row["type"],
                    "source_row": helper_row["row"],
                    "legacy_row": match["row"],
                    "source_sale_price": helper_row["sale_price"],
                    "legacy_sale_price": match["sale_price"],
                }
            )

    same_unit_diff_type_examples: list[dict[str, object]] = []
    for (complex_name, dong, ho), types in same_unit_diff_type.items():
        if len(types) > 1:
            same_unit_diff_type_examples.append(
                {
                    "complex_name": complex_name,
                    "dong": dong,
                    "ho": ho,
                    "types": sorted(types),
                }
            )
        if len(same_unit_diff_type_examples) >= args.max_examples:
            break

    summary = {
        "spreadsheet_id": args.spreadsheet_id,
        "spreadsheet_title": metadata.get("properties", {}).get("title", ""),
        "sheet_ids": {
            SOURCE_SHEET: source_sheet["properties"]["sheetId"],
            HELPER_SHEET: helper_sheet["properties"]["sheetId"],
            ERROR_SHEET: error_sheet["properties"]["sheetId"],
            COMPLEX_SHEET: complex_sheet["properties"]["sheetId"],
            LEGACY_SHEET: legacy_sheet["properties"]["sheetId"],
            FORM_SHEET: form_sheet["properties"]["sheetId"],
        },
        "header_validation": {
            SOURCE_SHEET: source_values[0] == SOURCE_HEADERS if source_values else False,
            HELPER_SHEET: helper_values[0] == HELPER_HEADERS if helper_values else False,
            ERROR_SHEET: error_values[0] == ERROR_HEADERS if error_values else False,
        },
        "actual_sheet_state": {
            "helper_rows": count_data_rows(helper_values),
            "helper_error_rows": count_data_rows(error_values),
            "form_snapshot": collect_form_snapshot(form_values),
        },
        "virtual_build_state": {
            "active_source_rows": active_source_rows,
            "valid_source_rows": valid_source_rows,
            "virtual_helper_rows": len(virtual_helper),
            "error_counts": dict(error_counts),
        },
        "comma_range_examples": comma_range_examples,
        "invalid_dong_examples": invalid_dong_examples,
        "invalid_line_examples": invalid_line_examples,
        "duplicate_key_examples": duplicate_key_examples,
        "price_match_examples": price_match_examples,
        "additional_legacy_examples": additional_legacy_examples,
        "same_unit_diff_type_examples": same_unit_diff_type_examples,
        "blockers": [
            "분양가_helper 시트가 헤더만 남아 있으면 현재 exact helper lookup은 실제 런타임에서 불가능합니다."
            if count_data_rows(helper_values) == 0
            else "",
            "분양가_source의 유효하지 않은 active 행을 수정하거나, helper 빌드 정책을 '오류 행만 스킵'으로 바꾸기 전까지 helper가 비어 있을 수 있습니다."
            if count_data_rows(error_values) > 0
            else "",
        ],
    }
    summary["blockers"] = [item for item in summary["blockers"] if item]

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
