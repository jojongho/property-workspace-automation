import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from legacy_price_normalizer import LayoutRow
from sync_apartment_price_source_sheet import (
    SyncResult,
    build_source_rows,
    normalize_lookup_key,
    sync_master_source_sheet,
)


class FakeSyncClient:
    def __init__(self):
        self.cleared = []
        self.updated = []
        self._values = {
            "'분양가_source'": [
                ["source_id", "active", "priority", "단지ID", "단지명", "타입", "동_raw", "라인_raw", "층_from", "층_to", "분양가", "계약금", "중도금", "잔금", "note", "비고"],
                ["SRC_OLD_KEEP", "TRUE", "1", "CPX_KEEP", "기존단지", "84A", "101", "1", "1", "1", "3", "9", "51", "12", "keep-note", "keep"],
                ["SRC_OLD_SWAP", "TRUE", "1", "CPX_OLD", "교체단지", "84B", "102", "2", "2", "2", "3", "9", "51", "12", "old-note", "old"],
            ]
        }

    def get_sheet_values(self, _spreadsheet_id, range_a1):
        if range_a1 in self._values:
            return self._values[range_a1]
        raise AssertionError(range_a1)

    def clear_values(self, spreadsheet_id, range_a1):
        self.cleared.append((spreadsheet_id, range_a1))

    def batch_update_values(self, spreadsheet_id, updates):
        self.updated.append((spreadsheet_id, updates))


class PricingSourceSyncTests(unittest.TestCase):
    def test_normalize_lookup_key_strips_spacing_and_punctuation(self):
        self.assertEqual(normalize_lookup_key("아산모종 서한이다음 노블리스(A1BL)"), "아산모종서한이다음노블리스a1bl")

    def test_build_source_rows_splits_groups_by_common_line_set(self):
        normalized_rows = [
            {
                "단지명": "교체단지",
                "타입": "84A",
                "동별(라인별)": "101~102동 103동 1호",
                "공급세대수": 5,
                "층구분": "3~5층",
                "해당세대수": 15,
                "최저층": 3,
                "최고층": 5,
                "분양가": 300,
                "1차계약금": 10,
                "2차계약금": 20,
                "중도금1회": 30,
                "중도금2회": 30,
                "중도금3회": 30,
                "중도금4회": 0,
                "중도금5회": 0,
                "중도금6회": 0,
                "잔금": 180,
            }
        ]
        layout_rows = [
            LayoutRow(dong="101", line=1, type_name="84A", min_floor=1, max_floor=10, line_unit_count=1),
            LayoutRow(dong="101", line=2, type_name="84A", min_floor=1, max_floor=10, line_unit_count=1),
            LayoutRow(dong="102", line=1, type_name="84A", min_floor=1, max_floor=10, line_unit_count=1),
            LayoutRow(dong="102", line=2, type_name="84A", min_floor=1, max_floor=10, line_unit_count=1),
            LayoutRow(dong="103", line=1, type_name="84A", min_floor=1, max_floor=10, line_unit_count=1),
        ]

        source_rows = build_source_rows("교체단지", normalized_rows, layout_rows, source_kind="sheet")

        self.assertEqual(len(source_rows), 2)
        self.assertEqual(source_rows[0]["동_raw"], "101~102")
        self.assertEqual(source_rows[0]["라인_raw"], "1~2")
        self.assertEqual(source_rows[1]["동_raw"], "103")
        self.assertEqual(source_rows[1]["라인_raw"], "1")

    def test_sync_master_source_sheet_rewrites_only_target_complex_rows_and_preserves_extra_columns(self):
        client = FakeSyncClient()
        result = SyncResult(
            complex_name="교체단지",
            spreadsheet_id="sheet1",
            source="sheet",
            status="rebuilt_from_sheet",
            row_count=1,
            unmatched_count=0,
            rows=[{}],
            source_rows=[
                {
                    "타입": "99A",
                    "동_raw": "201",
                    "라인_raw": "1",
                    "층_from": 3,
                    "층_to": 12,
                    "분양가": 3,
                    "계약금": 9,
                    "중도금": 51,
                    "잔금": 12,
                    "note": "fresh-note",
                }
            ],
        )

        sheet_info = type("SheetInfo", (), {"column_count": 16})()
        sync_master_source_sheet(
            client,
            "master",
            sheet_info,
            client._values["'분양가_source'"][0],
            [result],
            {"교체단지": "CPX_999"},
        )

        self.assertEqual(client.cleared, [("master", "'분양가_source'!A2:P")])
        update = client.updated[0]
        self.assertEqual(update[0], "master")
        payload = update[1][0]
        self.assertEqual(payload["range"], "'분양가_source'!A1:P3")
        self.assertEqual(payload["values"][1][4], "기존단지")
        self.assertEqual(payload["values"][2][3], "CPX_999")
        self.assertEqual(payload["values"][2][4], "교체단지")
        self.assertEqual(payload["values"][2][0][:4], "SRC_")
        self.assertEqual(payload["values"][2][-1], "")


if __name__ == "__main__":
    unittest.main()
