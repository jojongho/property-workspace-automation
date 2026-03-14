#!/usr/bin/env python3
"""Utilities for normalized pricing rows and unit-level expansion."""

from __future__ import annotations

import re
from typing import Iterable


OPEN_ENDED_FLOOR_MAX = 999

PRICING_NUMERIC_FIELDS = (
    "대지비",
    "건축비",
    "부가가치세",
    "분양가",
    "1차계약금",
    "2차계약금",
    "중도금1회",
    "중도금2회",
    "중도금3회",
    "중도금4회",
    "중도금5회",
    "중도금6회",
    "잔금",
)

NORMALIZED_PRICING_COLUMNS = (
    "단지명",
    "타입",
    "동별(라인별)",
    "공급세대수",
    "층구분",
    "해당세대수",
    "최저층",
    "최고층",
    *PRICING_NUMERIC_FIELDS,
)


def _safe_int(value) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)

    text = re.sub(r"[^\d-]", "", str(value))
    if not text or text == "-":
        return 0

    try:
        return int(text)
    except ValueError:
        return 0


def _normalize_type(type_name) -> str:
    if type_name is None:
        return "Unknown"
    text = str(type_name).strip()
    return text or "Unknown"


def _coalesce_text(item: dict, *keys: str, default: str = "") -> str:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def _coalesce_numeric(item: dict, *keys: str) -> int:
    for key in keys:
        if key in item and item.get(key) not in (None, ""):
            return _safe_int(item.get(key))
    return 0


def parse_floor_ranges(floor_text) -> list[tuple[int, int]]:
    """Parse floor text into inclusive floor ranges."""
    if floor_text is None:
        return [(1, 1)]

    text = str(floor_text).strip()
    if not text:
        return [(1, 1)]

    cleaned = (
        text.replace(" ", "")
        .replace("층", "")
        .replace("∼", "~")
        .replace("〜", "~")
        .replace("～", "~")
        .replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
    )
    parts = re.split(r"[，,]", cleaned)
    ranges: list[tuple[int, int]] = []

    for raw_part in parts:
        part = raw_part.strip()
        if not part:
            continue

        if "이상" in part:
            start = _safe_int(part.replace("이상", ""))
            if start:
                ranges.append((start, OPEN_ENDED_FLOOR_MAX))
            continue

        range_match = re.match(r"^(\d+)\s*[~-]\s*(\d+)$", part)
        if range_match:
            start, end = map(int, range_match.groups())
            if start > end:
                start, end = end, start
            ranges.append((start, end))
            continue

        numbers = re.findall(r"\d+", part)
        if len(numbers) == 1:
            floor = int(numbers[0])
            ranges.append((floor, floor))
            continue

        if len(numbers) >= 2:
            start = int(numbers[0])
            end = int(numbers[-1])
            if start > end:
                start, end = end, start
            ranges.append((start, end))

    return ranges or [(1, 1)]


def normalize_pricing_rows(apartment_name: str, pricing_items: list[dict]) -> list[dict]:
    """Normalize pricing rows into a stable schema."""
    deduped: dict[tuple[str, str, str, str], dict] = {}

    for item in pricing_items or []:
        floor_text = _coalesce_text(item, "층구분", "층")
        ranges = parse_floor_ranges(floor_text)
        min_floor = min(start for start, _ in ranges)
        max_floor = max(end for _, end in ranges)
        normalized = {
            "단지명": _coalesce_text(item, "단지명", default=apartment_name),
            "타입": _normalize_type(_coalesce_text(item, "타입", "주택형")),
            "동별(라인별)": _coalesce_text(item, "동별(라인별)", "라인그룹"),
            "공급세대수": _coalesce_numeric(item, "공급세대수"),
            "층구분": floor_text,
            "해당세대수": _coalesce_numeric(item, "해당세대수"),
            "최저층": min_floor,
            "최고층": max_floor,
            "대지비": _coalesce_numeric(item, "대지비"),
            "건축비": _coalesce_numeric(item, "건축비"),
            "부가가치세": _coalesce_numeric(item, "부가가치세", "부가세"),
            "분양가": _coalesce_numeric(item, "분양가", "분양가(합계)", "계", "합계"),
            "1차계약금": _coalesce_numeric(item, "1차계약금", "1차 계약금", "1차"),
            "2차계약금": _coalesce_numeric(item, "2차계약금", "2차 계약금", "2차"),
            "중도금1회": _coalesce_numeric(item, "중도금1회", "중도금 1회", "중도금1", "중도금 1", "1회(10%)"),
            "중도금2회": _coalesce_numeric(item, "중도금2회", "중도금 2회", "중도금2", "중도금 2", "2회(20%)"),
            "중도금3회": _coalesce_numeric(item, "중도금3회", "중도금 3회", "중도금3", "중도금 3", "3회(30%)"),
            "중도금4회": _coalesce_numeric(item, "중도금4회", "중도금 4회", "중도금4", "중도금 4", "4회(40%)"),
            "중도금5회": _coalesce_numeric(item, "중도금5회", "중도금 5회", "중도금5", "중도금 5", "5회(50%)"),
            "중도금6회": _coalesce_numeric(item, "중도금6회", "중도금 6회", "중도금6", "중도금 6", "6회(60%)"),
            "잔금": _coalesce_numeric(item, "잔금", "잔금(30%)"),
        }
        key = (
            normalized["단지명"],
            normalized["타입"],
            normalized["동별(라인별)"],
            normalized["층구분"],
        )
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = normalized
            continue

        for column in NORMALIZED_PRICING_COLUMNS:
            if column in ("단지명", "타입", "동별(라인별)", "층구분"):
                if not existing[column] and normalized[column]:
                    existing[column] = normalized[column]
                continue
            if existing[column] == 0 and normalized[column] != 0:
                existing[column] = normalized[column]

    return list(deduped.values())


