#!/usr/bin/env python3
"""Merge remaining legacy regional tree folders into tracked type-root property folders."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

from backfill_property_folder_links import (
    GoogleApiClient,
    SHEET_SPECS,
    extract_drive_id,
    get_value,
    make_header_index,
    normalize_folder_token,
)
from cleanup_empty_regional_root_folders import REGIONAL_ROOTS
from migrate_drive_folder_tree import DriveClient, FOLDER_MIME_TYPE, Migrator
from migrate_to_type_root_structure import CANONICAL_TYPE_KEYS, resolve_building_lookup, resolve_row_location, resolve_tracked_root_folder_id


@dataclass(frozen=True)
class TargetFolder:
    folder_id: str
    folder_name: str
    normalized_name: str
    canonical_name: str
    type_key: str
    region: str
    dong: str
    tong: str


@dataclass(frozen=True)
class LegacyLocation:
    region: str
    dong: str = ""
    tong: str = ""

    def key(self) -> tuple[str, str, str]:
        return (self.region, self.dong, self.tong)

    @property
    def is_complete(self) -> bool:
        return bool(self.region and self.dong)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Perform the merge. Default is dry-run.")
    parser.add_argument("--summary-only", action="store_true", help="Print only the final summary JSON.")
    return parser.parse_args()


def build_target_index(client: GoogleApiClient) -> tuple[dict[tuple[str, str, str, str], list[TargetFolder]], dict[tuple[str, str, str, str], list[TargetFolder]]]:
    exact_index: dict[tuple[str, str, str, str], list[TargetFolder]] = {}
    normalized_index: dict[tuple[str, str, str, str], list[TargetFolder]] = {}
    seen_folders: set[str] = set()
    building_lookup = resolve_building_lookup(client)

    for spec in SHEET_SPECS:
        if spec.canonical_name not in CANONICAL_TYPE_KEYS:
            continue

        rows = client.get_sheet_values(spec.spreadsheet_id, spec.sheet_name)
        if not rows:
            continue

        idx = make_header_index(rows[0])
        for row in rows[1:]:
            folder_id = extract_drive_id(get_value(row, idx, "폴더ID") or get_value(row, idx, "관련파일"))
            if not folder_id:
                continue

            location = resolve_row_location(row, idx, spec.canonical_name, building_lookup)
            if not location:
                continue

            root_folder_id = resolve_tracked_root_folder_id(client, folder_id, spec.canonical_name)
            if root_folder_id in seen_folders:
                continue
            seen_folders.add(root_folder_id)

            meta = client.get_drive_file(root_folder_id, "id,name,parents,webViewLink")
            target = TargetFolder(
                folder_id=meta["id"],
                folder_name=meta["name"],
                normalized_name=normalize_folder_token(meta["name"]),
                canonical_name=spec.canonical_name,
                type_key=CANONICAL_TYPE_KEYS[spec.canonical_name],
                region=location["시군구"],
                dong=location["동읍면"],
                tong=location.get("통반리", "").strip(),
            )

            exact_key = (target.region, target.dong, target.tong, target.folder_name)
            exact_index.setdefault(exact_key, []).append(target)

            normalized_key = (target.region, target.dong, target.tong, target.normalized_name)
            normalized_index.setdefault(normalized_key, []).append(target)

    return exact_index, normalized_index


def is_dong_level(name: str) -> bool:
    return name.endswith(("동", "읍", "면"))


def is_tong_level(name: str) -> bool:
    return name.endswith("리")


def find_target_match(
    location: LegacyLocation,
    folder_name: str,
    exact_index: dict[tuple[str, str, str, str], list[TargetFolder]],
    normalized_index: dict[tuple[str, str, str, str], list[TargetFolder]],
) -> tuple[TargetFolder | None, str]:
    if not location.is_complete:
        return None, "incomplete-location"

    exact_matches = exact_index.get((location.region, location.dong, location.tong, folder_name), [])
    if len(exact_matches) == 1:
        return exact_matches[0], "exact"
    if len(exact_matches) > 1:
        return None, "ambiguous-exact"

    normalized_name = normalize_folder_token(folder_name)
    if not normalized_name:
        return None, "empty-normalized-name"

    normalized_matches = normalized_index.get((location.region, location.dong, location.tong, normalized_name), [])
    if len(normalized_matches) == 1:
        return normalized_matches[0], "normalized"
    if len(normalized_matches) > 1:
        return None, "ambiguous-normalized"
    return None, "no-match"


def traverse_and_merge(
    drive_client: DriveClient,
    migrator: Migrator,
    folder_id: str,
    path: str,
    location: LegacyLocation,
    exact_index: dict[tuple[str, str, str, str], list[TargetFolder]],
    normalized_index: dict[tuple[str, str, str, str], list[TargetFolder]],
    summary: dict,
) -> None:
    children = drive_client.list_children(folder_id)
    for child in children:
        if child["mimeType"] != FOLDER_MIME_TYPE:
            continue

        child_name = child["name"]
        child_path = f"{path}/{child_name}"

        next_location = location
        if not location.dong and is_dong_level(child_name):
            next_location = LegacyLocation(region=location.region, dong=child_name)
            traverse_and_merge(drive_client, migrator, child["id"], child_path, next_location, exact_index, normalized_index, summary)
            continue
        if location.dong and not location.tong and is_tong_level(child_name):
            next_location = LegacyLocation(region=location.region, dong=location.dong, tong=child_name)
            traverse_and_merge(drive_client, migrator, child["id"], child_path, next_location, exact_index, normalized_index, summary)
            continue

        match, match_kind = find_target_match(location, child_name, exact_index, normalized_index)
        if match and match.folder_id != child["id"]:
            summary["matchedFolders"] += 1
            summary["byType"].setdefault(match.type_key, 0)
            summary["byType"][match.type_key] += 1
            summary["matches"].append(
                {
                    "sourceFolderId": child["id"],
                    "sourcePath": child_path,
                    "targetFolderId": match.folder_id,
                    "targetFolderName": match.folder_name,
                    "typeKey": match.type_key,
                    "matchKind": match_kind,
                }
            )
            migrator.log(
                {
                    "action": "merge-remaining-legacy-folder",
                    "mode": "execute" if migrator.execute else "dry-run",
                    "sourceFolderId": child["id"],
                    "targetFolderId": match.folder_id,
                    "sourcePath": child_path,
                    "typeKey": match.type_key,
                    "matchKind": match_kind,
                }
            )
            migrator.migrate_parent(child["id"], match.folder_id, child_path)
            continue

        if match_kind.startswith("ambiguous"):
            summary["ambiguousFolders"] += 1
            summary["ambiguous"].append({"path": child_path, "reason": match_kind})
        elif match_kind == "no-match":
            summary["unmatchedFolders"] += 1

        traverse_and_merge(drive_client, migrator, child["id"], child_path, location, exact_index, normalized_index, summary)


def main() -> int:
    args = parse_args()
    index_client = GoogleApiClient()
    exact_index, normalized_index = build_target_index(index_client)

    drive_client = DriveClient()
    migrator = Migrator(drive_client, execute=args.execute, emit_events=not args.summary_only)

    summary = {
        "mode": "execute" if args.execute else "dry-run",
        "regionalRoots": [root.name for root in REGIONAL_ROOTS],
        "targetFolderCount": len({target.folder_id for targets in exact_index.values() for target in targets}),
        "matchedFolders": 0,
        "ambiguousFolders": 0,
        "unmatchedFolders": 0,
        "byType": {},
        "matches": [],
        "ambiguous": [],
    }

    for root in REGIONAL_ROOTS:
        location = LegacyLocation(region=root.name)
        traverse_and_merge(
            drive_client,
            migrator,
            root.folder_id,
            root.name,
            location,
            exact_index,
            normalized_index,
            summary,
        )

    summary.update(migrator.stats)
    if args.summary_only:
        compact = dict(summary)
        compact["matches"] = compact["matches"][:200]
        compact["ambiguous"] = compact["ambiguous"][:200]
        print(json.dumps(compact, ensure_ascii=False, indent=2))
    else:
        migrator.log({"action": "summary", **summary})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
