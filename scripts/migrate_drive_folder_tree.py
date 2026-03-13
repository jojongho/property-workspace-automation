#!/usr/bin/env python3
"""Merge legacy Drive folder trees into the new property folder structure."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass


FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"


@dataclass(frozen=True)
class FolderMapping:
    source_id: str
    source_name: str
    target_id: str
    target_name: str


DEFAULT_MAPPINGS = [
    FolderMapping("1ff1LP53iS1jzua3tNHFZb-vttdeqnt03", "2. 아산", "1A2vdRXHSrP68Aunie_Gt7Xl3EB4BkNLe", "아산시"),
    FolderMapping("1rmqDoI2gHi-QfE2icvUKlHlrkELJwRRf", "1. 천안/1. 서북구", "1-MAMArm-yq8YxdQYwHVugNQGkhKS8qhK", "천안시 서북구"),
    FolderMapping("1r2L3FBY8NAPys2OaZmmNzpGzHvcP6uLg", "1. 천안/2. 동남구", "1bd7p1_V3MKbXQyxI_lzd_I38vgm1wiTR", "천안시 동남구"),
]


class DriveClient:
    def __init__(self) -> None:
        self.access_token = self._mint_access_token()
        self.child_cache: dict[str, list[dict]] = {}
        self.folder_lookup_cache: dict[tuple[str, str], list[dict]] = {}

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

    def invalidate_parent_cache(self, parent_id: str) -> None:
        self.child_cache.pop(parent_id, None)
        stale = [key for key in self.folder_lookup_cache if key[0] == parent_id]
        for key in stale:
            self.folder_lookup_cache.pop(key, None)

    def list_children(self, parent_id: str) -> list[dict]:
        cached = self.child_cache.get(parent_id)
        if cached is not None:
            return cached

        fields = "nextPageToken,files(id,name,mimeType,parents,md5Checksum,size,webViewLink)"
        page_token = None
        files: list[dict] = []

        while True:
            params = {
                "q": f"'{parent_id}' in parents and trashed = false",
                "fields": fields,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageSize": "1000",
                "orderBy": "folder,name_natural",
            }
            if page_token:
                params["pageToken"] = page_token
            url = f"https://www.googleapis.com/drive/v3/files?{urllib.parse.urlencode(params)}"
            response = self.request("GET", url)
            files.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        self.child_cache[parent_id] = files
        return files

    def find_named_folders(self, parent_id: str, name: str) -> list[dict]:
        cache_key = (parent_id, name)
        cached = self.folder_lookup_cache.get(cache_key)
        if cached is not None:
            return cached

        matches = [
            child
            for child in self.list_children(parent_id)
            if child["mimeType"] == FOLDER_MIME_TYPE and child["name"] == name
        ]
        self.folder_lookup_cache[cache_key] = matches
        return matches

    def move_item(self, file_id: str, old_parent: str, new_parent: str) -> dict:
        params = urllib.parse.urlencode(
            {
                "addParents": new_parent,
                "removeParents": old_parent,
                "supportsAllDrives": "true",
                "fields": "id,name,parents,webViewLink",
            }
        )
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?{params}"
        result = self.request("PATCH", url, {})
        self.invalidate_parent_cache(old_parent)
        self.invalidate_parent_cache(new_parent)
        return result


class Migrator:
    def __init__(self, client: DriveClient, execute: bool, emit_events: bool = True) -> None:
        self.client = client
        self.execute = execute
        self.emit_events = emit_events
        self.stats = {
            "folders_moved_wholesale": 0,
            "files_moved": 0,
            "folder_merges": 0,
            "duplicate_folder_matches": 0,
        }
        self.events: list[dict] = []

    def log(self, event: dict) -> None:
        self.events.append(event)
        if self.emit_events:
            print(json.dumps(event, ensure_ascii=False), flush=True)

    def move_item(self, item: dict, old_parent: str, new_parent: str, path: str) -> None:
        if self.execute:
            self.client.move_item(item["id"], old_parent, new_parent)

        event = {
            "action": "move",
            "mode": "execute" if self.execute else "dry-run",
            "itemId": item["id"],
            "name": item["name"],
            "mimeType": item["mimeType"],
            "fromParent": old_parent,
            "toParent": new_parent,
            "path": path,
        }
        self.log(event)

        if item["mimeType"] == FOLDER_MIME_TYPE:
            self.stats["folders_moved_wholesale"] += 1
        else:
            self.stats["files_moved"] += 1

    def migrate_parent(self, source_parent_id: str, target_parent_id: str, path_prefix: str) -> None:
        children = self.client.list_children(source_parent_id)

        for child in children:
            child_path = f"{path_prefix}/{child['name']}" if path_prefix else child["name"]
            if child["mimeType"] != FOLDER_MIME_TYPE:
                self.move_item(child, source_parent_id, target_parent_id, child_path)
                continue

            matches = self.client.find_named_folders(target_parent_id, child["name"])
            if matches:
                target_folder = matches[0]
                if len(matches) > 1:
                    self.stats["duplicate_folder_matches"] += len(matches) - 1
                    self.log(
                        {
                            "action": "duplicate-target-folder-match",
                            "mode": "execute" if self.execute else "dry-run",
                            "path": child_path,
                            "targetParentId": target_parent_id,
                            "matchIds": [item["id"] for item in matches],
                        }
                    )

                self.stats["folder_merges"] += 1
                self.log(
                    {
                        "action": "merge-folder",
                        "mode": "execute" if self.execute else "dry-run",
                        "sourceFolderId": child["id"],
                        "targetFolderId": target_folder["id"],
                        "path": child_path,
                    }
                )
                self.migrate_parent(child["id"], target_folder["id"], child_path)
                continue

            self.move_item(child, source_parent_id, target_parent_id, child_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Perform the move operations. Default is dry-run.")
    parser.add_argument("--summary-only", action="store_true", help="Print final summary only.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = DriveClient()
    migrator = Migrator(client, execute=args.execute, emit_events=not args.summary_only)

    summary = {
        "mode": "execute" if args.execute else "dry-run",
        "mappings": [],
    }

    for mapping in DEFAULT_MAPPINGS:
        migrator.log(
            {
                "action": "start-mapping",
                "mode": summary["mode"],
                "sourceId": mapping.source_id,
                "sourceName": mapping.source_name,
                "targetId": mapping.target_id,
                "targetName": mapping.target_name,
            }
        )
        migrator.migrate_parent(mapping.source_id, mapping.target_id, mapping.source_name)
        summary["mappings"].append(
            {
                "sourceId": mapping.source_id,
                "sourceName": mapping.source_name,
                "targetId": mapping.target_id,
                "targetName": mapping.target_name,
            }
        )

    summary.update(migrator.stats)
    if args.summary_only:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        migrator.log({"action": "summary", **summary})
    return 0


if __name__ == "__main__":
    sys.exit(main())
