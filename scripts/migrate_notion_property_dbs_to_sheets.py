#!/usr/bin/env python3
"""Upsert Notion property database rows into Google Sheets DB tabs.

This script is intentionally split into two layers:

1. Assistant/MCP extracts Notion rows and optional lookup tables.
2. This script normalizes those rows and upserts them into the target sheet.

It does not call the Notion API directly. That keeps auth simple and makes the
Google Sheets write path reusable for staged migrations.
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DatasetConfig:
    name: str
    spreadsheet_id: str
    sheet_name: str
    d_id_column: str | None


DATASET_CONFIGS: dict[str, DatasetConfig] = {
    "apartment": DatasetConfig(
        "apartment",
        "1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ",
        "아파트",
        "D_AD_ID",
    ),
    "apartment_complex": DatasetConfig(
        "apartment_complex",
        "1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ",
        "아파트단지",
        None,
    ),
    "apartment_type": DatasetConfig(
        "apartment_type",
        "1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ",
        "타입",
        None,
    ),
    "apartment_schedule": DatasetConfig(
        "apartment_schedule",
        "1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ",
        "단지일정",
        None,
    ),
    "house": DatasetConfig(
        "house",
        "1V3PVwVRFbHbrOu2JKlE1xlDVCosHy08hPUeX5HojYoU",
        "주택",
        "D_H_ID",
    ),
    "building": DatasetConfig(
        "building",
        "1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E",
        "건물",
        "D_B_ID",
    ),
    "store": DatasetConfig(
        "store",
        "1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E",
        "상가",
        "D_S_ID",
    ),
    "room": DatasetConfig(
        "room",
        "1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E",
        "원투룸",
        "D_O_ID",
    ),
    "land": DatasetConfig(
        "land",
        "1mGWLvOXUkANttGS0YBQYGgJzB9Af9oivc0uskkB6bsw",
        "토지",
        "D_L_ID",
    ),
    "factory": DatasetConfig(
        "factory",
        "1GPtVtbDJEVnXuYGFnCgaA6vcigt8khdw_0-nCg7pD5U",
        "공장창고",
        "D_F_ID",
    ),
}


PROTECTED_BLANK_PRESERVE_COLUMNS = {
    "관련파일",
    "폴더ID",
    "단지ID",
    "접수자",
    "접수일",
    "고객",
}


class GoogleApiClient:
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
        creds_result = subprocess.run(
            ["gws", "auth", "export", "--unmasked"],
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
        )
        token_result = subprocess.run(
            [
                "curl",
                "-sS",
                "--fail-with-body",
                "--retry",
                "5",
                "--retry-all-errors",
                "--retry-delay",
                "2",
                "https://oauth2.googleapis.com/token",
                "-H",
                "Content-Type: application/x-www-form-urlencoded",
                "--data",
                payload,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(token_result.stdout)["access_token"]

    def request(self, method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        command = [
            "curl",
            "-sS",
            "--fail-with-body",
            "--retry",
            "5",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "--connect-timeout",
            "30",
            "--max-time",
            "120",
            "-X",
            method,
            url,
            "-H",
            f"Authorization: Bearer {self.access_token}",
        ]
        stdin_text = None
        if payload is not None:
            command.extend(["-H", "Content-Type: application/json", "--data-binary", "@-"])
            stdin_text = json.dumps(payload, ensure_ascii=False)
        result = subprocess.run(command, input=stdin_text, capture_output=True, text=True, check=True)
        raw = result.stdout.strip()
        return json.loads(raw) if raw else {}

    def get_sheet_values(self, spreadsheet_id: str, range_a1: str) -> list[list[Any]]:
        encoded_range = urllib.parse.quote(range_a1, safe="!:'")
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}"
        return self.request("GET", url).get("values", [])

    def batch_update_values(self, spreadsheet_id: str, updates: list[dict[str, Any]]) -> None:
        if not updates:
            return
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate"
            "?valueInputOption=RAW"
        )
        payload = {"valueInputOption": "RAW", "data": updates}
        self.request("POST", url, payload)

    def get_spreadsheet_metadata(self, spreadsheet_id: str) -> dict[str, Any]:
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
            "?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"
        )
        return self.request("GET", url)

    def ensure_sheet_grid(self, spreadsheet_id: str, sheet_name: str, min_rows: int, min_columns: int) -> None:
        metadata = self.get_spreadsheet_metadata(spreadsheet_id)
        sheet_properties = None
        for sheet in metadata.get("sheets", []):
            properties = sheet.get("properties", {})
            if properties.get("title") == sheet_name:
                sheet_properties = properties
                break
        if sheet_properties is None:
            raise RuntimeError(f"Sheet not found: {sheet_name}")

        grid = sheet_properties.get("gridProperties", {})
        current_rows = int(grid.get("rowCount", 0))
        current_columns = int(grid.get("columnCount", 0))
        if current_rows >= min_rows and current_columns >= min_columns:
            return

        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate"
        payload = {
            "requests": [
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_properties["sheetId"],
                            "gridProperties": {
                                "rowCount": max(current_rows, min_rows),
                                "columnCount": max(current_columns, min_columns),
                            },
                        },
                        "fields": "gridProperties.rowCount,gridProperties.columnCount",
                    }
                }
            ]
        }
        self.request("POST", url, payload)


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.startswith("formulaResult://") or text == "<omitted />":
        return ""
    return text


def collapse_space(value: Any) -> str:
    return " ".join(normalize_text(value).split())


def safe_token(value: Any) -> str:
    raw = collapse_space(value)
    return "".join(ch for ch in raw if ch.isalnum() or ("가" <= ch <= "힣") or ch in {"-", "_", " ", "."}).strip()


def parse_json_array(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_text(item) for item in value if normalize_text(item)]
    text = normalize_text(value)
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return [text]
        if isinstance(parsed, list):
            return [normalize_text(item) for item in parsed if normalize_text(item)]
    return [text]


def first_json_value(value: Any) -> str:
    values = parse_json_array(value)
    return values[0] if values else ""


def join_json_values(value: Any, sep: str = ", ") -> str:
    return sep.join(parse_json_array(value))


def parse_bool_cell(value: Any) -> str:
    text = normalize_text(value)
    if text == "__YES__":
        return "TRUE"
    if text == "__NO__":
        return "FALSE"
    if not text:
        return ""
    if text.lower() in {"true", "false"}:
        return text.upper()
    return text


def parse_number(value: Any) -> Any:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    text = normalize_text(value).replace(",", "")
    if not text:
        return ""
    try:
        number = float(text)
    except ValueError:
        return normalize_text(value)
    if number.is_integer():
        return int(number)
    return number


ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
ISO_DATETIME_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})T")
DOTTED_DATE_RE = re.compile(r"^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$")
KOREAN_YEAR_MONTH_RE = re.compile(r"^(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*예정)?$")
COMPACT_YEAR_MONTH_RE = re.compile(r"^(\d{4})(\d{2})$")
CONTRACT_PLUS_ONE_MONTH_RE = re.compile(r"^계약\s*후\s*1개월(?:\s*이내|\s*내)?$")
MOVE_IN_REFERENCE_RE = re.compile(r"^입주\s*(?:지정일|시)$")


def iso_date(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def is_iso_date(value: Any) -> bool:
    return bool(ISO_DATE_RE.fullmatch(collapse_space(value)))


def month_end_date(year: int, month: int) -> str:
    return iso_date(year, month, calendar.monthrange(year, month)[1])


def shift_iso_date_by_months(value: Any, months: int) -> str:
    text = collapse_space(value)
    match = ISO_DATE_RE.fullmatch(text)
    if not match:
        return ""
    year, month, day = (int(part) for part in match.groups())
    total_month = year * 12 + (month - 1) + months
    next_year = total_month // 12
    next_month = total_month % 12 + 1
    next_day = min(day, calendar.monthrange(next_year, next_month)[1])
    return iso_date(next_year, next_month, next_day)


def parse_schedule_month_end(value: Any) -> str:
    text = collapse_space(value)
    if not text:
        return ""
    compact = COMPACT_YEAR_MONTH_RE.fullmatch(text)
    if compact:
        year, month = (int(part) for part in compact.groups())
        if 1 <= month <= 12:
            return month_end_date(year, month)
    korean = KOREAN_YEAR_MONTH_RE.fullmatch(text)
    if korean:
        year, month = (int(part) for part in korean.groups())
        if 1 <= month <= 12:
            return month_end_date(year, month)
    return ""


def parse_schedule_date(value: Any) -> str:
    text = collapse_space(value)
    if not text:
        return ""
    iso_match = ISO_DATE_RE.fullmatch(text)
    if iso_match:
        year, month, day = (int(part) for part in iso_match.groups())
        return iso_date(year, month, day)
    iso_datetime = ISO_DATETIME_RE.match(text)
    if iso_datetime:
        year, month, day = (int(part) for part in iso_datetime.groups())
        return iso_date(year, month, day)
    dotted = DOTTED_DATE_RE.fullmatch(text)
    if dotted:
        year, month, day = (int(part) for part in dotted.groups())
        return iso_date(year, month, day)
    return parse_schedule_month_end(text)


def normalize_apartment_schedule_name(value: Any) -> str:
    name = collapse_space(value)
    if name in {"입주예정일", "입주예정월"}:
        return "입주예정"
    return name


def append_schedule_note(existing: Any, note: str) -> str:
    current = collapse_space(existing)
    next_note = collapse_space(note)
    if not next_note:
        return current
    parts = [part for part in current.split(" | ") if part] if current else []
    if next_note not in parts:
        parts.append(next_note)
    return " | ".join(parts)


def is_contract_now_text(value: Any) -> bool:
    return collapse_space(value) == "계약시"


def is_contract_plus_one_month_text(value: Any) -> bool:
    return bool(CONTRACT_PLUS_ONE_MONTH_RE.fullmatch(collapse_space(value)))


def is_move_in_reference_text(value: Any) -> bool:
    text = collapse_space(value)
    return text == "입주지정일" or bool(MOVE_IN_REFERENCE_RE.fullmatch(text))


def is_same_month_range(start_value: Any, end_value: Any) -> bool:
    start_text = collapse_space(start_value)
    end_text = collapse_space(end_value)
    start_match = ISO_DATE_RE.fullmatch(start_text)
    end_match = ISO_DATE_RE.fullmatch(end_text)
    if not start_match or not end_match:
        return False
    start_year, start_month, start_day = (int(part) for part in start_match.groups())
    end_year, end_month, end_day = (int(part) for part in end_match.groups())
    return (
        start_year == end_year
        and start_month == end_month
        and start_day == 1
        and end_day == calendar.monthrange(end_year, end_month)[1]
    )


def build_address(parts: dict[str, Any]) -> str:
    pieces = [
        collapse_space(parts.get("시도")),
        collapse_space(parts.get("시군구")),
        collapse_space(parts.get("동읍면")),
        collapse_space(parts.get("통반리")),
        collapse_space(parts.get("지번")),
    ]
    return " ".join(piece for piece in pieces if piece)


def deterministic_short_id(source_url: str, prefix: str = "") -> str:
    digest = hashlib.sha1(source_url.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}{digest}" if prefix else digest


def column_index_to_letter(index: int) -> str:
    result = ""
    current = index
    while current:
        current, rem = divmod(current - 1, 26)
        result = chr(65 + rem) + result
    return result


def make_header_index(header: list[str]) -> dict[str, int]:
    return {name: idx for idx, name in enumerate(header)}


def get_sheet_value(row: list[Any], index: dict[str, int], key: str) -> str:
    column = index.get(key)
    if column is None or column >= len(row):
        return ""
    return normalize_text(row[column])


def read_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        return payload["results"]
    if isinstance(payload, list):
        return payload
    raise ValueError("Input JSON must be an array of rows or an object with a 'results' array")


def build_lookup_maps(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    payload = payload or {}
    return {
        "regions": dict(payload.get("regions") or {}),
        "users": dict(payload.get("users") or {}),
        "complexes": dict(payload.get("complexes") or {}),
        "buildings": dict(payload.get("buildings") or {}),
        "customers": dict(payload.get("customers") or {}),
    }


def resolve_lookup_entry(table: dict[str, Any], relation_value: Any) -> dict[str, Any]:
    for url in parse_json_array(relation_value):
        entry = table.get(url)
        if entry:
            return entry
    return {}


def resolve_lookup_name(table: dict[str, Any], relation_value: Any) -> str:
    values = []
    for url in parse_json_array(relation_value):
        entry = table.get(url)
        if isinstance(entry, dict):
            name = normalize_text(entry.get("이름") or entry.get("name") or entry.get("title"))
        else:
            name = normalize_text(entry)
        if name:
            values.append(name)
    return ", ".join(values)


def resolve_user_names(user_lookup: dict[str, Any], relation_value: Any) -> str:
    names: list[str] = []
    for user_key in parse_json_array(relation_value):
        name = normalize_text(user_lookup.get(user_key) or user_lookup.get(user_key.replace("user://", "")))
        if name:
            names.append(name)
    return ", ".join(names)


def base_row_from_region(region: dict[str, Any], jibun: Any) -> dict[str, Any]:
    return {
        "시도": collapse_space(region.get("시도")),
        "시군구": collapse_space(region.get("시군구")),
        "동읍면": collapse_space(region.get("동읍면")),
        "통반리": collapse_space(region.get("통반리")),
        "지번": collapse_space(jibun),
    }


def build_apartment_d_id(row: dict[str, Any]) -> str:
    prefix = safe_token(row.get("단지명축약") or row.get("단지명"))
    parts = [prefix, safe_token(row.get("동")), safe_token(row.get("호")), safe_token(row.get("타입"))]
    return "-".join(part for part in parts if part)


def build_house_d_id(row: dict[str, Any]) -> str:
    parts = [collapse_space(row.get("주택단지")), collapse_space(row.get("동")), collapse_space(row.get("호"))]
    return " ".join(part for part in parts if part)


def build_building_d_id(row: dict[str, Any]) -> str:
    return collapse_space(row.get("건물명"))


def build_store_d_id(row: dict[str, Any]) -> str:
    parts = [collapse_space(row.get("건물명")), collapse_space(row.get("호수")), collapse_space(row.get("거래유형"))]
    return "-".join(part for part in parts if part)


def build_room_d_id(row: dict[str, Any]) -> str:
    parts = [collapse_space(row.get("건물명")), collapse_space(row.get("호")), collapse_space(row.get("거래유형"))]
    return "-".join(part for part in parts if part)


def build_land_d_id(row: dict[str, Any]) -> str:
    location = collapse_space(row.get("통반리")) or collapse_space(row.get("동읍면")) or collapse_space(row.get("시군구"))
    parts = [
        location,
        collapse_space(row.get("지번")),
        collapse_space(row.get("용도지역")),
        collapse_space(row.get("지목")),
    ]
    return "-".join(part for part in parts if part)


def build_factory_d_id(row: dict[str, Any]) -> str:
    location = collapse_space(row.get("통반리")) or collapse_space(row.get("동읍면")) or collapse_space(row.get("시군구"))
    parts = [location, collapse_space(row.get("건축물용도") or row.get("용도")), collapse_space(row.get("명칭"))]
    return "-".join(part for part in parts if part)


def build_dataset_d_id(dataset: str, row: dict[str, Any]) -> str:
    if dataset == "apartment":
        return build_apartment_d_id(row)
    if dataset == "house":
        return build_house_d_id(row)
    if dataset == "building":
        return build_building_d_id(row)
    if dataset == "store":
        return build_store_d_id(row)
    if dataset == "room":
        return build_room_d_id(row)
    if dataset == "land":
        return build_land_d_id(row)
    if dataset == "factory":
        return build_factory_d_id(row)
    return ""


def normalize_apartment_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    complex_info = resolve_lookup_entry(lookups["complexes"], raw.get("단지명"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "단지명": collapse_space(complex_info.get("단지명") or raw.get("단지명")),
        "단지명축약": collapse_space(complex_info.get("단지명축약")),
        "단지ID": collapse_space(complex_info.get("단지ID")),
        "동": collapse_space(raw.get("동")),
        "호": collapse_space(raw.get("호")),
        "타입": collapse_space(raw.get("타입")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "거래상태": collapse_space(raw.get("거래상태")),
        "분양가": parse_number(raw.get("분양가")),
        "발코니": parse_number(raw.get("발코니확장비")),
        "옵션비": parse_number(raw.get("옵션비")),
        "프리미엄": parse_number(raw.get("프리미엄")),
        "합계": parse_number(raw.get("합계")),
        "매매가": parse_number(raw.get("매매가")),
        "전세가 ": parse_number(raw.get("전세가")),
        "보증금": parse_number(raw.get("보증금")),
        "월세": parse_number(raw.get("월세")),
        "관리비": parse_number(raw.get("관리비")),
        "매물설명": normalize_text(raw.get("상세설명") or raw.get("메모")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("고객DB")),
        "연락처": normalize_text(raw.get("부동산연락처")),
        "입주가능일": normalize_text(raw.get("date:입주가능일:start")),
        "입주가능협의여부": parse_bool_cell(raw.get("입주가능협의")),
        "방향": collapse_space(raw.get("방향")),
        "만기예정일": normalize_text(raw.get("date:만기예정일:start")),
        "접수자": resolve_user_names(lookups["users"], raw.get("접수자")),
        "접수일": normalize_text(raw.get("date:접수일:start")),
    }
    if complex_info:
        row.update(base_row_from_region(complex_info, complex_info.get("지번")))
        row["주소"] = build_address(row)
    return row


def normalize_apartment_complex_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    region = resolve_lookup_entry(lookups["regions"], raw.get("행정구역"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "단지명": collapse_space(raw.get("단지명")),
        "단지명축약": collapse_space(raw.get("축약단지명")),
        "총 세대수": parse_number(raw.get("총 세대 · 호수")),
        "공급세대수": parse_number(raw.get("공급세대수")),
        "임대 세대수": parse_number(raw.get("임대세대수")),
        "최고층": parse_number(raw.get("지상 최고층")),
        "최저층": parse_number(raw.get("최저층")),
        "지하층": parse_number(raw.get("지하층")),
        "사용승인일": normalize_text(raw.get("date:사용승인일:start")),
        "동수": parse_number(raw.get("총 동수")),
        "건폐율": parse_number(raw.get("건폐율")),
        "용적률": parse_number(raw.get("용적률")),
        "주차대수": parse_number(raw.get("주차대수")),
        "세대당 주차대수": parse_number(raw.get("세대당 주차대수")),
        "대지면적(㎡)": parse_number(raw.get("대지면적(㎡)")),
        "연면적(㎡)": parse_number(raw.get("연면적(㎡)")),
        "용산 연면적(㎡)": parse_number(raw.get("용산 연면적(㎡)")),
        "건축면적(㎡)": parse_number(raw.get("건축면적(㎡)")),
        "난방": join_json_values(raw.get("난방")),
        "용도지역": collapse_space(raw.get("용도지역")),
        "규제지역여부": collapse_space(raw.get("규제지역여부")),
        "거주의무기간": collapse_space(raw.get("거주의무기간")),
        "분양가상한제": collapse_space(raw.get("분양가상한제")),
        "재당첨제한": collapse_space(raw.get("재당첨제한")),
        "전매제한": collapse_space(raw.get("전매제한")),
        "택지유형": collapse_space(raw.get("택지유형")),
        "주택유형": collapse_space(raw.get("주택유형")),
        "해당지역": normalize_text(raw.get("해당지역")),
        "기타지역": normalize_text(raw.get("기타지역")),
        "시행사": normalize_text(raw.get("시행사")),
        "홈페이지": normalize_text(raw.get("홈페이지 or 네이버 부동산")),
        "단지코드": normalize_text(raw.get("단지코드(네이버)")),
        "시군구": collapse_space(raw.get("시군구")),
        "동읍면": collapse_space(raw.get("동읍면")),
        "통반리": collapse_space(raw.get("통반리")),
        "지번": collapse_space(raw.get("지번")),
    }
    fallback_region = base_row_from_region(region, raw.get("지번"))
    for key in ("시도", "시군구", "동읍면", "통반리", "지번"):
        if not collapse_space(row.get(key)):
            row[key] = collapse_space(fallback_region.get(key))
    complex_id = collapse_space(raw.get("단지ID"))
    if complex_id:
        row["단지ID"] = complex_id
    return row


def normalize_apartment_type_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    complex_info = resolve_lookup_entry(lookups["complexes"], raw.get("아파트단지(home)"))
    return {
        "__source_url": normalize_text(raw.get("url")),
        "단지명": collapse_space(complex_info.get("단지명")),
        "주택 관리번호": normalize_text(raw.get("주택 관리번호")),
        "모델": normalize_text(raw.get("모델")),
        "주택형(전용면적기준)": normalize_text(raw.get("주택형\n(전용면적기준)") or raw.get("주택형(전용면적기준)") or raw.get("주택형")),
        "약식표기": collapse_space(raw.get("약식표기")),
        "주거 전용면적": parse_number(raw.get("주거전용면적(㎡)")),
        "주거 공용면적": parse_number(raw.get("주거공용면적(㎡)")),
        "소계": parse_number(raw.get("[소계]공급면적(㎡)")),
        "기타 공용면적 (지하주차장등)": parse_number(raw.get("기타공용면적(㎡)")),
        "계약 면적": parse_number(raw.get("계약면적(㎡)")),
        "세대별 대지지분": parse_number(raw.get("세대별 대지지분")),
        "총공급 세대수": parse_number(raw.get("총 공급 세대수")),
        "기관 추천": parse_number(raw.get("기관추천")),
        "다자녀 가구": parse_number(raw.get("다자녀가구")),
        "신혼 부부": parse_number(raw.get("신혼부부")),
        "노부모 부양": parse_number(raw.get("노부모부양")),
        "생애 최초": parse_number(raw.get("생애최초")),
        "계": parse_number(raw.get("[계]특별공급")),
        "일반공급 세대수": parse_number(raw.get("일반공급")),
        "최하층 우선배정 세대수": parse_number(raw.get("최하층 우선배정")),
    }


def normalize_apartment_schedule_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    complex_info = resolve_lookup_entry(lookups["complexes"], raw.get("아파트단지"))
    return {
        "__source_url": normalize_text(raw.get("url")),
        "단지명": collapse_space(complex_info.get("단지명")),
        "일정명": collapse_space(raw.get("일정목록")),
        "시작일": normalize_text(raw.get("date:날짜:start")),
        "종료일": normalize_text(raw.get("date:날짜:end")),
        "비고": normalize_text(raw.get("description")),
    }


def apply_apartment_schedule_business_rules(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    grouped: dict[str, list[dict[str, Any]]] = {}

    for source_row in rows:
        row = dict(source_row)
        raw_name = collapse_space(row.get("일정명"))
        raw_start = normalize_text(row.get("시작일"))
        raw_end = normalize_text(row.get("종료일"))
        row["일정명"] = normalize_apartment_schedule_name(raw_name)

        parsed_start = parse_schedule_date(raw_start)
        parsed_end = parse_schedule_date(raw_end)
        row["시작일"] = parsed_start or ""
        row["종료일"] = parsed_end or ""
        row["비고"] = collapse_space(row.get("비고"))
        row["__raw_name"] = raw_name
        row["__raw_start"] = raw_start
        row["__raw_end"] = raw_end
        prepared.append(row)
        grouped.setdefault(collapse_space(row.get("단지명")), []).append(row)

    for complex_name, group in grouped.items():
        if not complex_name:
            continue

        contract_row = next(
            (row for row in group if collapse_space(row.get("일정명")) == "계약체결" and collapse_space(row.get("시작일"))),
            None,
        )

        occupancy_date = ""
        for row in group:
            if collapse_space(row.get("일정명")) != "입주예정":
                continue
            if is_same_month_range(row.get("시작일"), row.get("종료일")):
                occupancy_date = collapse_space(row.get("종료일"))
            else:
                occupancy_date = collapse_space(row.get("종료일")) or collapse_space(row.get("시작일"))
            if occupancy_date:
                break

        for row in group:
            raw_name = collapse_space(row.pop("__raw_name", ""))
            raw_start = normalize_text(row.pop("__raw_start", ""))
            raw_end = normalize_text(row.pop("__raw_end", ""))

            if row.get("일정명") == "입주예정":
                month_end = parse_schedule_month_end(raw_start) or parse_schedule_month_end(raw_end)
                if not month_end and is_same_month_range(row.get("시작일"), row.get("종료일")):
                    month_end = collapse_space(row.get("종료일"))
                if month_end:
                    row["시작일"] = month_end
                    row["종료일"] = month_end
                    occupancy_date = month_end
                elif occupancy_date and not row.get("시작일"):
                    row["시작일"] = occupancy_date
                    row["종료일"] = occupancy_date

            if is_contract_now_text(raw_start) or is_contract_now_text(raw_end):
                row["비고"] = append_schedule_note(row.get("비고"), "계약시")
                if contract_row:
                    row["시작일"] = collapse_space(contract_row.get("시작일"))
                    row["종료일"] = collapse_space(contract_row.get("종료일")) or row["시작일"]
                continue

            if is_contract_plus_one_month_text(raw_start) or is_contract_plus_one_month_text(raw_end):
                note = raw_start if is_contract_plus_one_month_text(raw_start) else raw_end
                row["비고"] = append_schedule_note(row.get("비고"), note)
                if contract_row:
                    contract_start = collapse_space(contract_row.get("시작일"))
                    contract_end = collapse_space(contract_row.get("종료일")) or contract_start
                    row["시작일"] = shift_iso_date_by_months(contract_start, 1)
                    row["종료일"] = shift_iso_date_by_months(contract_end, 1) or row["시작일"]
                continue

            if is_move_in_reference_text(raw_start) or is_move_in_reference_text(raw_end):
                note = raw_start if is_move_in_reference_text(raw_start) else raw_end
                row["비고"] = append_schedule_note(row.get("비고"), note)
                if occupancy_date:
                    row["시작일"] = occupancy_date
                    row["종료일"] = occupancy_date
                continue

            if raw_name in {"입주예정일", "입주예정월"} and collapse_space(row.get("시작일")) and not collapse_space(row.get("종료일")):
                row["종료일"] = collapse_space(row.get("시작일"))

    return prepared


def normalize_house_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    region = resolve_lookup_entry(lookups["regions"], raw.get("행정구역"))
    intake_user_value = raw.get("접수자")
    if not parse_json_array(intake_user_value):
        intake_user_value = raw.get("Owner")
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "주택단지": collapse_space(raw.get("주택단지명")),
        "동": collapse_space(raw.get("동")),
        "호": collapse_space(raw.get("호수")),
        "타입": collapse_space(raw.get("타입")),
        "주택유형": collapse_space(raw.get("주택유형")),
        "주구조": join_json_values(raw.get("건축구조")),
        "상태": collapse_space(raw.get("거래현황")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "매매가": parse_number(raw.get("매매가")),
        "전세가": parse_number(raw.get("전세가")),
        "월세보증금": parse_number(raw.get("보증금")),
        "월세": parse_number(raw.get("임대료")),
        "입주 가능일": normalize_text(raw.get("date:입주가능일:start")),
        "입주협의가능여부": parse_bool_cell(raw.get("입주협의가능여부")),
        "방향": collapse_space(raw.get("방향")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("👥 고객DB")),
        "임대인 연락처": normalize_text(raw.get("연락처")),
        "접수자": resolve_user_names(lookups["users"], intake_user_value),
        "접수일": normalize_text(raw.get("date:접수일:start")),
        "메모": normalize_text(raw.get("메모")),
        "방 개수": parse_number(raw.get("방개수")),
        "욕실 개수": parse_number(raw.get("욕실개수")),
        "사용승인": normalize_text(raw.get("date:사용승인일:start")),
        "난방연료": collapse_space(raw.get("난방연료")),
        "세대비번": normalize_text(raw.get("세대비번")),
    }
    row.update(base_row_from_region(region, raw.get("지번")))
    row["주소"] = build_address(row)
    return row


def normalize_building_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    region = resolve_lookup_entry(lookups["regions"], raw.get("행정구역"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "건물명": collapse_space(raw.get("userDefined:ID") or raw.get("ID")),
        "신주소": normalize_text(raw.get("신주소")),
        "통매매": parse_bool_cell(raw.get("건물매매")),
        "용도지역": collapse_space(raw.get("용도지역")),
        "건물유형": collapse_space(raw.get("건물유형")),
        "주용도": join_json_values(raw.get("주용도")),
        "건축구조": join_json_values(raw.get("건축구조")),
        "대지면적(㎡)": parse_number(raw.get("㎡-대지면적")),
        "연면적(㎡)": parse_number(raw.get("㎡-연면적")),
        "용산 연면적(㎡)": parse_number(raw.get("㎡-용적률산정용")),
        "건축면적(㎡)": parse_number(raw.get("㎡-건축면적")),
        "건폐율": parse_number(raw.get("건폐율")),
        "용적률": parse_number(raw.get("용적률")),
        "지상층": parse_number(raw.get("지상층")),
        "지하층": parse_number(raw.get("지하층")),
        "세대 · 호수": collapse_space(raw.get("가구수")) or collapse_space(raw.get("호수")),
        "주차대수": parse_number(raw.get("주차대수")),
        "세대당 주차대수": parse_number(raw.get("세대당 주차대수")),
        "사용승인": normalize_text(raw.get("date:사용승인:start")),
        "승강기": collapse_space(raw.get("승강기")),
        "공동현관비번": normalize_text(raw.get("공동현관비번")),
        "건물사진": join_json_values(raw.get("건물사진")),
        "메모": normalize_text(raw.get("메모")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("임대인")),
        "임대인 연락처": normalize_text(raw.get("소유자 연락처")),
        "매매가": parse_number(raw.get("매매가")),
        "보증금": parse_number(raw.get("보증금")),
        "임대료": parse_number(raw.get("임대료")),
        "대출금액": parse_number(raw.get("대출")),
        "금리": parse_number(raw.get("금리 (%)")),
        "대출비율": parse_number(raw.get("대출 (%)")),
        "월이자": parse_number(raw.get("월이자")),
        "연이자": parse_number(raw.get("연이자")),
        "실투자금": parse_number(raw.get("실투자금")),
        "월수익": parse_number(raw.get("월수익")),
        "연수익": parse_number(raw.get("연수익")),
        "월순수익": parse_number(raw.get("월순수익")),
        "연순수익": parse_number(raw.get("연순수익")),
        "수익률": normalize_text(raw.get("수익률")),
        "상가": join_json_values(raw.get("상가")),
        "원투룸": join_json_values(raw.get("원투룸 오피")),
    }
    row.update(base_row_from_region(region, raw.get("지번")))
    row["주소"] = build_address(row)
    return row


def normalize_store_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    building = resolve_lookup_entry(lookups["buildings"], raw.get("건물명"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "건물명": collapse_space(building.get("건물명")),
        "호수": collapse_space(raw.get("호실")),
        "상호명": normalize_text(raw.get("상호명")),
        "접수자": resolve_user_names(lookups["users"], raw.get("접수자")),
        "접수일": normalize_text(raw.get("date:접수일:start")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "상태": collapse_space(raw.get("거래현황")),
        "보증금": parse_number(raw.get("보증금")),
        "임대료": parse_number(raw.get("임대료")),
        "부가세": collapse_space(raw.get("임대료 부가세포함 여부")),
        "임대료 + 부가세": parse_number(raw.get("임대료 + 부가세")),
        "관리비": parse_number(raw.get("관리비")),
        "권리금": parse_number(raw.get("권리금")),
        "전용면적(㎡)": parse_number(raw.get("㎡-전용")),
        "전용면적(평)": parse_number(raw.get("전용면적(평)")),
        "공용면적(㎡)": parse_number(raw.get("공용면적(㎡)")),
        "계약면적(㎡)": parse_number(raw.get("계약면적")),
        "계약면적(평)": parse_number(raw.get("계약면적(평)")),
        "공실여부": collapse_space(raw.get("입점현황")),
        "임대차만료": normalize_text(raw.get("date:입주일(임차만료예정일):start")),
        "방향": collapse_space(raw.get("방향")),
        "희망업종": join_json_values(raw.get("희망업종(추천업종 소분류)")),
        "불가업종": join_json_values(raw.get("불가업종")),
        "메모": normalize_text(raw.get("메모")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("고객")),
    }
    if building:
        row.update(
            {
                "주소": build_address(building),
                "시도": collapse_space(building.get("시도")),
                "시군구": collapse_space(building.get("시군구")),
                "동읍면": collapse_space(building.get("동읍면")),
                "통반리": collapse_space(building.get("통반리")),
                "지번": collapse_space(building.get("지번")),
            }
        )
    return row


def normalize_room_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    building = resolve_lookup_entry(lookups["buildings"], raw.get("건물명"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "건물명": collapse_space(building.get("건물명")),
        "호": collapse_space(raw.get("호")),
        "상태": collapse_space(raw.get("거래현황")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "방구조": collapse_space(raw.get("방구조")),
        "매매가": parse_number(raw.get("매매가")),
        "전세가": parse_number(raw.get("전세가")),
        "보증금": parse_number(raw.get("보증금")),
        "임대료": parse_number(raw.get("임대료")),
        "입주 가능일": normalize_text(raw.get("date:입주가능일:start")),
        "입주협의가능여부": parse_bool_cell(raw.get("입주협의가능여부")),
        "반려동물": join_json_values(raw.get("방 정보")),
        "해당층": normalize_text(raw.get("해당층")),
        "방향": collapse_space(raw.get("방향")),
        "욕실 개수": parse_number(raw.get("욕실 개수")),
        "복층": "TRUE" if collapse_space(raw.get("복층여부")) == "복층" else "FALSE",
        "거주상태": collapse_space(raw.get("거주상태")),
        "세대비번": normalize_text(raw.get("세대비번")),
        "메모": normalize_text(raw.get("비공개 메모")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("고객연결")),
        "임대인 연락처": normalize_text(raw.get("임대인 연락처")),
    }
    if building:
        row.update(
            {
                "주소": build_address(building),
                "시도": collapse_space(building.get("시도")),
                "시군구": collapse_space(building.get("시군구")),
                "동읍면": collapse_space(building.get("동읍면")),
                "통반리": collapse_space(building.get("통반리")),
                "지번": collapse_space(building.get("지번")),
            }
        )
    return row


def normalize_land_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    region = resolve_lookup_entry(lookups["regions"], raw.get("행정구역"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "관계지번": "",
        "토지분류": join_json_values(raw.get("토지분류")),
        "용도지역": join_json_values(raw.get("용도지역")),
        "지목": join_json_values(raw.get("지목")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "상태": collapse_space(raw.get("거래현황")),
        "평단가": parse_number(raw.get("평단가")),
        "매매가": parse_number(raw.get("매매가")),
        "보증금": parse_number(raw.get("보증금")),
        "임대료": parse_number(raw.get("임대료")),
        "대지면적(㎡)": parse_number(raw.get("대지면적(㎡)")),
        "메모": normalize_text(raw.get("메모")),
        "접수일": normalize_text(raw.get("date:접수일:start")),
        "담당자": resolve_user_names(lookups["users"], raw.get("담당자")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("고객")),
        "소유자 연락처": normalize_text(raw.get("소유자 연락처")),
    }
    row.update(base_row_from_region(region, raw.get("지번")))
    row["주소"] = build_address(row)
    return row


def normalize_factory_row(raw: dict[str, Any], lookups: dict[str, dict[str, Any]]) -> dict[str, Any]:
    region = resolve_lookup_entry(lookups["regions"], raw.get("행정구역"))
    row = {
        "__source_url": normalize_text(raw.get("url")),
        "명칭": collapse_space(raw.get("매물명")),
        "상태": collapse_space(raw.get("거래현황")),
        "용도지역": collapse_space(raw.get("용도지역")),
        "지목": collapse_space(raw.get("지목")),
        "건축물용도": collapse_space(raw.get("용도")),
        "거래유형": join_json_values(raw.get("거래유형")),
        "담당자": resolve_user_names(lookups["users"], raw.get("담당자")),
        "접수일": normalize_text(raw.get("date:접수일:start")),
        "평단가": parse_number(raw.get("평단가")),
        "매매가": parse_number(raw.get("매매가")),
        "전세가": parse_number(raw.get("전세가")),
        "보증금": parse_number(raw.get("보증금")),
        "임대료": parse_number(raw.get("임대료")),
        "개별공시지가": parse_number(raw.get("개별공시지가(㎡)")),
        "대지면적(㎡)": parse_number(raw.get("대지면적(㎡)")),
        "연면적(㎡)": parse_number(raw.get("연면적(㎡)")),
        "사용승인일": normalize_text(raw.get("date:사용승인일:start")),
        "호이스트": join_json_values(raw.get("호이스트")),
        "전력량(Kw)": join_json_values(raw.get("전력")),
        "고객": resolve_lookup_name(lookups["customers"], raw.get("매도임대인")),
        "메모": normalize_text(raw.get("메모")),
        "임대인 연락처": "",
        "임차인 연락처": "",
    }
    row.update(base_row_from_region(region, raw.get("지번")))
    row["주소"] = build_address(row)
    return row


RAW_NORMALIZERS = {
    "apartment": normalize_apartment_row,
    "apartment_complex": normalize_apartment_complex_row,
    "apartment_type": normalize_apartment_type_row,
    "apartment_schedule": normalize_apartment_schedule_row,
    "house": normalize_house_row,
    "building": normalize_building_row,
    "store": normalize_store_row,
    "room": normalize_room_row,
    "land": normalize_land_row,
    "factory": normalize_factory_row,
}


def normalize_input_rows(
    dataset: str,
    input_mode: str,
    rows: list[dict[str, Any]],
    lookups: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if input_mode == "normalized":
        normalized: list[dict[str, Any]] = []
        for row in rows:
            copied = dict(row)
            copied["__source_url"] = normalize_text(copied.get("__source_url") or copied.get("url"))
            normalized.append(copied)
        if dataset == "apartment_schedule":
            return apply_apartment_schedule_business_rules(normalized)
        return normalized
    normalizer = RAW_NORMALIZERS.get(dataset)
    if not normalizer:
        raise ValueError(f"Unsupported raw dataset: {dataset}")
    normalized = [normalizer(row, lookups) for row in rows]
    if dataset == "apartment_schedule":
        return apply_apartment_schedule_business_rules(normalized)
    return normalized


def build_natural_keys(dataset: str, row_dict: dict[str, Any]) -> list[str]:
    def pack(*keys: str) -> str:
        return "|".join(collapse_space(row_dict.get(key)) for key in keys)

    if dataset == "apartment":
        return [pack("단지명", "동", "호", "타입", "거래유형")]
    if dataset == "apartment_complex":
        return [pack("단지명")]
    if dataset == "apartment_type":
        return [pack("단지명", "약식표기")]
    if dataset == "apartment_schedule":
        return [pack("단지명", "일정명", "시작일")]
    if dataset == "house":
        return [pack("시군구", "동읍면", "통반리", "지번", "주택단지", "동", "호", "거래유형")]
    if dataset == "building":
        return [pack("건물명", "지번", "신주소")]
    if dataset == "store":
        keys = [
            pack("건물명", "호수", "거래유형"),
            pack("건물명", "호수"),
        ]
        return [key for key in keys if key]
    if dataset == "room":
        return [pack("건물명", "호", "거래유형")]
    if dataset == "land":
        keys = [
            pack("시군구", "동읍면", "통반리", "지번", "토지분류", "거래유형"),
            pack("시군구", "동읍면", "통반리", "지번", "토지분류"),
            pack("시군구", "동읍면", "통반리", "지번", "용도지역", "지목"),
        ]
        return [key for key in keys if key]
    if dataset == "factory":
        keys = [
            pack("시군구", "동읍면", "통반리", "지번", "명칭", "거래유형"),
            pack("시군구", "동읍면", "통반리", "지번", "건축물용도", "거래유형"),
            pack("시군구", "동읍면", "통반리", "지번", "건축물용도"),
        ]
        return [key for key in keys if key]
    return []


def row_dict_from_sheet(header: list[str], row: list[Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for idx, name in enumerate(header):
        result[name] = normalize_text(row[idx]) if idx < len(row) else ""
    return result


def fill_identity_fields(dataset: str, config: DatasetConfig, row: dict[str, Any]) -> None:
    source_url = normalize_text(row.get("__source_url"))
    if not normalize_text(row.get("ID")) and source_url:
        row["ID"] = deterministic_short_id(source_url)
    if config.d_id_column and not normalize_text(row.get(config.d_id_column)):
        row[config.d_id_column] = build_dataset_d_id(dataset, row)


def build_update_row(
    header: list[str],
    existing_row: list[Any] | None,
    incoming_row: dict[str, Any],
    config: DatasetConfig,
) -> list[Any]:
    base = list(existing_row) if existing_row is not None else []
    while len(base) < len(header):
        base.append("")
    index = make_header_index(header)
    for key, value in incoming_row.items():
        if key.startswith("__"):
            continue
        column = index.get(key)
        if column is None:
            continue
        if key == "ID" and normalize_text(base[column]):
            continue
        if key == config.d_id_column and config.d_id_column and normalize_text(base[column]):
            continue
        if (
            existing_row is not None
            and key in PROTECTED_BLANK_PRESERVE_COLUMNS
            and normalize_text(value) == ""
            and normalize_text(base[column])
        ):
            continue
        base[column] = value
    return base[: len(header)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, choices=sorted(DATASET_CONFIGS))
    parser.add_argument("--input", required=True, help="Path to a JSON file containing rows or {results:[...]}")
    parser.add_argument(
        "--input-mode",
        default="raw",
        choices=["raw", "normalized"],
        help="raw: Notion query result rows, normalized: sheet-header dictionaries",
    )
    parser.add_argument("--lookup", help="Optional lookup JSON file for regions/users/buildings/complexes/customers")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = DATASET_CONFIGS[args.dataset]
    rows_payload = read_json_file(Path(args.input))
    rows = load_rows(rows_payload)
    lookup_payload = read_json_file(Path(args.lookup)) if args.lookup else None
    lookups = build_lookup_maps(lookup_payload)
    normalized_rows = normalize_input_rows(args.dataset, args.input_mode, rows, lookups)

    client = GoogleApiClient()
    sheet_rows = client.get_sheet_values(config.spreadsheet_id, config.sheet_name)
    if not sheet_rows:
        raise RuntimeError(f"Target sheet is empty: {config.sheet_name}")

    header = [normalize_text(value) for value in sheet_rows[0]]
    existing_rows = sheet_rows[1:]
    header_index = make_header_index(header)
    last_column_letter = column_index_to_letter(len(header))

    id_to_row_number: dict[str, int] = {}
    natural_to_row_number: dict[str, int] = {}
    for row_number, row in enumerate(existing_rows, start=2):
        row_dict = row_dict_from_sheet(header, row)
        row_id = collapse_space(row_dict.get("ID"))
        if row_id:
            id_to_row_number[row_id] = row_number
        for natural_key in build_natural_keys(args.dataset, row_dict):
            if natural_key:
                natural_to_row_number.setdefault(natural_key, row_number)

    updates: list[dict[str, Any]] = []
    pending_rows: dict[int, list[Any]] = {}
    matched = 0
    appended = 0
    next_row_number = len(existing_rows) + 2

    for row in normalized_rows:
        fill_identity_fields(args.dataset, config, row)
        row_id = collapse_space(row.get("ID"))
        natural_keys = build_natural_keys(args.dataset, row)

        row_number = id_to_row_number.get(row_id)
        if row_number is None:
            for natural_key in natural_keys:
                row_number = natural_to_row_number.get(natural_key)
                if row_number is not None:
                    break

        existing_row = None
        if row_number is not None:
            matched += 1
            existing_index = row_number - 2
            if existing_index < len(existing_rows):
                existing_row = existing_rows[existing_index]
            else:
                existing_row = pending_rows.get(row_number)
        else:
            appended += 1
            row_number = next_row_number
            next_row_number += 1
            if row_id:
                id_to_row_number[row_id] = row_number
            for natural_key in natural_keys:
                if natural_key:
                    natural_to_row_number.setdefault(natural_key, row_number)

        values = build_update_row(header, existing_row, row, config)
        pending_rows[row_number] = values
        updates.append(
            {
                "range": f"{config.sheet_name}!A{row_number}:{last_column_letter}{row_number}",
                "majorDimension": "ROWS",
                "values": [values],
            }
        )

    if not args.dry_run:
        client.ensure_sheet_grid(config.spreadsheet_id, config.sheet_name, next_row_number - 1, len(header))
        client.batch_update_values(config.spreadsheet_id, updates)

    summary = {
        "dataset": args.dataset,
        "sheet": config.sheet_name,
        "input_rows": len(normalized_rows),
        "matched": matched,
        "appended": appended,
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
