#!/usr/bin/env python3
"""Move tracked property folders under top-level type folders without changing folder IDs."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from dataclasses import dataclass, field

from backfill_property_folder_links import (
    FOLDER_URL_PREFIX,
    ROOT_FOLDER_ID,
    SHEET_SPECS,
    GoogleApiClient,
    build_building_lookup,
    extract_drive_id,
    get_value,
    make_header_index,
    normalize_region,
    parse_address,
)


TYPE_ROOTS = {
    "apartment": "01_아파트",
    "town": "02_주택타운",
    "building": "03_건물계열",
    "land": "04_토지",
    "factory": "05_공장창고",
}

CANONICAL_TYPE_KEYS = {
    "아파트매물": "apartment",
    "아파트단지": "apartment",
    "주택타운": "town",
    "건물": "building",
    "상가": "building",
    "원투룸": "building",
    "토지": "land",
    "공장창고": "factory",
}


@dataclass
class PlannedMove:
    folder_id: str
    folder_name: str
    canonical_name: str
    type_key: str
    target_parent_id: str
    target_parent_path: list[str]
    current_parent_id: str
    current_parent_name: str
    spreadsheet_id: str
    sheet_name: str
    source_rows: list[int] = field(default_factory=list)
    already_in_place: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Perform the move operations. Default is dry-run.")
    parser.add_argument("--summary-only", action="store_true", help="Print only the final summary JSON.")
    return parser.parse_args()


def get_sheet_spec(canonical_name: str):
    return next(spec for spec in SHEET_SPECS if spec.canonical_name == canonical_name)


def load_sheet_rows(client: GoogleApiClient, spec) -> tuple[list[list[str]], dict[str, int]]:
    rows = client.get_sheet_values(spec.spreadsheet_id, spec.sheet_name)
    if not rows:
        return [], {}
    return rows, make_header_index(rows[0])


def resolve_building_lookup(client: GoogleApiClient) -> dict[str, dict[str, str]]:
    building_spec = get_sheet_spec("건물")
    building_rows = client.get_sheet_values(building_spec.spreadsheet_id, building_spec.sheet_name)
    return build_building_lookup(building_rows)


def get_folder_meta(client: GoogleApiClient, folder_id: str, fields: str = "id,name,parents,webViewLink") -> dict:
    return client.get_drive_file(folder_id, fields)


def get_parent_meta(client: GoogleApiClient, folder_id: str) -> dict | None:
    folder = get_folder_meta(client, folder_id, "id,name,parents")
    parents = folder.get("parents") or []
    if not parents:
        return None
    return get_folder_meta(client, parents[0], "id,name,parents")


def resolve_apartment_root_folder_id(client: GoogleApiClient, folder_id: str, canonical_name: str) -> str:
    if canonical_name == "아파트단지":
        return folder_id

    sale_folder = get_parent_meta(client, folder_id)
    if not sale_folder or sale_folder.get("name") != "-매물":
        return folder_id

    complex_parents = sale_folder.get("parents") or []
    if not complex_parents:
        return folder_id
    return complex_parents[0]


def resolve_town_root_folder_id(client: GoogleApiClient, folder_id: str) -> str:
    parent = get_parent_meta(client, folder_id)
    if not parent or parent.get("name") != "-매물":
        return folder_id

    grand_parents = parent.get("parents") or []
    if not grand_parents:
        return folder_id
    return grand_parents[0]


def resolve_tracked_root_folder_id(client: GoogleApiClient, folder_id: str, canonical_name: str) -> str:
    if canonical_name in {"아파트매물", "아파트단지"}:
        return resolve_apartment_root_folder_id(client, folder_id, canonical_name)
    if canonical_name == "주택타운":
        return resolve_town_root_folder_id(client, folder_id)
    return folder_id


def resolve_row_location(
    row: list[str],
    idx: dict[str, int],
    canonical_name: str,
    building_lookup: dict[str, dict[str, str]],
) -> dict[str, str] | None:
    if canonical_name in {"아파트매물", "아파트단지", "주택타운", "토지", "공장창고"}:
        sigungu = get_value(row, idx, "시군구")
        dong = get_value(row, idx, "동읍면")
        if not sigungu or not dong:
            return None
        return {
            "시군구": normalize_region(sigungu),
            "동읍면": dong,
            "통반리": get_value(row, idx, "통반리"),
        }

    building_name = get_value(row, idx, "건물명")
    if not building_name:
        return None

    separated = {
        "시군구": get_value(row, idx, "시군구"),
        "동읍면": get_value(row, idx, "동읍면"),
        "통반리": get_value(row, idx, "통반리"),
        "지번": get_value(row, idx, "지번"),
    }
    if separated["시군구"] and separated["동읍면"] and separated["지번"]:
        return {
            "시군구": normalize_region(separated["시군구"]),
            "동읍면": separated["동읍면"],
            "통반리": separated["통반리"],
        }

    location = building_lookup.get(building_name) or parse_address(get_value(row, idx, "주소"))
    if not location:
        return None

    return {
        "시군구": normalize_region(location["시군구"]),
        "동읍면": location["동읍면"],
        "통반리": location.get("통반리", ""),
    }


def ensure_target_parent(
    client: GoogleApiClient,
    type_key: str,
    location: dict[str, str],
) -> tuple[str, list[str]]:
    type_root_name = TYPE_ROOTS[type_key]
    path_names = [type_root_name, location["시군구"], location["동읍면"]]
    parent = client.get_or_create_folder(ROOT_FOLDER_ID, type_root_name)
    parent = client.get_or_create_folder(parent["id"], location["시군구"])
    parent = client.get_or_create_folder(parent["id"], location["동읍면"])

    tong = location.get("통반리", "").strip()
    if tong:
        parent = client.get_or_create_folder(parent["id"], tong)
        path_names.append(tong)

    return parent["id"], path_names


def collect_planned_moves(client: GoogleApiClient) -> tuple[list[PlannedMove], dict]:
    building_lookup = resolve_building_lookup(client)
    planned_by_folder: dict[str, PlannedMove] = {}
    conflicts: list[dict] = []
    tracked_root_cache: dict[tuple[str, str], str] = {}
    target_parent_cache: dict[tuple[str, str, str, str], tuple[str, list[str]]] = {}
    planned_name_targets: dict[tuple[str, str], PlannedMove] = {}

    for spec in SHEET_SPECS:
      if spec.canonical_name not in CANONICAL_TYPE_KEYS:
        continue

      print(f"[scan] {spec.canonical_name}", file=sys.stderr, flush=True)
      rows, idx = load_sheet_rows(client, spec)
      if not rows:
        continue

      for row_number, row in enumerate(rows[1:], start=2):
        if row_number % 100 == 0:
          print(f"[scan] {spec.canonical_name} row {row_number}", file=sys.stderr, flush=True)
        folder_id = extract_drive_id(get_value(row, idx, "폴더ID") or get_value(row, idx, "관련파일"))
        if not folder_id:
          continue

        location = resolve_row_location(row, idx, spec.canonical_name, building_lookup)
        if not location:
          continue

        tracked_root_key = (spec.canonical_name, folder_id)
        tracked_root_folder_id = tracked_root_cache.get(tracked_root_key)
        if not tracked_root_folder_id:
          tracked_root_folder_id = resolve_tracked_root_folder_id(client, folder_id, spec.canonical_name)
          tracked_root_cache[tracked_root_key] = tracked_root_folder_id
        tracked_root_meta = get_folder_meta(client, tracked_root_folder_id, "id,name,parents,webViewLink")
        parents = tracked_root_meta.get("parents") or []
        current_parent_id = parents[0] if parents else ""
        current_parent_meta = get_folder_meta(client, current_parent_id, "id,name,parents") if current_parent_id else {"id": "", "name": ""}
        target_parent_key = (
          CANONICAL_TYPE_KEYS[spec.canonical_name],
          location["시군구"],
          location["동읍면"],
          location.get("통반리", ""),
        )
        cached_target = target_parent_cache.get(target_parent_key)
        if cached_target:
          target_parent_id, target_parent_path = cached_target
        else:
          target_parent_id, target_parent_path = ensure_target_parent(client, CANONICAL_TYPE_KEYS[spec.canonical_name], location)
          target_parent_cache[target_parent_key] = (target_parent_id, target_parent_path)

        name_target_key = (target_parent_id, tracked_root_meta["name"])
        conflicting_planned = planned_name_targets.get(name_target_key)
        if conflicting_planned and conflicting_planned.folder_id != tracked_root_folder_id:
          conflicts.append(
            {
              "folderId": tracked_root_folder_id,
              "folderName": tracked_root_meta["name"],
              "targetPath": target_parent_path,
              "conflictWithFolderId": conflicting_planned.folder_id,
              "conflictWithRows": conflicting_planned.source_rows,
              "conflictRow": row_number,
              "sheetName": spec.sheet_name,
              "reason": "duplicate-name-planned-target",
            }
          )
          continue

        existing_target_children = client.list_child_folders(target_parent_id)
        existing_same_name = next(
          (
            child for child in existing_target_children
            if child["name"] == tracked_root_meta["name"] and child["id"] != tracked_root_folder_id
          ),
          None,
        )
        if existing_same_name and current_parent_id != target_parent_id:
          conflicts.append(
            {
              "folderId": tracked_root_folder_id,
              "folderName": tracked_root_meta["name"],
              "targetPath": target_parent_path,
              "existingTargetFolderId": existing_same_name["id"],
              "sheetName": spec.sheet_name,
              "conflictRow": row_number,
              "reason": "duplicate-name-existing-target",
            }
          )
          continue

        existing = planned_by_folder.get(tracked_root_folder_id)
        if existing:
          if is_more_specific_path(existing.target_parent_path, target_parent_path):
            old_name_target_key = (existing.target_parent_id, existing.folder_name)
            planned_name_targets.pop(old_name_target_key, None)
            existing.target_parent_id = target_parent_id
            existing.target_parent_path = target_parent_path
            existing.already_in_place = (current_parent_id == target_parent_id)
            planned_name_targets[(existing.target_parent_id, existing.folder_name)] = existing
            existing.source_rows.append(row_number)
            continue

          if is_more_specific_path(target_parent_path, existing.target_parent_path):
            existing.source_rows.append(row_number)
            continue

          if existing.target_parent_id != target_parent_id:
            conflicts.append(
              {
                "folderId": tracked_root_folder_id,
                "folderName": tracked_root_meta["name"],
                "firstTargetPath": existing.target_parent_path,
                "conflictTargetPath": target_parent_path,
                "existingRows": existing.source_rows,
                "conflictRow": row_number,
                "sheetName": spec.sheet_name,
              }
            )
            continue
          existing.source_rows.append(row_number)
          continue

        planned_by_folder[tracked_root_folder_id] = PlannedMove(
          folder_id=tracked_root_folder_id,
          folder_name=tracked_root_meta["name"],
          canonical_name=spec.canonical_name,
          type_key=CANONICAL_TYPE_KEYS[spec.canonical_name],
          target_parent_id=target_parent_id,
          target_parent_path=target_parent_path,
          current_parent_id=current_parent_id,
          current_parent_name=current_parent_meta.get("name", ""),
          spreadsheet_id=spec.spreadsheet_id,
          sheet_name=spec.sheet_name,
          source_rows=[row_number],
          already_in_place=(current_parent_id == target_parent_id),
        )
        planned_name_targets[name_target_key] = planned_by_folder[tracked_root_folder_id]

    return list(planned_by_folder.values()), {"conflicts": conflicts}


def move_folder(client: GoogleApiClient, folder_id: str, old_parent_id: str, new_parent_id: str) -> dict:
    params = urllib.parse.urlencode(
      {
        "addParents": new_parent_id,
        "removeParents": old_parent_id,
        "supportsAllDrives": "true",
        "fields": "id,name,parents,webViewLink",
      }
    )
    url = f"https://www.googleapis.com/drive/v3/files/{folder_id}?{params}"
    return client.request("PATCH", url, {})


def is_more_specific_path(current_path: list[str], new_path: list[str]) -> bool:
    return len(new_path) > len(current_path) and new_path[: len(current_path)] == current_path


def main() -> int:
    args = parse_args()
    client = GoogleApiClient()
    planned_moves, extra = collect_planned_moves(client)

    summary = {
      "mode": "execute" if args.execute else "dry-run",
      "rootFolderId": ROOT_FOLDER_ID,
      "plannedMoves": len(planned_moves),
      "alreadyInPlace": 0,
      "executedMoves": 0,
      "byType": {},
      "conflicts": extra["conflicts"],
      "moves": [],
    }

    for move in planned_moves:
      summary["byType"].setdefault(move.type_key, {"count": 0, "moved": 0, "alreadyInPlace": 0})
      summary["byType"][move.type_key]["count"] += 1

      event = {
        "folderId": move.folder_id,
        "folderName": move.folder_name,
        "canonicalName": move.canonical_name,
        "typeKey": move.type_key,
        "sheetName": move.sheet_name,
        "rows": move.source_rows,
        "fromParentId": move.current_parent_id,
        "fromParentName": move.current_parent_name,
        "toParentId": move.target_parent_id,
        "toParentPath": move.target_parent_path,
        "alreadyInPlace": move.already_in_place,
      }

      if move.already_in_place:
        summary["alreadyInPlace"] += 1
        summary["byType"][move.type_key]["alreadyInPlace"] += 1
      elif args.execute:
        move_folder(client, move.folder_id, move.current_parent_id, move.target_parent_id)
        summary["executedMoves"] += 1
        summary["byType"][move.type_key]["moved"] += 1

      summary["moves"].append(event)

    if args.summary_only:
      compact = dict(summary)
      compact.pop("moves", None)
      print(json.dumps(compact, ensure_ascii=False, indent=2))
    else:
      print(json.dumps(summary, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
