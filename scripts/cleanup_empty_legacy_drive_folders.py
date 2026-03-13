#!/usr/bin/env python3
"""Delete empty legacy Drive folders after migration."""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from dataclasses import dataclass


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from migrate_drive_folder_tree import DriveClient  # noqa: E402


@dataclass(frozen=True)
class LegacyRoot:
    folder_id: str
    name: str


LEGACY_ROOTS = [
    LegacyRoot("15pAF4y29BJfqMNYfGi0afdSsy7IFv8JV", "1. 천안"),
    LegacyRoot("1ff1LP53iS1jzua3tNHFZb-vttdeqnt03", "2. 아산"),
]


class Cleaner:
    def __init__(self, client: DriveClient, execute: bool) -> None:
        self.client = client
        self.execute = execute
        self.deleted: list[dict] = []
        self.skipped: list[dict] = []

    def delete_folder(self, folder_id: str, name: str, path: str) -> None:
        if self.execute:
            subprocess.run(
                [
                    "gws",
                    "drive",
                    "files",
                    "delete",
                    "--params",
                    json.dumps({"fileId": folder_id, "supportsAllDrives": True}),
                    "--format",
                    "json",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        self.deleted.append(
            {
                "folderId": folder_id,
                "name": name,
                "path": path,
                "mode": "execute" if self.execute else "dry-run",
            }
        )

    def cleanup_folder(self, folder_id: str, path: str) -> bool:
        children = self.client.list_children(folder_id)
        folder_children = [child for child in children if child["mimeType"] == "application/vnd.google-apps.folder"]
        file_children = [child for child in children if child["mimeType"] != "application/vnd.google-apps.folder"]

        for child in folder_children:
            child_path = f"{path}/{child['name']}"
            self.cleanup_folder(child["id"], child_path)

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

        self.delete_folder(folder_id, path.split("/")[-1], path)
        return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Actually delete empty folders. Default is dry-run.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = DriveClient()
    cleaner = Cleaner(client, execute=args.execute)

    for root in LEGACY_ROOTS:
        cleaner.cleanup_folder(root.folder_id, root.name)

    summary = {
        "mode": "execute" if args.execute else "dry-run",
        "deletedCount": len(cleaner.deleted),
        "skippedCount": len(cleaner.skipped),
        "deleted": cleaner.deleted,
        "skipped": cleaner.skipped[:50],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
