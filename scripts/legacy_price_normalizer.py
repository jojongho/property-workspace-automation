#!/usr/bin/env python3
"""Normalize legacy unit-level price sheets into grouped price rows."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from apartment_price_normalizer import NORMALIZED_PRICING_COLUMNS, PRICING_NUMERIC_FIELDS


NUMERIC_FIELDS = tuple(PRICING_NUMERIC_FIELDS)


@dataclass(frozen=True)
class LayoutRow:
    dong: str
    line: int
    type_name: str
    min_floor: int
    max_floor: int
    line_unit_count: int


@dataclass(frozen=True)
class LegacyPriceRow:
    dong: str
    unit_no: int
    type_name: str
    price_fields: tuple[int, ...]

    def price_vector(self) -> tuple[int, ...]:
        return self.price_fields


@dataclass(frozen=True)
class AtomicPricedUnit:
    complex_name: str
    dong: str
    line: int
    unit_no: int
    floor: int
    type_name: str
    price_fields: tuple[int, ...]

    def price_vector(self) -> tuple[int, ...]:
        return self.price_fields


@dataclass(frozen=True)
class NormalizedPricingRow:
    values: dict[str, int | str]

    def as_row(self, header_order: Iterable[str] | None = None) -> dict[str, int | str]:
        if header_order is None:
            return dict(self.values)
        return {header: self.values.get(header, "") for header in header_order}


@dataclass(frozen=True)
class UnmatchedPriceRow:
    dong: str
    unit_no: int
    line: int
    floor: int
    type_name: str
    reason: str


def parse_layout_rows(rows: list[list[str]]) -> list[LayoutRow]:
    if not rows:
        return []

    header = rows[0]
    dong_indexes = [index for index, value in enumerate(header) if value.strip() == "동"]
    if not dong_indexes:
        return []

    actual_dong_index = dong_indexes[1] if len(dong_indexes) >= 2 else dong_indexes[0]
    line_index = _first_index(header, "호")
    type_index = _first_index(header, "타입")
    min_floor_index = _first_index(header, "최하층")
    max_floor_index = _first_index(header, "최고층")
    line_unit_count_index = _first_index(header, "라인당세대")

    if None in (line_index, type_index, min_floor_index, max_floor_index, line_unit_count_index):
        return []

    parsed: dict[tuple[str, int], LayoutRow] = {}
    last_dong = ""

    for row in rows[1:]:
        if not any(cell.strip() for cell in row):
            continue

        dong = _cell(row, actual_dong_index) or last_dong
        last_dong = dong or last_dong
        line = _safe_int(_cell(row, line_index))
        type_name = _normalize_type(_cell(row, type_index))
        min_floor = _safe_int(_cell(row, min_floor_index))
        max_floor = _safe_int(_cell(row, max_floor_index))
        line_unit_count = _safe_int(_cell(row, line_unit_count_index))

        if not dong or line <= 0 or not type_name or min_floor <= 0 or max_floor <= 0:
            continue

        key = (_normalize_dong(dong), line)
        candidate = LayoutRow(
            dong=_normalize_dong(dong),
            line=line,
            type_name=type_name,
            min_floor=min_floor,
            max_floor=max_floor,
            line_unit_count=line_unit_count,
        )
        existing = parsed.get(key)
        if existing is None or _layout_quality(candidate) > _layout_quality(existing):
            parsed[key] = candidate

    return list(parsed.values())


def parse_legacy_price_rows(rows: list[list[str]]) -> list[LegacyPriceRow]:
    if len(rows) < 2:
        return []

    parsed: dict[tuple[str, int], LegacyPriceRow] = {}
    for row in rows[1:]:
        if len(row) < 3 or not any(cell.strip() for cell in row):
            continue

        dong = _normalize_dong(_cell(row, 0))
        unit_no = _safe_int(_cell(row, 1))
        type_name = _normalize_type(_cell(row, 2))
        if not dong or unit_no <= 0:
            continue

        numeric_fields = tuple(_safe_int(_cell(row, index)) for index in range(3, 16))
        if not any(numeric_fields):
            continue

        candidate = LegacyPriceRow(
            dong=dong,
            unit_no=unit_no,
            type_name=type_name,
            price_fields=numeric_fields,
        )
        key = (dong, unit_no)
        existing = parsed.get(key)
        if existing is None or _price_row_quality(candidate) > _price_row_quality(existing):
            parsed[key] = candidate

    return list(parsed.values())


def build_atomic_priced_units(
    complex_name: str,
    layout_rows: list[LayoutRow],
    price_rows: list[LegacyPriceRow],
) -> tuple[list[AtomicPricedUnit], list[UnmatchedPriceRow]]:
    if not layout_rows or not price_rows:
        return [], []

    layout_by_identifier = {(row.dong, row.line): row for row in layout_rows}
    atomic_units: list[AtomicPricedUnit] = []
    unmatched: list[UnmatchedPriceRow] = []

    for row in price_rows:
        floor = row.unit_no // 100
        line = row.unit_no % 100
        layout = layout_by_identifier.get((row.dong, line))
        if layout is None:
            unmatched.append(
                UnmatchedPriceRow(
                    dong=row.dong,
                    unit_no=row.unit_no,
                    line=line,
                    floor=floor,
                    type_name=row.type_name,
                    reason="missing_layout",
                )
            )
            continue

        if floor < layout.min_floor or floor > layout.max_floor:
            unmatched.append(
                UnmatchedPriceRow(
                    dong=row.dong,
                    unit_no=row.unit_no,
                    line=line,
                    floor=floor,
                    type_name=row.type_name,
                    reason="floor_out_of_range",
                )
            )
            continue

        if row.type_name and layout.type_name and row.type_name != layout.type_name:
            unmatched.append(
                UnmatchedPriceRow(
                    dong=row.dong,
                    unit_no=row.unit_no,
                    line=line,
                    floor=floor,
                    type_name=row.type_name,
                    reason="type_mismatch",
                )
            )
            continue

        atomic_units.append(
            AtomicPricedUnit(
                complex_name=complex_name,
                dong=row.dong,
                line=line,
                unit_no=row.unit_no,
                floor=floor,
                type_name=layout.type_name or row.type_name,
                price_fields=row.price_fields,
            )
        )

    atomic_units.sort(key=lambda item: (_natural_sort_key(item.type_name), int(item.dong), item.line, item.floor))
    return atomic_units, unmatched


def aggregate_atomic_priced_units(
    complex_name: str,
    layout_rows: list[LayoutRow],
    atomic_units: list[AtomicPricedUnit],
) -> list[NormalizedPricingRow]:
    if not layout_rows or not atomic_units:
        return []

    layout_by_identifier = {(row.dong, row.line): row for row in layout_rows}
    type_dong_lines: dict[str, dict[str, set[int]]] = defaultdict(lambda: defaultdict(set))
    for row in layout_rows:
        type_dong_lines[row.type_name][row.dong].add(row.line)

    floor_identifier_sets: dict[tuple[str, frozenset[tuple[str, int]]], set[int]] = defaultdict(set)
    grouped_by_type_price: dict[tuple[str, tuple[int, ...]], dict[int, set[tuple[str, int]]]] = defaultdict(lambda: defaultdict(set))

    for unit in atomic_units:
        identifier = (unit.dong, unit.line)
        grouped_by_type_price[(unit.type_name, unit.price_vector())][unit.floor].add(identifier)

    for (type_name, _), floors in grouped_by_type_price.items():
        for floor, identifiers in floors.items():
            floor_identifier_sets[(type_name, frozenset(identifiers))].add(floor)

    rows: list[NormalizedPricingRow] = []
    for (type_name, price_vector), floor_map in grouped_by_type_price.items():
        sorted_floors = sorted(floor_map)
        if not sorted_floors:
            continue

        start = sorted_floors[0]
        end = start
        current_set = frozenset(floor_map[start])

        for floor in sorted_floors[1:]:
            floor_set = frozenset(floor_map[floor])
            if floor == end + 1 and floor_set == current_set:
                end = floor
                continue

            rows.append(
                _build_normalized_row(
                    complex_name,
                    type_name,
                    current_set,
                    start,
                    end,
                    price_vector,
                    floor_identifier_sets[(type_name, current_set)],
                    layout_by_identifier,
                    type_dong_lines[type_name],
                )
            )
            start = floor
            end = floor
            current_set = floor_set

        rows.append(
            _build_normalized_row(
                complex_name,
                type_name,
                current_set,
                start,
                end,
                price_vector,
                floor_identifier_sets[(type_name, current_set)],
                layout_by_identifier,
                type_dong_lines[type_name],
            )
        )

    rows.sort(
        key=lambda row: (
            _natural_sort_key(str(row.values["타입"])),
            _group_sort_key(str(row.values["동별(라인별)"])),
            int(row.values["최저층"]),
            int(row.values["최고층"]),
            int(row.values["분양가"]),
        )
    )
    return rows


def rows_to_dicts(rows: Iterable[NormalizedPricingRow], header_order: Iterable[str] | None = None) -> list[dict[str, int | str]]:
    return [row.as_row(header_order or NORMALIZED_PRICING_COLUMNS) for row in rows]


def _build_normalized_row(
    complex_name: str,
    type_name: str,
    identifiers: frozenset[tuple[str, int]],
    start_floor: int,
    end_floor: int,
    price_vector: tuple[int, ...],
    all_floors_for_identifier_set: set[int],
    layout_by_identifier: dict[tuple[str, int], LayoutRow],
    type_dong_lines: dict[str, set[int]],
) -> NormalizedPricingRow:
    ids = sorted(identifiers, key=lambda item: (int(item[0]), item[1]))
    supply_count = sum(layout_by_identifier[item].line_unit_count for item in ids)
    floor_count = sum(1 for floor in range(start_floor, end_floor + 1) if floor in all_floors_for_identifier_set)
    unit_count = floor_count * len(ids)
    bucket_label = _format_floor_bucket(start_floor, end_floor, max(all_floors_for_identifier_set))

    values: dict[str, int | str] = {
        "단지명": complex_name,
        "타입": type_name,
        "동별(라인별)": _format_identifier_set(ids, type_dong_lines),
        "공급세대수": supply_count,
        "층구분": bucket_label,
        "해당세대수": unit_count,
        "최저층": start_floor,
        "최고층": end_floor,
    }

    for field_name, field_value in zip(NUMERIC_FIELDS, price_vector):
        values[field_name] = field_value

    return NormalizedPricingRow(values=values)


def _format_identifier_set(
    identifiers: list[tuple[str, int]],
    type_dong_lines: dict[str, set[int]],
) -> str:
    by_dong: dict[str, list[int]] = defaultdict(list)
    for dong, line in identifiers:
        by_dong[dong].append(line)

    full_dongs: list[int] = []
    partial_blocks: list[tuple[int, str]] = []
    for dong, lines in by_dong.items():
        normalized_lines = sorted(set(lines))
        full_lines = sorted(type_dong_lines.get(dong, set()))
        if normalized_lines == full_lines:
            full_dongs.append(int(dong))
            continue
        partial_blocks.append((int(dong), f"{dong}동 {','.join(str(line) for line in normalized_lines)}호"))

    segments: list[tuple[int, str]] = []
    for block in _collapse_ranges(sorted(full_dongs)):
        if len(block) == 1:
            segments.append((block[0], f"{block[0]}동"))
        else:
            segments.append((block[0], f"{block[0]}~{block[-1]}동"))

    segments.extend(partial_blocks)
    segments.sort(key=lambda item: item[0])
    return " ".join(label for _, label in segments)


def _format_floor_bucket(start_floor: int, end_floor: int, max_floor_for_identifier_set: int) -> str:
    if start_floor == end_floor:
        return f"{start_floor}층"
    if end_floor == max_floor_for_identifier_set:
        return f"{start_floor}층이상"
    return f"{start_floor}~{end_floor}층"


def _collapse_ranges(values: list[int]) -> list[list[int]]:
    if not values:
        return []

    ranges: list[list[int]] = [[values[0]]]
    for value in values[1:]:
        if value == ranges[-1][-1] + 1:
            ranges[-1].append(value)
            continue
        ranges.append([value])
    return ranges


def _first_index(values: list[str], target: str) -> int | None:
    for index, value in enumerate(values):
        if value.strip() == target:
            return index
    return None


def _cell(row: list[str], index: int) -> str:
    if index >= len(row):
        return ""
    return row[index].strip()


def _safe_int(value: str) -> int:
    text = re.sub(r"[^\d-]", "", str(value))
    if not text or text == "-":
        return 0
    try:
        return int(text)
    except ValueError:
        return 0


def _normalize_dong(value: str) -> str:
    return re.sub(r"[^\d]", "", value)


def _normalize_type(value: str) -> str:
    return str(value or "").strip()


def _layout_quality(row: LayoutRow) -> tuple[int, int, int]:
    return (row.line_unit_count, row.max_floor, -row.min_floor)


def _price_row_quality(row: LegacyPriceRow) -> tuple[int, int]:
    non_zero_fields = sum(1 for value in row.price_fields if value)
    return (non_zero_fields, row.price_fields[3] if len(row.price_fields) > 3 else 0)


def _group_sort_key(group_label: str) -> tuple[int, str]:
    match = re.search(r"(\d+)", group_label)
    return (int(match.group(1)) if match else 0, group_label)


def _natural_sort_key(value: str) -> tuple:
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
