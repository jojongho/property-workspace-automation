import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from normalize_master_price_source_preview import (
    ERROR_TYPES,
    SOURCE_HEADERS,
    normalize_source_rows,
    parse_dong_tokens,
    parse_line_tokens,
)


class NormalizeMasterPriceSourcePreviewTests(unittest.TestCase):
    def test_parse_dong_tokens_supports_comma_and_ranges(self):
        self.assertEqual(parse_dong_tokens("102,104~105,111~112"), (["102", "104", "105", "111", "112"], ""))

    def test_parse_line_tokens_supports_single_and_ranges(self):
        self.assertEqual(parse_line_tokens("1~3"), (["01", "02", "03"], ""))

    def test_normalize_source_rows_expands_dong_and_line_without_floor_expansion(self):
        rows = [
            SOURCE_HEADERS,
            [
                "SRC_001",
                "TRUE",
                "1",
                "CPX_001",
                "테스트단지",
                "84A",
                "102,104~105",
                "1~2",
                "23",
                "28",
                "500000000",
                "50000000",
                "300000000",
                "150000000",
                "note-a",
            ],
        ]

        normalized_rows, error_rows, stats = normalize_source_rows(rows, "2026-03-14 22:00:00")

        self.assertEqual(len(normalized_rows), 6)
        self.assertEqual(len(error_rows), 0)
        self.assertEqual(stats["normalized_rows"], 6)
        self.assertEqual(normalized_rows[0][8:12], ["102", "01", 23, 28])

    def test_normalize_source_rows_logs_invalid_line_and_duplicate_ranges(self):
        rows = [
            SOURCE_HEADERS,
            [
                "SRC_BAD",
                "TRUE",
                "1",
                "CPX_001",
                "테스트단지",
                "84A",
                "101",
                "",
                "1",
                "1",
                "100",
                "10",
                "50",
                "40",
                "",
            ],
            [
                "SRC_DUP1",
                "TRUE",
                "1",
                "CPX_001",
                "테스트단지",
                "84A",
                "101",
                "1",
                "2",
                "3",
                "100",
                "10",
                "50",
                "40",
                "",
            ],
            [
                "SRC_DUP2",
                "TRUE",
                "1",
                "CPX_001",
                "테스트단지",
                "84A",
                "101",
                "1",
                "2",
                "3",
                "100",
                "10",
                "50",
                "40",
                "",
            ],
        ]

        normalized_rows, error_rows, stats = normalize_source_rows(rows, "2026-03-14 22:00:00")

        self.assertEqual(len(normalized_rows), 2)
        self.assertEqual(stats["error_counts"][ERROR_TYPES["invalid_line_token"]], 1)
        self.assertEqual(stats["error_counts"][ERROR_TYPES["duplicate_norm_range"]], 2)


if __name__ == "__main__":
    unittest.main()
