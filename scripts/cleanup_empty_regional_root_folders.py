#!/usr/bin/env python3
"""Delete empty legacy regional folders left under the root property folder."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse
from dataclasses import dataclass


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from migrate_drive_folder_tree import DriveClient  # noqa: E402


@dataclass(frozen=True)
class LegacyRoot:
    folder_id: str
    name: str


REGIONAL_ROOTS = [
    LegacyRoot("1A2vdRXHSrP68Aunie_Gt7Xl3EB4BkNLe", "아산시"),
    LegacyRoot("1-MAMArm-yq8YxdQYwHVugNQGkhKS8qhK", "천안시 서북구"),
    LegacyRoot("1bd7p1_V3MKbXQyxI_lzd_I38vgm1wiTR", "천안시 동남구"),
    LegacyRoot("1-ucGlLmC3h0QY59xi81JQOpWiohitibP", "타지역"),
]

FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"


class Cleaner:
    def __init__(self, client: DriveClient, execute: bool) -> None:
        self.client = client
        self.execute = execute
        self.deleted: list[dict] = []
        self.skipped: list[dict] = []

    def delete_folder(self, folder_id: str, name: str, path: str) -> None:
        if self.execute:
            params = urllib.parse.urlencode({"supportsAllDrives": "true"})
            url = f"https://www.googleapis.com/drive/v3/files/{folder_id}?{params}"
            self.client.request("DELETE", url)

        self.deleted.append(
            {
                "folderId": folder_id,
                "name": name,
                "path": path,
                "mode": "execute" if self.execute else "dry-run",
            }
        )

    def cleanup_folder(self, folder_id: str, path: str, delete_self: bool = True) -> bool:
        children = self.client.list_children(folder_id)
        folder_children = [child for child in children if child["mimeType"] == FOLDER_MIME_TYPE]

        for child in folder_children:
            child_path = f"{path}/{child['name']}"
            self.cleanup_folder(child["id"], child_path, delete_self=True)

        self.client.invalidate_parent_cache(folder_id)
        remaining_children = self.client.list_children(folder_id)

        if remaining_children:
            self.skipped.append(
                {
                    "folderId": folder_id,
                    "path": path,
                    "reason": "not-empty",
                    "remainingCount": len(remaining_children),
                }
            )
            return False

        if delete_self:
            try:
                self.delete_folder(folder_id, path.split("/")[-1], path)
            except Exception as error:
                self.skipped.append(
                    {
                        "folderId": folder_id,
                        "path": path,
                        "reason": "delete-failed",
                        "error": str(error),
                    }
                )
                return False
        return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Actually delete empty folders. Default is dry-run.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = DriveClient()
    cleaner = Cleaner(client, execute=args.execute)

    for root in REGIONAL_ROOTS:
        cleaner.cleanup_folder(root.folder_id, root.name, delete_self=True)

    summary = {
        "mode": "execute" if args.execute else "dry-run",
        "deletedCount": len(cleaner.deleted),
        "skippedCount": len(cleaner.skipped),
        "deleted": cleaner.deleted[:200],
        "skipped": cleaner.skipped[:200],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