def _parse_int_list(value) -> list[int]:
    if value in (None, ""):
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, (list, tuple, set)):
        values: list[int] = []
        for item in value:
            values.extend(_parse_int_list(item))
        return values

    text = str(value).replace(" ", "").replace("층", "").replace("호", "").replace("라인", "")
    parts = re.split(r"[，,]", text)
    values: list[int] = []
    for part in parts:
        if not part:
            continue
        range_match = re.match(r"^(\d+)\s*[~-]\s*(\d+)$", part)
        if range_match:
            start, end = map(int, range_match.groups())
            if start > end:
                start, end = end, start
            values.extend(range(start, end + 1))
            continue
        number = _safe_int(part)
        if number:
            values.append(number)
    return values


def _build_pricing_lookup(normalized_rows: list[dict]) -> dict[str, list[tuple[list[tuple[int, int]], dict]]]:
    lookup: dict[str, list[tuple[list[tuple[int, int]], dict]]] = {}
    for row in normalized_rows:
        type_name = _normalize_type(row.get("타입"))
        lookup.setdefault(type_name, []).append((parse_floor_ranges(row.get("층구분")), row))
    return lookup


def _line_group_matches(line_group: str, dong: str, line: int) -> bool:
    if not line_group:
        return True
    compact = re.sub(r"\s+", "", line_group)
    return f"{dong}동{line}호" in compact


def _match_pricing_row(
    pricing_lookup: dict[str, list[tuple[list[tuple[int, int]], dict]]],
    type_name: str,
    floor: int,
    dong: str,
    line: int,
):
    matches: list[tuple[int, int, int, dict]] = []
    for index, (ranges, row) in enumerate(pricing_lookup.get(type_name, [])):
        for start, end in ranges:
            if start <= floor <= end:
                line_group = str(row.get("동별(라인별)", "")).strip()
                if line_group and not _line_group_matches(line_group, dong, line):
                    continue
                specificity = 0 if line_group else 1
                matches.append((specificity, end - start, index, row))
                break
    if not matches:
        return None
    matches.sort(key=lambda item: (item[0], item[1], item[2]))
    return matches[0][3]


def _iter_lines(raw_lines) -> Iterable[int]:
    for line in _parse_int_list(raw_lines):
        if line > 0:
            yield line


def expand_to_unit_rows(layout_data: list[dict], normalized_rows: list[dict]) -> list[dict]:
    """Expand normalized pricing rows into unit-level rows for AppSheet use."""
    pricing_lookup = _build_pricing_lookup(normalized_rows)
    default_apartment_name = normalized_rows[0]["단지명"] if normalized_rows else ""
    unit_rows: list[dict] = []

    for item in layout_data or []:
        dong = str(item.get("동", "")).replace("동", "").strip()
        type_name = _normalize_type(item.get("타입"))
        max_floor = _safe_int(item.get("최고층"))
        if max_floor <= 0:
            continue

        excluded_floors = set(_parse_int_list(item.get("제외층") or item.get("필로티")))
        lines = list(_iter_lines(item.get("라인")))
        if not lines:
            continue

        for line in lines:
            for floor in range(1, max_floor + 1):
                if floor in excluded_floors:
                    continue

                matched = _match_pricing_row(pricing_lookup, type_name, floor, dong, line)
                row = {
                    "단지명": matched.get("단지명", default_apartment_name) if matched else default_apartment_name,
                    "동": dong,
                    "호": floor * 100 + line,
                    "타입": type_name,
                    "층": floor,
                    "라인": line,
                    "동별(라인별)": matched.get("동별(라인별)", "") if matched else "",
                    "공급세대수": matched.get("공급세대수", 0) if matched else 0,
                    "층구분": matched.get("층구분", "") if matched else "",
                    "해당세대수": matched.get("해당세대수", 0) if matched else 0,
                    "최저층": matched.get("최저층", 0) if matched else 0,
                    "최고층": matched.get("최고층", 0) if matched else 0,
                }
                for column in PRICING_NUMERIC_FIELDS:
                    row[column] = matched.get(column, 0) if matched else 0
                row["합계"] = row["분양가"]
                unit_rows.append(row)

    return unit_rows
