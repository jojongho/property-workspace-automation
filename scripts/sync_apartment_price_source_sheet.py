#!/usr/bin/env python3
"""Sync normalized apartment pricing into the master 분양가_source sheet."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from apartment_price_normalizer import NORMALIZED_PRICING_COLUMNS, normalize_pricing_rows
from legacy_price_normalizer import (
    LayoutRow,
    aggregate_atomic_priced_units,
    build_atomic_priced_units,
    parse_layout_rows,
    parse_legacy_price_rows,
    rows_to_dicts,
)


MASTER_SOURCE_TAB_TITLE = "분양가_source"
MASTER_COMPLEX_TAB_TITLE = "아파트단지"
UNIT_NORMALIZED_TAB_TITLE = "분양가_동층별"
LAYOUT_TAB_TITLE = "단지입력"
LEGACY_PRICE_TAB_TITLE = "분양가"
SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet"
IGNORED_FILE_NAMES = {"단지DB 템플릿", "아파트단지DB"}
SOURCE_REQUIRED_COLUMNS = (
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
)


@dataclass(frozen=True)
class SpreadsheetFile:
    file_id: str
    name: str
    mime_type: str
    modified_time: str
    parents: tuple[str, ...]


@dataclass(frozen=True)
class SheetInfo:
    title: str
    sheet_id: int
    index: int
    row_count: int
    column_count: int


@dataclass(frozen=True)
class ComplexWorkbook:
    file_id: str
    file_name: str
    modified_time: str
    complex_name: str
    tabs: dict[str, SheetInfo]


@dataclass(frozen=True)
class WorkbookData:
    workbook: ComplexWorkbook
    layout_rows: list[list[str]]
    legacy_price_rows: list[list[str]]
    normalized_rows: list[list[str]]


@dataclass
class SyncResult:
    complex_name: str
    spreadsheet_id: str
    source: str
    status: str
    row_count: int
    unmatched_count: int
    message: str = ""
    rows: list[dict[str, Any]] | None = None
    source_rows: list[dict[str, Any]] | None = None


class GoogleWorkspaceClient:
    def __init__(self) -> None:
        self.access_token = self._mint_access_token()

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        lines = [line for line in text.splitlines() if line and not line.startswith("Using keyring backend:")]
        payload = "\n".join(lines).strip()
        if not payload:
            raise RuntimeError("No JSON payload returned")
        return json.loads(payload)

    def _mint_access_token(self) -> str:
        command_prefix = resolve_gws_command()
        creds_result = subprocess.run(
            command_prefix + ["auth", "export", "--unmasked"],
            capture_output=True,
            text=True,
            check=True,
        )
        creds = self._extract_json(creds_result.stdout)
        payload = urllib.parse.urlencode(
            {
                "client_id": creds["client_id"],
                "client_secret": creds["client_secret"],
                "refresh_token": creds["refresh_token"],
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

    def request(self, method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {self.access_token}",
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

    def list_spreadsheets_in_folder(self, folder_id: str) -> list[SpreadsheetFile]:
        query = (
            f"'{folder_id}' in parents and trashed=false and "
            f"mimeType='{SPREADSHEET_MIME_TYPE}'"
        )
        params = urllib.parse.urlencode(
            {
                "q": query,
                "fields": "files(id,name,mimeType,parents,modifiedTime)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageSize": "1000",
            }
        )
        url = f"https://www.googleapis.com/drive/v3/files?{params}"
        files = self.request("GET", url).get("files", [])
        return [
            SpreadsheetFile(
                file_id=item["id"],
                name=item.get("name", ""),
                mime_type=item.get("mimeType", ""),
                modified_time=item.get("modifiedTime", ""),
                parents=tuple(item.get("parents", [])),
            )
            for item in files
        ]

    def get_spreadsheet_metadata(self, spreadsheet_id: str) -> dict[str, Any]:
        fields = "properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))"
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?fields={urllib.parse.quote(fields, safe=',()')}"
        return self.request("GET", url)

    def get_sheet_values(self, spreadsheet_id: str, range_a1: str) -> list[list[str]]:
        encoded_range = urllib.parse.quote(range_a1, safe="!:'")
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}"
        return [
            ["" if value is None else str(value) for value in row]
            for row in self.request("GET", url).get("values", [])
        ]

    def clear_values(self, spreadsheet_id: str, range_a1: str) -> None:
        encoded_range = urllib.parse.quote(range_a1, safe="!:'")
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}:clear"
        self.request("POST", url, {})

    def batch_update_values(self, spreadsheet_id: str, updates: list[dict[str, Any]]) -> None:
        if not updates:
            return
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate"
            "?valueInputOption=RAW"
        )
        self.request("POST", url, {"valueInputOption": "RAW", "data": updates})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build 분양가_source rows from unit spreadsheets and sync the master workbook."
    )
    parser.add_argument("--folder-id", required=True, help="Drive folder containing unit spreadsheets")
    parser.add_argument("--master-sheet-id", required=True, help="Integrated spreadsheet ID")
    parser.add_argument("--complex-name", help="Optional complex name filter")
    parser.add_argument("--dry-run", action="store_true", help="Read and calculate without writing the master sheet")
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


def main() -> int:
    args = parse_args()
    client = GoogleWorkspaceClient()

    master_header, master_tabs, complex_id_lookup = load_master_source_context(client, args.master_sheet_id)
    workbooks, duplicates = list_complex_workbooks(client, args.folder_id)
    if args.complex_name:
        workbooks = [workbook for workbook in workbooks if workbook.complex_name == args.complex_name]

    results: list[SyncResult] = []
    for workbook in workbooks:
        result = process_workbook(client, workbook)
        results.append(result)

    successful = [result for result in results if result.source_rows]
    if successful and not args.dry_run:
        sync_master_source_sheet(
            client,
            args.master_sheet_id,
            master_tabs[MASTER_SOURCE_TAB_TITLE],
            master_header,
            successful,
            complex_id_lookup,
        )

    summary = {
        "folderId": args.folder_id,
        "masterSheetId": args.master_sheet_id,
        "dryRun": args.dry_run,
        "processedComplexCount": len(workbooks),
        "successfulComplexCount": len(successful),
        "skippedOrFailedCount": len(results) - len(successful),
        "duplicateWorkbookCount": len(duplicates),
        "sourceRowCount": sum(len(result.source_rows or []) for result in successful),
        "results": [
            {
                "complexName": result.complex_name,
                "spreadsheetId": result.spreadsheet_id,
                "source": result.source,
                "status": result.status,
                "rowCount": result.row_count,
                "unmatchedCount": result.unmatched_count,
                "message": result.message,
                "sourceRowCount": len(result.source_rows or []),
            }
            for result in results
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def load_master_source_context(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
) -> tuple[list[str], dict[str, SheetInfo], dict[str, str]]:
    metadata = client.get_spreadsheet_metadata(spreadsheet_id)
    tabs = parse_tabs(metadata)
    if MASTER_SOURCE_TAB_TITLE not in tabs:
        raise RuntimeError(f"Master spreadsheet is missing {MASTER_SOURCE_TAB_TITLE}")

    values = client.get_sheet_values(spreadsheet_id, f"{quote_a1_sheet_title(MASTER_SOURCE_TAB_TITLE)}!1:1")
    if not values:
        raise RuntimeError(f"Master spreadsheet {MASTER_SOURCE_TAB_TITLE} header is empty")

    header = values[0]
    missing = [column for column in SOURCE_REQUIRED_COLUMNS if column not in header]
    if missing:
        raise RuntimeError(f"Master spreadsheet header is missing required columns: {', '.join(missing)}")

    complex_id_lookup = load_complex_id_lookup(client, spreadsheet_id, tabs)
    return header, tabs, complex_id_lookup


def load_complex_id_lookup(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
    tabs: dict[str, SheetInfo],
) -> dict[str, str]:
    if MASTER_COMPLEX_TAB_TITLE not in tabs:
        return {}

    sheet_info = tabs[MASTER_COMPLEX_TAB_TITLE]
    last_col = column_letter(max(sheet_info.column_count, 1))
    last_row = max(sheet_info.row_count, 1)
    range_name = f"{quote_a1_sheet_title(MASTER_COMPLEX_TAB_TITLE)}!A1:{last_col}{last_row}"
    values = client.get_sheet_values(spreadsheet_id, range_name)
    if len(values) < 2:
        return {}

    header = values[0]
    if "단지명" not in header or "단지ID" not in header:
        return {}

    name_index = header.index("단지명")
    id_index = header.index("단지ID")
    lookup: dict[str, str] = {}
    for row in values[1:]:
        if name_index >= len(row):
            continue
        complex_name = row[name_index].strip()
        if not complex_name:
            continue
        complex_id = row[id_index].strip() if id_index < len(row) else ""
        lookup[normalize_lookup_key(complex_name)] = complex_id
    return lookup


def list_complex_workbooks(
    client: GoogleWorkspaceClient,
    folder_id: str,
) -> tuple[list[ComplexWorkbook], list[SpreadsheetFile]]:
    files = [
        item
        for item in client.list_spreadsheets_in_folder(folder_id)
        if item.name not in IGNORED_FILE_NAMES
    ]

    chosen_by_name: dict[str, tuple[ComplexWorkbook, SpreadsheetFile]] = {}
    duplicates: list[SpreadsheetFile] = []

    for file in sorted(files, key=lambda item: (item.name, item.modified_time, item.file_id)):
        workbook = load_workbook(client, file)
        existing = chosen_by_name.get(workbook.complex_name)
        if existing is None:
            chosen_by_name[workbook.complex_name] = (workbook, file)
            continue

        current, current_file = existing
        if (file.modified_time, file.file_id) >= (current.modified_time, current.file_id):
            duplicates.append(current_file)
            chosen_by_name[workbook.complex_name] = (workbook, file)
        else:
            duplicates.append(file)

    workbooks = [item[0] for item in chosen_by_name.values()]
    workbooks.sort(key=lambda workbook: natural_sort_key(workbook.complex_name))
    duplicates.sort(key=lambda item: (item.name, item.modified_time, item.file_id))
    return workbooks, duplicates


def load_workbook(client: GoogleWorkspaceClient, file: SpreadsheetFile) -> ComplexWorkbook:
    metadata = client.get_spreadsheet_metadata(file.file_id)
    tabs = parse_tabs(metadata)
    complex_name = resolve_complex_name(client, file.file_id, file.name, tabs)
    return ComplexWorkbook(
        file_id=file.file_id,
        file_name=file.name,
        modified_time=file.modified_time,
        complex_name=complex_name,
        tabs=tabs,
    )


def parse_tabs(metadata: dict[str, Any]) -> dict[str, SheetInfo]:
    tabs: dict[str, SheetInfo] = {}
    for sheet in metadata.get("sheets", []):
        properties = sheet.get("properties", {})
        grid = properties.get("gridProperties", {})
        title = properties.get("title", "")
        if not title:
            continue
        tabs[title] = SheetInfo(
            title=title,
            sheet_id=int(properties.get("sheetId", 0)),
            index=int(properties.get("index", 0)),
            row_count=int(grid.get("rowCount", 0)),
            column_count=int(grid.get("columnCount", 0)),
        )
    return tabs


def resolve_complex_name(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
    file_name: str,
    tabs: dict[str, SheetInfo],
) -> str:
    schedule_name = extract_complex_name_from_tab(client, spreadsheet_id, tabs, "단지일정", max_rows=5)
    if schedule_name:
        return schedule_name

    normalized_name = extract_complex_name_from_tab(client, spreadsheet_id, tabs, UNIT_NORMALIZED_TAB_TITLE, max_rows=3)
    if normalized_name:
        return normalized_name

    return clean_complex_name_from_file_title(file_name)


def extract_complex_name_from_tab(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
    tabs: dict[str, SheetInfo],
    title: str,
    *,
    max_rows: int,
) -> str:
    rows = read_optional_tab(client, spreadsheet_id, tabs, title, max_rows=max_rows)
    if len(rows) < 2:
        return ""
    header = rows[0]
    if "단지명" not in header:
        return ""
    index = header.index("단지명")
    for row in rows[1:]:
        if index < len(row) and row[index].strip():
            return row[index].strip()
    return ""


def clean_complex_name_from_file_title(file_name: str) -> str:
    return file_name.replace("단지DB", "").strip()


def read_optional_tab(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
    tabs: dict[str, SheetInfo],
    title: str,
    *,
    max_rows: int | None = None,
) -> list[list[str]]:
    if title not in tabs:
        return []
    quoted_title = quote_a1_sheet_title(title)
    if max_rows is None:
        range_name = quoted_title
    else:
        last_col = column_letter(max(tabs[title].column_count, 1))
        range_name = f"{quoted_title}!A1:{last_col}{max_rows}"
    try:
        return client.get_sheet_values(spreadsheet_id, range_name)
    except RuntimeError as error:
        message = str(error)
        if "Unable to parse range" in message or "Requested entity was not found" in message:
            return []
        raise


def process_workbook(client: GoogleWorkspaceClient, workbook: ComplexWorkbook) -> SyncResult:
    workbook_data = WorkbookData(
        workbook=workbook,
        layout_rows=read_optional_tab(client, workbook.file_id, workbook.tabs, LAYOUT_TAB_TITLE),
        legacy_price_rows=read_optional_tab(client, workbook.file_id, workbook.tabs, LEGACY_PRICE_TAB_TITLE),
        normalized_rows=read_optional_tab(client, workbook.file_id, workbook.tabs, UNIT_NORMALIZED_TAB_TITLE),
    )

    sheet_result = build_rows_from_existing_sheets(
        workbook.complex_name,
        workbook_data.layout_rows,
        workbook_data.legacy_price_rows,
    )
    normalized_result = build_rows_from_existing_normalized_tab(
        workbook.complex_name,
        workbook_data.normalized_rows,
        workbook_data.layout_rows,
    )
    chosen = choose_best_result(sheet_result, normalized_result)
    chosen.spreadsheet_id = workbook.file_id
    return chosen


def choose_best_result(sheet_result: SyncResult, normalized_result: SyncResult | None) -> SyncResult:
    if sheet_result.source_rows:
        return sheet_result
    if normalized_result and normalized_result.source_rows:
        return normalized_result
    return normalized_result or sheet_result


def build_rows_from_existing_sheets(
    complex_name: str,
    layout_values: list[list[str]],
    price_values: list[list[str]],
) -> SyncResult:
    layout_rows = parse_layout_rows(layout_values)
    price_rows = parse_legacy_price_rows(price_values)
    if not layout_rows or not price_rows:
        return SyncResult(
            complex_name=complex_name,
            spreadsheet_id="",
            source="sheet",
            status="skipped_missing_sources",
            row_count=0,
            unmatched_count=0,
            message="단지입력 또는 분양가 레거시 탭이 비어 있습니다.",
            rows=[],
            source_rows=[],
        )

    atomic_units, unmatched = build_atomic_priced_units(complex_name, layout_rows, price_rows)
    normalized_rows = aggregate_atomic_priced_units(complex_name, layout_rows, atomic_units)
    row_dicts = rows_to_dicts(normalized_rows, NORMALIZED_PRICING_COLUMNS)
    source_rows = build_source_rows(complex_name, row_dicts, layout_rows, source_kind="sheet")
    match_rate = len(atomic_units) / len(price_rows) if price_rows else 0.0

    return SyncResult(
        complex_name=complex_name,
        spreadsheet_id="",
        source="sheet",
        status="rebuilt_from_sheet" if row_dicts else "failed_validation",
        row_count=len(row_dicts),
        unmatched_count=len(unmatched),
        message=f"match_rate={match_rate:.2%}",
        rows=row_dicts,
        source_rows=source_rows,
    )


def build_rows_from_existing_normalized_tab(
    complex_name: str,
    normalized_values: list[list[str]],
    layout_values: list[list[str]],
) -> SyncResult | None:
    if len(normalized_values) < 2:
        return None

    header = normalized_values[0]
    if "단지명" not in header or "타입" not in header or "동별(라인별)" not in header:
        return None

    items: list[dict[str, Any]] = []
    for row in normalized_values[1:]:
        if not any(cell.strip() for cell in row):
            continue
        item = {column: row[index] for index, column in enumerate(header) if index < len(row)}
        if not item.get("단지명"):
            item["단지명"] = complex_name
        items.append(item)

    if not items:
        return None

    normalized_rows = normalize_pricing_rows(complex_name, items)
    if not normalized_rows:
        return None

    layout_rows = parse_layout_rows(layout_values)
    row_dicts = [{column: row.get(column, "") for column in NORMALIZED_PRICING_COLUMNS} for row in normalized_rows]
    source_rows = build_source_rows(complex_name, row_dicts, layout_rows, source_kind="existing_normalized")
    return SyncResult(
        complex_name=complex_name,
        spreadsheet_id="",
        source="existing_normalized",
        status="rebuilt_from_existing_normalized",
        row_count=len(row_dicts),
        unmatched_count=0,
        message="existing_normalized_tab",
        rows=row_dicts,
        source_rows=source_rows,
    )


def build_source_rows(
    complex_name: str,
    normalized_rows: list[dict[str, Any]],
    layout_rows: list[LayoutRow],
    *,
    source_kind: str,
) -> list[dict[str, Any]]:
    layout_lines_by_type_dong: dict[str, dict[str, tuple[int, ...]]] = defaultdict(dict)
    for row in layout_rows:
        current = set(layout_lines_by_type_dong[row.type_name].get(row.dong, ()))
        current.add(row.line)
        layout_lines_by_type_dong[row.type_name][row.dong] = tuple(sorted(current))

    source_rows: list[dict[str, Any]] = []
    for normalized_row in normalized_rows:
        source_rows.extend(
            build_source_rows_for_normalized_row(
                complex_name,
                normalized_row,
                layout_lines_by_type_dong,
                source_kind=source_kind,
            )
        )
    return source_rows


def prepare_master_source_row(complex_name: str, complex_id: str, row: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(row)
    prepared["단지명"] = complex_name
    prepared["단지ID"] = complex_id
    prepared["source_id"] = build_source_id(complex_id, prepared)
    prepared["active"] = prepared.get("active", "TRUE")
    prepared["priority"] = prepared.get("priority", 1)
    return prepared


def build_source_id(complex_id: str, row: dict[str, Any]) -> str:
    payload = "|".join(
        str(row.get(column, ""))
        for column in ("단지명", "타입", "동_raw", "라인_raw", "층_from", "층_to", "분양가", "계약금", "중도금", "잔금", "note")
    )
    digest = hashlib.sha1(f"{complex_id}|{payload}".encode("utf-8")).hexdigest()[:16]
    return f"SRC_{digest}"


def build_source_rows_for_normalized_row(
    complex_name: str,
    normalized_row: dict[str, Any],
    layout_lines_by_type_dong: dict[str, dict[str, tuple[int, ...]]],
    *,
    source_kind: str,
) -> list[dict[str, Any]]:
    type_name = str(normalized_row.get("타입", "")).strip()
    label = str(normalized_row.get("동별(라인별)", "")).strip()
    parsed_segments = parse_group_segments(label)

    grouped_dongs: dict[tuple[int, ...], list[str]] = defaultdict(list)
    if parsed_segments:
        for dongs, explicit_lines in parsed_segments:
            for dong in dongs:
                if explicit_lines is None:
                    lines = layout_lines_by_type_dong.get(type_name, {}).get(dong, ())
                else:
                    lines = explicit_lines
                grouped_dongs[tuple(lines)].append(dong)
    else:
        grouped_dongs[tuple()] = []

    floor_from = coerce_int(normalized_row.get("최저층"))
    floor_to = coerce_int(normalized_row.get("최고층"))
    contract_total = coerce_int(normalized_row.get("1차계약금")) + coerce_int(normalized_row.get("2차계약금"))
    middle_total = sum(coerce_int(normalized_row.get(f"중도금{index}회")) for index in range(1, 7))
    note = (
        f"source={source_kind}; group={label}; floor={normalized_row.get('층구분', '')}; "
        f"공급세대수={normalized_row.get('공급세대수', '')}; 해당세대수={normalized_row.get('해당세대수', '')}"
    )

    source_rows: list[dict[str, Any]] = []
    for lines, dongs in sorted(grouped_dongs.items(), key=lambda item: (dong_sort_key(item[1]), item[0])):
        source_rows.append(
            {
                "source_id": "",
                "active": "TRUE",
                "priority": 1,
                "단지ID": "",
                "단지명": complex_name,
                "타입": type_name,
                "동_raw": format_dong_raw(dongs, label),
                "라인_raw": format_line_raw(lines),
                "층_from": floor_from,
                "층_to": floor_to,
                "분양가": coerce_int(normalized_row.get("분양가")),
                "계약금": contract_total,
                "중도금": middle_total,
                "잔금": coerce_int(normalized_row.get("잔금")),
                "note": note,
            }
        )
    return source_rows


def sync_master_source_sheet(
    client: GoogleWorkspaceClient,
    spreadsheet_id: str,
    sheet_info: SheetInfo,
    master_header: list[str],
    results: list[SyncResult],
    complex_id_lookup: dict[str, str],
) -> None:
    current_values = client.get_sheet_values(spreadsheet_id, quote_a1_sheet_title(MASTER_SOURCE_TAB_TITLE))
    if current_values:
        header = current_values[0]
        existing_rows = [pad_row(row, len(header)) for row in current_values[1:]]
    else:
        header = master_header
        existing_rows = []

    complex_index = header.index("단지명")
    replace_names = {result.complex_name for result in results}
    preserved_rows = [row for row in existing_rows if row[complex_index] not in replace_names]

    new_rows: list[list[str]] = []
    for result in results:
        assert result.source_rows is not None
        complex_id = complex_id_lookup.get(normalize_lookup_key(result.complex_name), "")
        for row in result.source_rows:
            prepared = prepare_master_source_row(result.complex_name, complex_id, row)
            new_rows.append([str(prepared.get(column, "")) for column in header])

    final_matrix = [header] + preserved_rows + new_rows
    quoted_title = quote_a1_sheet_title(MASTER_SOURCE_TAB_TITLE)
    last_col = column_letter(max(sheet_info.column_count, len(header)))
    client.clear_values(spreadsheet_id, f"{quoted_title}!A2:{last_col}")
    client.batch_update_values(
        spreadsheet_id,
        [
            {
                "range": f"{quoted_title}!A1:{column_letter(len(header))}{len(final_matrix)}",
                "majorDimension": "ROWS",
                "values": final_matrix,
            }
        ],
    )


def parse_group_segments(label: str) -> list[tuple[list[str], tuple[int, ...] | None]]:
    matches = list(re.finditer(r"(\d+(?:\s*~\s*\d+)?)동(?:\s+([\d,\s~]+)호)?", label))
    segments: list[tuple[list[str], tuple[int, ...] | None]] = []
    for match in matches:
        dongs = [str(value) for value in parse_number_expression(match.group(1))]
        if not dongs:
            continue
        line_text = match.group(2)
        lines = tuple(parse_number_expression(line_text)) if line_text else None
        segments.append((dongs, lines))
    return segments


def parse_number_expression(value: str | None) -> list[int]:
    if value is None:
        return []

    compact = re.sub(r"[^\d,~\-]", "", value)
    parts = [part for part in re.split(r"[，,]", compact) if part]
    numbers: list[int] = []
    for part in parts:
        range_match = re.fullmatch(r"(\d+)\s*[~\-]\s*(\d+)", part)
        if range_match:
            start, end = map(int, range_match.groups())
            if start > end:
                start, end = end, start
            numbers.extend(range(start, end + 1))
            continue
        if part.isdigit():
            numbers.append(int(part))
    return sorted(set(numbers))


def format_dong_raw(dongs: list[str], fallback_label: str) -> str:
    if not dongs:
        return fallback_label
    values = [int(dong) for dong in dongs if str(dong).isdigit()]
    return format_number_expression(values) if values else fallback_label


def format_line_raw(lines: tuple[int, ...]) -> str:
    return format_number_expression(lines)


def format_number_expression(values: Any) -> str:
    numbers = sorted({int(value) for value in values if int(value) > 0})
    if not numbers:
        return ""

    segments: list[str] = []
    start = numbers[0]
    end = start
    for value in numbers[1:]:
        if value == end + 1:
            end = value
            continue
        segments.append(f"{start}~{end}" if start != end else str(start))
        start = end = value
    segments.append(f"{start}~{end}" if start != end else str(start))
    return ",".join(segments)


def normalize_lookup_key(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return re.sub(r"[^0-9A-Za-z가-힣]", "", normalized).lower()


def coerce_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        cleaned = re.sub(r"[^\d-]", "", str(value))
        return int(cleaned) if cleaned and cleaned != "-" else 0


def pad_row(row: list[str], width: int) -> list[str]:
    if len(row) >= width:
        return list(row[:width])
    return list(row) + [""] * (width - len(row))


def quote_a1_sheet_title(sheet_title: str) -> str:
    escaped = sheet_title.replace("'", "''")
    return f"'{escaped}'"


def column_letter(column_index: int) -> str:
    if column_index <= 0:
        raise ValueError("column_index must be positive")

    letters: list[str] = []
    current = column_index
    while current:
        current, remainder = divmod(current - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


def dong_sort_key(dongs: list[str]) -> tuple[int, ...]:
    numeric = [int(dong) for dong in dongs if str(dong).isdigit()]
    return tuple(numeric) if numeric else (0,)


def natural_sort_key(value: str) -> tuple:
    parts = re.split(r"(\d+)", value)
    normalized: list[int | str] = []
    for part in parts:
        if not part:
            continue
        if part.isdigit():
            normalized.append(int(part))
        else:
            normalized.append(part.lower())
    return tuple(normalized)


if __name__ == "__main__":
    sys.exit(main())
