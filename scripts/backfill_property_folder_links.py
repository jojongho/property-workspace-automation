#!/usr/bin/env python3
"""Backfill Google Sheets folder links using Drive and Sheets APIs."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass


ROOT_FOLDER_ID = "1OhHhbs4OGvRu8174U6kqRex7if7bFbcz"
FOLDER_URL_PREFIX = "https://drive.google.com/drive/folders/"
ALLOWED_REGIONS = {"아산시", "천안시 서북구", "천안시 동남구"}
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"


@dataclass(frozen=True)
class SheetSpec:
    spreadsheet_id: str
    sheet_name: str
    canonical_name: str


SHEET_SPECS = [
    SheetSpec("1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ", "아파트", "아파트매물"),
    SheetSpec("1V3PVwVRFbHbrOu2JKlE1xlDVCosHy08hPUeX5HojYoU", "주택", "주택타운"),
    SheetSpec("1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E", "건물", "건물"),
    SheetSpec("1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E", "상가", "상가"),
    SheetSpec("1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E", "원투룸", "원투룸"),
    SheetSpec("1mGWLvOXUkANttGS0YBQYGgJzB9Af9oivc0uskkB6bsw", "토지", "토지"),
    SheetSpec("1GPtVtbDJEVnXuYGFnCgaA6vcigt8khdw_0-nCg7pD5U", "공장창고", "공장창고"),
]


class GoogleApiClient:
    def __init__(self) -> None:
        self.access_token = self._mint_access_token()
        self.folder_cache: dict[tuple[str, str], dict[str, str]] = {}

    def _extract_json(self, text: str) -> dict:
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

    def request(self, method: str, url: str, payload: dict | None = None) -> dict:
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
        input_text = None
        if payload is not None:
            command.extend(["-H", "Content-Type: application/json", "--data-binary", "@-"])
            input_text = json.dumps(payload, ensure_ascii=False)
        result = subprocess.run(command, input=input_text, capture_output=True, text=True, check=True)
        raw = result.stdout.strip()
        return json.loads(raw) if raw else {}

    def get_sheet_values(self, spreadsheet_id: str, range_a1: str) -> list[list[str]]:
        encoded_range = urllib.parse.quote(range_a1, safe="!:'")
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}"
        return self.request("GET", url).get("values", [])

    def batch_update_values(self, spreadsheet_id: str, updates: list[dict]) -> None:
        if not updates:
            return
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate"
            "?valueInputOption=RAW"
        )
        self.request("POST", url, {"valueInputOption": "RAW", "data": updates})

    def get_or_create_folder(self, parent_id: str, folder_name: str) -> dict[str, str]:
        cache_key = (parent_id, folder_name)
        cached = self.folder_cache.get(cache_key)
        if cached:
            return cached

        quoted_name = folder_name.replace("\\", "\\\\").replace("'", "\\'")
        q = (
            f"mimeType = '{FOLDER_MIME_TYPE}' and trashed = false and "
            f"'{parent_id}' in parents and name = '{quoted_name}'"
        )
        params = urllib.parse.urlencode(
            {
                "q": q,
                "fields": "files(id,name,webViewLink)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageSize": "1",
            }
        )
        search_url = f"https://www.googleapis.com/drive/v3/files?{params}"
        files = self.request("GET", search_url).get("files", [])
        if files:
            folder = files[0]
            result = {"id": folder["id"], "url": folder.get("webViewLink") or FOLDER_URL_PREFIX + folder["id"]}
            self.folder_cache[cache_key] = result
            return result

        create_url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink"
        created = self.request(
            "POST",
            create_url,
            {"name": folder_name, "mimeType": FOLDER_MIME_TYPE, "parents": [parent_id]},
        )
        result = {"id": created["id"], "url": created.get("webViewLink") or FOLDER_URL_PREFIX + created["id"]}
        self.folder_cache[cache_key] = result
        return result


def normalize_region(region: str) -> str:
    normalized = " ".join(str(region or "").split())
    return normalized if normalized in ALLOWED_REGIONS else "타지역"


def parse_address(address: str) -> dict[str, str] | None:
    parts = str(address or "").strip().split()
    if not parts:
        return None
    sigungu_parts: list[str] = []
    dong_eup_myeon = ""
    tong_ban_ri = ""
    jibun = ""
    for part in parts:
        if part.endswith(("시", "군", "구")):
            sigungu_parts.append(part)
            continue
        if not dong_eup_myeon and part.endswith(("동", "읍", "면")):
            dong_eup_myeon = part
            continue
        if not tong_ban_ri and part.endswith("리"):
            tong_ban_ri = part
            continue
        if not jibun and part[:1].isdigit():
            jibun = part
    sigungu = " ".join(sigungu_parts)
    if not sigungu or not dong_eup_myeon or not jibun:
        return None
    return {
        "시군구": normalize_region(sigungu),
        "동읍면": dong_eup_myeon,
        "통반리": tong_ban_ri,
        "지번": jibun,
    }


def make_header_index(header: list[str]) -> dict[str, int]:
    return {name: idx for idx, name in enumerate(header)}


def get_value(row: list[str], header_index: dict[str, int], key: str) -> str:
    idx = header_index.get(key)
    if idx is None or idx >= len(row):
        return ""
    return str(row[idx]).strip()


def find_matching_jibun(
    rows: list[list[str]],
    header_index: dict[str, int],
    row_number: int,
    match_key: str,
    filter_keys: list[str],
) -> str:
    current_row = rows[row_number - 1] if row_number - 1 < len(rows) else []
    current_jibun = get_value(current_row, header_index, "지번")
    if current_jibun:
        return current_jibun

    match_value = get_value(current_row, header_index, match_key)
    if not match_value:
        return ""

    for candidate_number, candidate_row in enumerate(rows[1:], start=2):
        if candidate_number == row_number:
            continue
        if get_value(candidate_row, header_index, match_key) != match_value:
            continue

        candidate_jibun = get_value(candidate_row, header_index, "지번")
        if not candidate_jibun:
            continue

        filter_matched = True
        for filter_key in filter_keys:
            current_filter = get_value(current_row, header_index, filter_key)
            candidate_filter = get_value(candidate_row, header_index, filter_key)
            if current_filter and candidate_filter and current_filter != candidate_filter:
                filter_matched = False
                break

        if filter_matched:
            return candidate_jibun

    return ""


def ensure_meta_header(header: list[str]) -> None:
    while len(header) < 3:
        header.append("")
    header[0] = "ID"
    header[1] = "관련파일"
    header[2] = "폴더ID"


def create_apartment_folder(client: GoogleApiClient, row: list[str], idx: dict[str, int]) -> dict[str, str] | None:
    sigungu = get_value(row, idx, "시군구")
    dong = get_value(row, idx, "동읍면")
    jibun = get_value(row, idx, "지번")
    complex_name = get_value(row, idx, "단지명")
    dong_no = get_value(row, idx, "동")
    ho = get_value(row, idx, "호")
    kind = get_value(row, idx, "타입")
    if not all([sigungu, dong, jibun, complex_name, dong_no, ho, kind]):
        return None
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, normalize_region(sigungu))
    parent = client.get_or_create_folder(parent["id"], dong)
    tong = get_value(row, idx, "통반리")
    if tong:
        parent = client.get_or_create_folder(parent["id"], tong)
    parent = client.get_or_create_folder(parent["id"], f"{jibun} {complex_name}")
    parent = client.get_or_create_folder(parent["id"], "-매물")
    return client.get_or_create_folder(parent["id"], f"{dong_no}-{ho}-{kind}")


def create_town_folder(client: GoogleApiClient, row: list[str], idx: dict[str, int]) -> dict[str, str] | None:
    sigungu = get_value(row, idx, "시군구")
    dong = get_value(row, idx, "동읍면")
    jibun = get_value(row, idx, "지번")
    complex_name = get_value(row, idx, "주택단지")
    if not all([sigungu, dong, jibun, complex_name]):
        return None
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, normalize_region(sigungu))
    parent = client.get_or_create_folder(parent["id"], dong)
    tong = get_value(row, idx, "통반리")
    if tong:
        parent = client.get_or_create_folder(parent["id"], tong)

    house_type = get_value(row, idx, "주택유형").lower()
    dong_no = get_value(row, idx, "동")
    ho = get_value(row, idx, "호")
    kind = get_value(row, idx, "타입")
    if house_type == "단독" or complex_name == "단독":
        return client.get_or_create_folder(parent["id"], f"{jibun}번지 {complex_name}")

    complex_folder = client.get_or_create_folder(parent["id"], complex_name)
    sale_folder = client.get_or_create_folder(complex_folder["id"], "-매물")
    if house_type in {"단지형 전원주택", "전원주택"}:
        parts = [f"{jibun}번지"]
        if dong_no:
            parts.append(f"{dong_no}동")
        if ho:
            parts.append(f"{ho}호")
        leaf_name = " ".join(parts)
    else:
        parts = [f"{jibun}번지"]
        if dong_no:
            parts.append(f"{dong_no}동")
        if ho:
            parts.append(f"{ho}호")
        if kind:
            parts.append(kind)
        leaf_name = " ".join(parts)
    return client.get_or_create_folder(sale_folder["id"], leaf_name)


def create_building_folder(
    client: GoogleApiClient,
    location: dict[str, str],
    building_name: str,
    property_type: str,
    ho: str,
    store_name: str,
    deal_type: str,
    room_type: str,
) -> dict[str, str]:
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, normalize_region(location["시군구"]))
    parent = client.get_or_create_folder(parent["id"], location["동읍면"])
    if location.get("통반리"):
        parent = client.get_or_create_folder(parent["id"], location["통반리"])
    building_folder = client.get_or_create_folder(parent["id"], f"{location['지번']} {building_name}")
    sale_folder = client.get_or_create_folder(building_folder["id"], "-매물")

    normalized_type = property_type.lower()
    parts: list[str] = []
    if ho:
        parts.append(ho)
    if "상가" in normalized_type and store_name:
        parts.append(store_name)
    elif "원투룸" in normalized_type and room_type:
        parts.append(room_type)
    if deal_type:
        parts.append(deal_type)
    leaf_name = " ".join(parts) if parts else (ho or "매물")
    client.get_or_create_folder(sale_folder["id"], leaf_name)
    return building_folder


def create_land_folder(client: GoogleApiClient, row: list[str], idx: dict[str, int]) -> dict[str, str] | None:
    sigungu = get_value(row, idx, "시군구")
    dong = get_value(row, idx, "동읍면")
    jibun = get_value(row, idx, "지번")
    category = get_value(row, idx, "토지분류")
    if not all([sigungu, dong, jibun, category]):
        return None
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, normalize_region(sigungu))
    parent = client.get_or_create_folder(parent["id"], dong)
    tong = get_value(row, idx, "통반리")
    if tong:
        parent = client.get_or_create_folder(parent["id"], tong)
    return client.get_or_create_folder(parent["id"], f"{jibun} {category}")


def create_factory_folder(client: GoogleApiClient, row: list[str], idx: dict[str, int]) -> dict[str, str] | None:
    sigungu = get_value(row, idx, "시군구")
    dong = get_value(row, idx, "동읍면")
    jibun = get_value(row, idx, "지번")
    name = get_value(row, idx, "명칭")
    if not all([sigungu, dong, jibun, name]):
        return None
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, normalize_region(sigungu))
    parent = client.get_or_create_folder(parent["id"], dong)
    tong = get_value(row, idx, "통반리")
    if tong:
        parent = client.get_or_create_folder(parent["id"], tong)
    return client.get_or_create_folder(parent["id"], f"{jibun} {name}")


def build_building_lookup(building_rows: list[list[str]]) -> dict[str, dict[str, str]]:
    header = building_rows[0]
    idx = make_header_index(header)
    lookup: dict[str, dict[str, str]] = {}
    for row in building_rows[1:]:
        building_name = get_value(row, idx, "건물명")
        if not building_name or building_name in lookup:
            continue
        sigungu = get_value(row, idx, "시군구")
        dong = get_value(row, idx, "동읍면")
        jibun = get_value(row, idx, "지번")
        if not all([sigungu, dong, jibun]):
            continue
        lookup[building_name] = {
            "시군구": normalize_region(sigungu),
            "동읍면": dong,
            "통반리": get_value(row, idx, "통반리"),
            "지번": jibun,
        }
    return lookup


def build_updates_for_spec(
    client: GoogleApiClient,
    spec: SheetSpec,
    building_lookup: dict[str, dict[str, str]],
    row_start: int | None = None,
    row_end: int | None = None,
) -> tuple[list[dict], dict]:
    rows = client.get_sheet_values(spec.spreadsheet_id, spec.sheet_name)
    if not rows:
        return [], {"sheet": spec.sheet_name, "processed": 0, "created": 0, "skipped": 0}
    header = rows[0]
    ensure_meta_header(header)
    idx = make_header_index(header)
    updates: list[dict] = []
    created = 0
    skipped = 0

    for row_number, row in enumerate(rows[1:], start=2):
        if row_start and row_number < row_start:
            continue
        if row_end and row_number > row_end:
            continue

        url = row[1].strip() if len(row) > 1 else ""
        if url:
            skipped += 1
            continue

        folder = None
        if spec.canonical_name == "아파트매물":
            if not get_value(row, idx, "지번"):
                inferred_jibun = find_matching_jibun(rows, idx, row_number, "단지명", ["시군구", "동읍면", "통반리"])
                if inferred_jibun:
                    row = list(row)
                    while len(row) <= idx["지번"]:
                        row.append("")
                    row[idx["지번"]] = inferred_jibun
            folder = create_apartment_folder(client, row, idx)
        elif spec.canonical_name == "주택타운":
            if not get_value(row, idx, "지번"):
                inferred_jibun = find_matching_jibun(rows, idx, row_number, "주택단지", ["시군구", "동읍면", "통반리"])
                if inferred_jibun:
                    row = list(row)
                    while len(row) <= idx["지번"]:
                        row.append("")
                    row[idx["지번"]] = inferred_jibun
            folder = create_town_folder(client, row, idx)
        elif spec.canonical_name in {"건물", "상가", "원투룸"}:
            building_name = get_value(row, idx, "건물명")
            if building_name:
                if all(get_value(row, idx, key) for key in ("시군구", "동읍면", "지번")):
                    location = {
                        "시군구": normalize_region(get_value(row, idx, "시군구")),
                        "동읍면": get_value(row, idx, "동읍면"),
                        "통반리": get_value(row, idx, "통반리"),
                        "지번": get_value(row, idx, "지번"),
                    }
                else:
                    location = building_lookup.get(building_name) or parse_address(get_value(row, idx, "주소"))
                if location:
                    ho = get_value(row, idx, "호") or get_value(row, idx, "호수")
                    folder = create_building_folder(
                        client,
                        location,
                        building_name,
                        get_value(row, idx, "매물유형") or spec.canonical_name,
                        ho,
                        get_value(row, idx, "상호명"),
                        get_value(row, idx, "거래유형"),
                        get_value(row, idx, "방구조"),
                    )
        elif spec.canonical_name == "토지":
            folder = create_land_folder(client, row, idx)
        elif spec.canonical_name == "공장창고":
            folder = create_factory_folder(client, row, idx)

        if not folder:
            skipped += 1
            continue

        updates.append(
            {
                "range": f"{spec.sheet_name}!B{row_number}:C{row_number}",
                "majorDimension": "ROWS",
                "values": [[folder["url"], folder["id"]]],
            }
        )
        created += 1

    return updates, {
        "sheet": spec.sheet_name,
        "processed": len(rows) - 1,
        "created": created,
        "skipped": skipped,
        "row_start": row_start,
        "row_end": row_end,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-sheet", choices=[spec.canonical_name for spec in SHEET_SPECS])
    parser.add_argument("--row-start", type=int)
    parser.add_argument("--row-end", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = GoogleApiClient()
    building_spec = next(spec for spec in SHEET_SPECS if spec.canonical_name == "건물")
    building_rows = client.get_sheet_values(building_spec.spreadsheet_id, building_spec.sheet_name)
    building_lookup = build_building_lookup(building_rows)

    target_specs = SHEET_SPECS
    if args.canonical_sheet:
      target_specs = [spec for spec in SHEET_SPECS if spec.canonical_name == args.canonical_sheet]

    summary = []
    for spec in target_specs:
        updates, info = build_updates_for_spec(
            client,
            spec,
            building_lookup,
            row_start=args.row_start,
            row_end=args.row_end,
        )
        client.batch_update_values(spec.spreadsheet_id, updates)
        summary.append(info)
        print(json.dumps(info, ensure_ascii=False))

    print(json.dumps({"rootFolderId": ROOT_FOLDER_ID, "summary": summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
