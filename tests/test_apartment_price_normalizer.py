import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from apartment_price_normalizer import expand_to_unit_rows, normalize_pricing_rows, parse_floor_ranges


class PricingNormalizerTests(unittest.TestCase):
    def test_parse_floor_ranges_supports_single_range_open_ended_and_mixed(self):
        self.assertEqual(parse_floor_ranges("3층"), [(3, 3)])
        self.assertEqual(parse_floor_ranges("5~9층"), [(5, 9)])
        self.assertEqual(parse_floor_ranges("10층 이상"), [(10, 999)])
        self.assertEqual(parse_floor_ranges("3,4,5층"), [(3, 3), (4, 4), (5, 5)])
        self.assertEqual(parse_floor_ranges("3~5층,7층"), [(3, 5), (7, 7)])

    def test_normalize_pricing_rows_keeps_one_row_per_type_and_floor_range(self):
        pricing_rows = [
            {
                "타입": "84A",
                "동별(라인별)": "101동 1호",
                "공급세대수": "20",
                "층구분": "5~9층",
                "해당세대수": "5",
                "대지비": "100,000,000",
                "건축비": "200,000,000",
                "부가가치세": "20,000,000",
                "분양가": "320,000,000",
                "1차계약금": "10,000,000",
                "2차계약금": "22,000,000",
                "중도금1회": "32,000,000",
                "중도금2회": "32,000,000",
                "중도금3회": "32,000,000",
                "중도금4회": "32,000,000",
                "중도금5회": "32,000,000",
                "중도금6회": "32,000,000",
                "잔금": "96,000,000",
            }
        ]

        normalized = normalize_pricing_rows("테스트단지", pricing_rows)

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["단지명"], "테스트단지")
        self.assertEqual(normalized[0]["타입"], "84A")
        self.assertEqual(normalized[0]["동별(라인별)"], "101동 1호")
        self.assertEqual(normalized[0]["공급세대수"], 20)
        self.assertEqual(normalized[0]["층구분"], "5~9층")
        self.assertEqual(normalized[0]["해당세대수"], 5)
        self.assertEqual(normalized[0]["최저층"], 5)
        self.assertEqual(normalized[0]["최고층"], 9)
        self.assertEqual(normalized[0]["분양가"], 320000000)
        self.assertEqual(normalized[0]["잔금"], 96000000)

    def test_normalize_pricing_rows_keeps_same_type_floor_when_line_group_differs(self):
        pricing_rows = [
            {"타입": "84A", "동별(라인별)": "101동 1호", "층구분": "5~9층", "분양가": 500000000},
            {"타입": "84A", "동별(라인별)": "102동 2호", "층구분": "5~9층", "분양가": 510000000},
        ]

        normalized = normalize_pricing_rows("테스트단지", pricing_rows)

        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0]["분양가"], 500000000)
        self.assertEqual(normalized[1]["분양가"], 510000000)

    def test_expand_to_unit_rows_only_expands_in_derived_output(self):
        normalized = normalize_pricing_rows(
            "테스트단지",
            [
                {
                    "타입": "84A",
                    "동별(라인별)": "101동 1호",
                    "층구분": "5~6층",
                    "분양가": 500000000,
                    "대지비": 200000000,
                    "건축비": 300000000,
                    "1차계약금": 10000000,
                    "2차계약금": 40000000,
                    "중도금1회": 75000000,
                    "중도금2회": 75000000,
                    "중도금3회": 75000000,
                    "중도금4회": 75000000,
                    "중도금5회": 0,
                    "중도금6회": 0,
                    "잔금": 150000000,
                },
                {
                    "타입": "84A",
                    "동별(라인별)": "101동 2호",
                    "층구분": "5~6층",
                    "분양가": 510000000,
                },
            ],
        )
        layout_data = [
            {"동": "101", "라인": [1, 2], "타입": "84A", "최고층": 6, "제외층": [1]},
        ]

        unit_rows = expand_to_unit_rows(layout_data, normalized)

        self.assertEqual(len(normalized), 2)
        self.assertEqual(len(unit_rows), 10)
        matched_rows = [row for row in unit_rows if row["층"] in (5, 6)]
        unmatched_rows = [row for row in unit_rows if row["층"] in (2, 3, 4)]
        self.assertEqual(len(matched_rows), 4)
        self.assertEqual(
            sorted((row["라인"], row["분양가"]) for row in matched_rows),
            [(1, 500000000), (1, 500000000), (2, 510000000), (2, 510000000)],
        )
        self.assertTrue(all(row["분양가"] == 0 for row in unmatched_rows))


if __name__ == "__main__":
    unittest.main()
