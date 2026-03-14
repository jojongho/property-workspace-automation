import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from legacy_price_normalizer import (
    aggregate_atomic_priced_units,
    build_atomic_priced_units,
    parse_layout_rows,
    parse_legacy_price_rows,
    rows_to_dicts,
)


def legacy_header():
    return [
        "동",
        "호",
        "타입",
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
    ]


class LegacyPriceNormalizerTests(unittest.TestCase):
    def test_parse_layout_rows_uses_second_dong_column_and_line_from_ho_column(self):
        layout_values = [
            ["동", "라인", "동", "호", "타입", "최하층", "최고층", "라인당세대"],
            ["101", "2", "101", "1", "84A", "1", "3", "3"],
            ["102", "2", "101", "2", "84A", "1", "3", "3"],
            ["103", "1", "102", "1", "84A", "1", "3", "3"],
        ]

        rows = parse_layout_rows(layout_values)

        self.assertEqual(
            [(row.dong, row.line, row.type_name) for row in rows],
            [("101", 1, "84A"), ("101", 2, "84A"), ("102", 1, "84A")],
        )

    def test_build_atomic_units_derives_floor_and_line_from_unit_number(self):
        layout_rows = parse_layout_rows(
            [
                ["동", "라인", "동", "호", "타입", "최하층", "최고층", "라인당세대"],
                ["101", "1", "101", "1", "84A", "1", "6", "6"],
            ]
        )
        price_rows = parse_legacy_price_rows(
            [
                legacy_header(),
                ["101", "501", "84A", "100", "200", "0", "300", "10", "20", "30", "30", "30", "30", "30", "30", "60"],
            ]
        )

        atomic, unmatched = build_atomic_priced_units("테스트단지", layout_rows, price_rows)

        self.assertEqual(len(unmatched), 0)
        self.assertEqual(len(atomic), 1)
        self.assertEqual(atomic[0].floor, 5)
        self.assertEqual(atomic[0].line, 1)

    def test_aggregate_atomic_units_groups_consecutive_floors_and_formats_full_dong_ranges(self):
        layout_rows = parse_layout_rows(
            [
                ["동", "라인", "동", "호", "타입", "최하층", "최고층", "라인당세대"],
                ["101", "2", "101", "1", "84A", "1", "3", "3"],
                ["102", "2", "101", "2", "84A", "1", "3", "3"],
                ["103", "1", "102", "1", "84A", "1", "3", "3"],
            ]
        )
        price_rows = parse_legacy_price_rows(
            [
                legacy_header(),
                ["101", "101", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["101", "201", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["101", "301", "84A", "11", "21", "0", "32", "1", "2", "3", "3", "3", "3", "3", "3", "7"],
                ["101", "102", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["101", "202", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["101", "302", "84A", "11", "21", "0", "32", "1", "2", "3", "3", "3", "3", "3", "3", "7"],
                ["102", "101", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["102", "201", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["102", "301", "84A", "11", "21", "0", "32", "1", "2", "3", "3", "3", "3", "3", "3", "7"],
            ]
        )

        atomic, unmatched = build_atomic_priced_units("테스트단지", layout_rows, price_rows)
        rows = rows_to_dicts(aggregate_atomic_priced_units("테스트단지", layout_rows, atomic))

        self.assertEqual(len(unmatched), 0)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["동별(라인별)"], "101~102동")
        self.assertEqual(rows[0]["층구분"], "1~2층")
        self.assertEqual(rows[0]["공급세대수"], 9)
        self.assertEqual(rows[0]["해당세대수"], 6)
        self.assertEqual(rows[1]["층구분"], "3층")

    def test_aggregate_atomic_units_formats_partial_dong_and_open_ended_bucket(self):
        layout_rows = parse_layout_rows(
            [
                ["동", "라인", "동", "호", "타입", "최하층", "최고층", "라인당세대"],
                ["101", "2", "101", "1", "84A", "1", "3", "3"],
                ["102", "2", "101", "2", "84A", "1", "3", "3"],
            ]
        )
        price_rows = parse_legacy_price_rows(
            [
                legacy_header(),
                ["101", "201", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
                ["101", "301", "84A", "10", "20", "0", "30", "1", "2", "3", "3", "3", "3", "3", "3", "6"],
            ]
        )

        atomic, _ = build_atomic_priced_units("테스트단지", layout_rows, price_rows)
        rows = rows_to_dicts(aggregate_atomic_priced_units("테스트단지", layout_rows, atomic))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["동별(라인별)"], "101동 1호")
        self.assertEqual(rows[0]["층구분"], "2층이상")
        self.assertEqual(rows[0]["공급세대수"], 3)
        self.assertEqual(rows[0]["해당세대수"], 2)


if __name__ == "__main__":
    unittest.main()
