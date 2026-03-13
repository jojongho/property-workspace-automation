#!/usr/bin/env python3
"""Archive remaining legacy regional root folders under a dedicated archive parent."""

from __future__ import annotations

import argparse
import json
import urllib.parse

from backfill_property_folder_links import GoogleApiClient, ROOT_FOLDER_ID
from cleanup_empty_regional_root_folders import REGIONAL_ROOTS


ARCHIVE_FOLDER_NAME = "99_레거시 보관"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Perform the move operations. Default is dry-run.")
    return parser.parse_args()


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


def main() -> int:
    args = parse_args()
    client = GoogleApiClient()
    archive_folder = client.get_or_create_folder(ROOT_FOLDER_ID, ARCHIVE_FOLDER_NAME)

    summary = {
        "mode": "execute" if args.execute else "dry-run",
        "rootFolderId": ROOT_FOLDER_ID,
        "archiveFolderId": archive_folder["id"],
        "archiveFolderName": ARCHIVE_FOLDER_NAME,
        "moves": [],
        "alreadyArchived": [],
    }

    for root in REGIONAL_ROOTS:
        meta = client.get_drive_file(root.folder_id, "id,name,parents,webViewLink")
        current_parent_id = (meta.get("parents") or [""])[0]
        event = {
            "folderId": root.folder_id,
            "folderName": meta["name"],
            "fromParentId": current_parent_id,
            "toParentId": archive_folder["id"],
        }

        if current_parent_id == archive_folder["id"]:
            summary["alreadyArchived"].append(event)
            continue

        if args.execute:
            move_folder(client, root.folder_id, current_parent_id, archive_folder["id"])
        summary["moves"].append(event)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
