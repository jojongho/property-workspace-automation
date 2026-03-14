#!/usr/bin/env python3
"""Build a normalized preview sheet from 분양가_source in the master workbook."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


SOURCE_SHEET = "분양가_source"
NORMALIZED_SHEET = "분양가_source_norm"
ERROR_SHEET = "분양가_source_norm_errors"

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

NORMALIZED_HEADERS = [
    "lookup_key",
    "source_id",
    "source_row",
    "active",
    "priority",
    "단지ID",
    "단지명",
    "타입",
    "동",
    "라인",
    "층_from",
    "층_to",
    "분양가",
    "계약금",
    "중도금",
    "잔금",
    "동_raw",
    "라인_raw",
    "note",
    "generated_at",
]

ERROR_HEADERS = [
    "error_type",
    "source_id",
    "source_row",
    "detail",
    "단지ID",
    "단지명",
    "타입",
    "동_raw",
    "라인_raw",
    "층_from",
    "층_to",
    "note",
    "logged_at",
]

ERROR_TYPES = {
    "missing_required": "MISSING_REQUIRED",
    "invalid_dong_token": "INVALID_DONG_TOKEN",
    "invalid_line_token": "INVALID_LINE_TOKEN",
    "invalid_floor_range": "INVALID_FLOOR_RANGE",
    "missing_key_part": "MISSING_KEY_PART",
    "duplicate_norm_range": "DUPLICATE_NORM_RANGE",
}

DONG_CHAR = "\ub3d9"
HO_CHAR = "\ud638"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", required=True, help="Integrated spreadsheet ID")
    parser.add_argument("--dry-run", action="store_true", help="Calculate only without writing preview sheets")
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

    raise RuntimeError("Unable to locate gws CLI. Ensure gws is installed and on PATH.")


def extract_json(text: str) -> dict[str, Any]:
    lines = [line for line in text.splitlines() if line and not line.startswith("Using keyring backend:")]
    payload = "\n".join(lines).strip()
    if not payload:
        raise RuntimeError("No JSON payload returned from gws")
    return json.loads(payload)


def mint_access_token() -> str:
    command_prefix = resolve_gws_command()
    creds_result = subprocess.run(
        command_prefix + ["auth", "export", "--unmasked"],
        capture_output=True,
        text=True,
        check=True,
    )
    credentials = extract_json(creds_result.stdout)
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
    with urllib.request.urlopen(request) as response:
        token_payload = json.loads(response.read().decode("utf-8"))
    return token_payload["access_token"]


def sheets_api_json(method: str, url: str, access_token: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
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
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {detail}") from error
    return json.loads(raw) if raw else {}


def get_spreadsheet_metadata(spreadsheet_id: str, access_token: str) -> dict[str, Any]:
    fields = "properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))"
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?fields={urllib.parse.quote(fields, safe=',()')}"
    return sheets_api_json("GET", url, access_token)


def get_values(spreadsheet_id: str, range_a1: str, access_token: str) -> list[list[str]]:
    encoded_range = urllib.parse.quote(range_a1, safe="!:'")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}"
    return [[("" if value is None else str(value)) for value in row] for row in sheets_api_json("GET", url, access_token).get("values", [])]


def batch_update_values(spreadsheet_id: str, updates: list[dict[str, Any]], access_token: str) -> None:
    if not updates:
        return
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate?valueInputOption=RAW"
    sheets_api_json("POST", url, access_token, {"valueInputOption": "RAW", "data": updates})


def batch_update_sheet(spreadsheet_id: str, requests: list[dict[str, Any]], access_token: str) -> dict[str, Any]:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate"
    return sheets_api_json("POST", url, access_token, {"requests": requests})


def quote_a1_sheet_title(sheet_title: str) -> str:
    escaped = sheet_title.replace("'", "''")
    return f"'{escaped}'"


def column_letter(column_index: int) -> str:
    letters: list[str] = []
    current = column_index
    while current:
        current, remainder = divmod(current - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


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


def is_active(value: object) -> bool:
    raw = normalize_text(value).lower()
    return raw in {"true", "1", "y", "yes"}


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
        raise RuntimeError(f"Unable to normalize line token: {value}")
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


def parse_floor_range(from_value: object, to_value: object) -> tuple[int | None, int | None, str]:
    floor_from = parse_integer_cell(from_value)
    floor_to = parse_integer_cell(to_value)
    if floor_from is None:
        return None, None, "MISSING_FLOOR_FROM"
    if floor_to is None:
        floor_to = floor_from
    if floor_from > floor_to:
        return None, None, "FLOOR_FROM_GT_FLOOR_TO"
    return floor_from, floor_to, ""


def build_error_row(row: list[str], row_number: int, error_type: str, detail: str, logged_at: str) -> list[Any]:
    padded = list(row) + [""] * max(0, len(SOURCE_HEADERS) - len(row))
    return [
        error_type,
        normalize_text(padded[0]),
        row_number,
        detail,
        normalize_text(padded[3]),
        normalize_text(padded[4]),
        normalize_text(padded[5]),
        normalize_text(padded[6]),
        normalize_text(padded[7]),
        normalize_text(padded[8]),
        normalize_text(padded[9]),
        normalize_text(padded[14]),
        logged_at,
    ]


def build_lookup_key(complex_key: str, type_name: str, dong: str, line: str) -> str:
    return "|".join([complex_key, type_name, dong, line])


def normalize_source_rows(source_values: list[list[str]], generated_at: str) -> tuple[list[list[Any]], list[list[Any]], dict[str, Any]]:
    if not source_values:
        raise RuntimeError("분양가_source 시트가 비어 있습니다.")

    header = source_values[0]
    if header[: len(SOURCE_HEADERS)] != SOURCE_HEADERS:
        raise RuntimeError("분양가_source 헤더가 예상과 다릅니다.")

    normalized_rows: list[list[Any]] = []
    error_rows: list[list[Any]] = []
    duplicate_counter: Counter[tuple[str, str, str, str, int, int]] = Counter()
    active_count = 0

    for row_index, row in enumerate(source_values[1:], start=2):
        if not any(normalize_text(cell) for cell in row):
            continue

        padded = list(row) + [""] * max(0, len(SOURCE_HEADERS) - len(row))
        if not is_active(padded[1]):
            continue
        active_count += 1

        source_id = normalize_text(padded[0])
        complex_id = normalize_text(padded[3])
        complex_name = normalize_text(padded[4])
        type_name = normalize_text(padded[5])
        complex_key = complex_id or complex_name

        if not source_id:
            error_rows.append(build_error_row(padded, row_index, ERROR_TYPES["missing_required"], "source_id가 비어 있습니다.", generated_at))
            continue
        if not complex_key or not type_name:
            error_rows.append(build_error_row(padded, row_index, ERROR_TYPES["missing_key_part"], "단지ID/단지명 또는 타입이 비어 있습니다.", generated_at))
            continue

        dongs, dong_error = parse_dong_tokens(padded[6])
        if dong_error:
            error_rows.append(build_error_row(padded, row_index, ERROR_TYPES["invalid_dong_token"], dong_error, generated_at))
            continue

        lines, line_error = parse_line_tokens(padded[7])
        if line_error:
            error_rows.append(build_error_row(padded, row_index, ERROR_TYPES["invalid_line_token"], line_error, generated_at))
            continue

        floor_from, floor_to, floor_error = parse_floor_range(padded[8], padded[9])
        if floor_error:
            error_rows.append(build_error_row(padded, row_index, ERROR_TYPES["invalid_floor_range"], floor_error, generated_at))
            continue

        priority = parse_integer_cell(padded[2]) or 0
        sale_price = normalize_number(padded[10])
        contract_price = normalize_number(padded[11])
        middle_price = normalize_number(padded[12])
        balance_price = normalize_number(padded[13])
        note = normalize_text(padded[14])

        for dong in dongs:
            for line in lines:
                key = (complex_key, type_name, dong, line, floor_from, floor_to)
                duplicate_counter[key] += 1
                normalized_rows.append(
                    [
                        build_lookup_key(complex_key, type_name, dong, line),
                        source_id,
                        row_index,
                        "TRUE",
                        priority,
                        complex_id,
                        complex_name,
                        type_name,
                        dong,
                        line,
                        floor_from,
                        floor_to,
                        sale_price if sale_price is not None else "",
                        contract_price if contract_price is not None else "",
                        middle_price if middle_price is not None else "",
                        balance_price if balance_price is not None else "",
                        normalize_text(padded[6]),
                        normalize_text(padded[7]),
                        note,
                        generated_at,
                    ]
                )

    duplicate_keys = {key for key, count in duplicate_counter.items() if count > 1}
    if duplicate_keys:
        for row in normalized_rows:
            key = (row[5] or row[6], row[7], row[8], row[9], row[10], row[11])
            if key in duplicate_keys:
                error_rows.append(
                    [
                        ERROR_TYPES["duplicate_norm_range"],
                        row[1],
                        row[2],
                        f"{row[0]}|{row[10]}~{row[11]}",
                        row[5],
                        row[6],
                        row[7],
                        row[16],
                        row[17],
                        row[10],
                        row[11],
                        row[18],
                        generated_at,
                    ]
                )

    stats = {
        "active_source_rows": active_count,
        "normalized_rows": len(normalized_rows),
        "error_rows": len(error_rows),
        "duplicate_norm_range_count": len(duplicate_keys),
        "error_counts": dict(Counter(row[0] for row in error_rows)),
    }
    return normalized_rows, error_rows, stats


def ensure_sheet(spreadsheet_id: str, access_token: str, metadata: dict[str, Any], title: str, rows: int, columns: int) -> None:
    sheet_props = None
    for sheet in metadata.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == title:
            sheet_props = props
            break

    requests: list[dict[str, Any]] = []
    if sheet_props is None:
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "title": title,
                        "gridProperties": {
                            "rowCount": max(rows, 1000),
                            "columnCount": max(columns, 20),
                            "frozenRowCount": 1,
                        },
                    }
                }
            }
        )
    else:
        current_rows = int(sheet_props.get("gridProperties", {}).get("rowCount", 0))
        current_columns = int(sheet_props.get("gridProperties", {}).get("columnCount", 0))
        if current_rows < rows or current_columns < columns:
            requests.append(
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_props["sheetId"],
                            "gridProperties": {
                                "rowCount": max(current_rows, rows),
                                "columnCount": max(current_columns, columns),
                                "frozenRowCount": 1,
                            },
                        },
                        "fields": "gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
                    }
                }
            )

    if requests:
        batch_update_sheet(spreadsheet_id, requests, access_token)


def write_preview_sheets(
    spreadsheet_id: str,
    access_token: str,
    normalized_rows: list[list[Any]],
    error_rows: list[list[Any]],
) -> None:
    metadata = get_spreadsheet_metadata(spreadsheet_id, access_token)
    ensure_sheet(spreadsheet_id, access_token, metadata, NORMALIZED_SHEET, len(normalized_rows) + 1, len(NORMALIZED_HEADERS))
    ensure_sheet(spreadsheet_id, access_token, metadata, ERROR_SHEET, len(error_rows) + 1, len(ERROR_HEADERS))

    normalized_last_col = column_letter(len(NORMALIZED_HEADERS))
    error_last_col = column_letter(len(ERROR_HEADERS))

    batch_update_values(
        spreadsheet_id,
        [
            {
                "range": f"{quote_a1_sheet_title(NORMALIZED_SHEET)}!A1:{normalized_last_col}{len(normalized_rows) + 1}",
                "majorDimension": "ROWS",
                "values": [NORMALIZED_HEADERS] + normalized_rows,
            },
            {
                "range": f"{quote_a1_sheet_title(ERROR_SHEET)}!A1:{error_last_col}{len(error_rows) + 1}",
                "majorDimension": "ROWS",
                "values": [ERROR_HEADERS] + error_rows,
            },
        ],
        access_token,
    )


def main() -> int:
    args = parse_args()
    access_token = mint_access_token()
    source_values = get_values(args.spreadsheet_id, quote_a1_sheet_title(SOURCE_SHEET), access_token)
    generated_at = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "(Get-Date).ToString('yyyy-MM-dd HH:mm:ss')"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    normalized_rows, error_rows, stats = normalize_source_rows(source_values, generated_at)

    if not args.dry_run:
        write_preview_sheets(args.spreadsheet_id, access_token, normalized_rows, error_rows)

    summary = {
        "spreadsheetId": args.spreadsheet_id,
        "dryRun": args.dry_run,
        "sourceSheet": SOURCE_SHEET,
        "normalizedSheet": NORMALIZED_SHEET,
        "errorSheet": ERROR_SHEET,
        **stats,
        "sampleNormalizedRows": normalized_rows[:5],
        "sampleErrors": error_rows[:10],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
