#!/usr/bin/env python3
"""Analyze split property spreadsheets in a Drive folder using gws CLI.

Features:
- Lists spreadsheet files under a Drive folder
- Reads sheet metadata and first-row headers
- Suggests PROJECT_CONFIG values for the Apps Script wrapper
- Optionally syncs non-owner spreadsheet permissions to an Apps Script project

This script shells out to `gws` and keeps all Google API access in the CLI.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


CANONICAL_SHEET_ALIASES = {
    "아파트": "아파트매물",
    "주택": "주택타운",
}

PRIMARY_SHEETS = {
    "아파트_앱시트DB": ["아파트"],
    "주택_앱시트DB": ["주택"],
    "토지_앱시트DB": ["토지"],
    "공장창고_앱시트DB": ["공장창고"],
    "근생_앱시트DB": ["건물", "상가", "원투룸"],
}

MANAGED_SHEET_SET = {"아파트", "주택", "토지", "공장창고", "건물", "상가", "원투룸"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder-id", required=True, help="Drive folder ID containing spreadsheet files")
    parser.add_argument("--script-project-id", help="Apps Script project Drive file ID")
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to write the analysis JSON report",
    )
    parser.add_argument(
        "--apply-permissions",
        action="store_true",
        help="Actually create missing permissions on the Apps Script project",
    )
    parser.add_argument(
        "--send-notification-email",
        action="store_true",
        help="Send share notification emails when creating missing permissions",
    )
    return parser.parse_args()


def run_gws(*args: str, params: dict | None = None, body: dict | None = None) -> dict:
    cmd = ["gws", *args]
    if params is not None:
        cmd.extend(["--params", json.dumps(params, ensure_ascii=False)])
    if body is not None:
        cmd.extend(["--json", json.dumps(body, ensure_ascii=False)])
    cmd.extend(["--format", "json"])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"gws exited with {result.returncode}"
        raise RuntimeError(message)

    if result.stdout.strip():
        return json.loads(result.stdout)

    combined = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
    return extract_json_from_text(combined)


def extract_json_from_text(text: str) -> dict:
    lines = [line for line in text.splitlines() if line and not line.startswith("Using keyring backend:")]
    cleaned = "\n".join(lines).strip()
    if not cleaned:
        raise RuntimeError("No JSON payload returned from gws")
    return json.loads(cleaned)


def list_folder_files(folder_id: str) -> list[dict]:
    response = run_gws(
        "drive",
        "files",
        "list",
        params={
            "q": f'"{folder_id}" in parents and trashed=false',
            "fields": "files(id,name,mimeType,parents,webViewLink),nextPageToken",
            "pageSize": 200,
            "supportsAllDrives": True,
            "includeItemsFromAllDrives": True,
        },
    )
    return response.get("files", [])


def get_file_metadata(file_id: str) -> dict:
    return run_gws(
        "drive",
        "files",
        "get",
        params={
            "fileId": file_id,
            "fields": "id,name,mimeType,parents,webViewLink,modifiedTime",
            "supportsAllDrives": True,
        },
    )


def list_permissions(file_id: str) -> list[dict]:
    response = run_gws(
        "drive",
        "permissions",
        "list",
        params={
            "fileId": file_id,
            "fields": "permissions(id,type,role,emailAddress,displayName)",
            "supportsAllDrives": True,
        },
    )
    return response.get("permissions", [])


def get_spreadsheet_structure(spreadsheet_id: str) -> dict:
    return run_gws(
        "sheets",
        "spreadsheets",
        "get",
        params={
            "spreadsheetId": spreadsheet_id,
            "fields": (
                "spreadsheetId,properties.title,"
                "sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)))"
            ),
        },
    )


def get_sheet_preview(spreadsheet_id: str, sheet_title: str) -> dict:
    response = run_gws(
        "sheets",
        "spreadsheets",
        "values",
        "get",
        params={
            "spreadsheetId": spreadsheet_id,
            "range": f"{sheet_title}!1:2",
        },
    )
    values = response.get("values", [])
    return {
        "headers": values[0] if len(values) > 0 else [],
        "sampleRow": values[1] if len(values) > 1 else [],
    }


def suggest_project_config(spreadsheet: dict) -> dict:
    title = spreadsheet["name"]
    candidate_sheets = PRIMARY_SHEETS.get(title, [])
    present = {sheet["properties"]["title"] for sheet in spreadsheet.get("sheets", [])}
    managed = [sheet for sheet in candidate_sheets if sheet in present]
    aliases = {
        actual: canonical
        for actual, canonical in CANONICAL_SHEET_ALIASES.items()
        if actual in managed
    }

    return {
        "managedSheets": managed,
        "webhookSheetName": managed[0] if managed else "",
        "buildingInfoSpreadsheetId": spreadsheet["id"] if "건물" in managed else "",
        "buildingInfoSheetName": "건물" if "건물" in managed else "",
        "sheetAliases": aliases,
    }


def build_permission_key(permission: dict) -> tuple[str, str, str]:
    return (
        permission.get("type", ""),
        permission.get("emailAddress", ""),
        permission.get("role", ""),
    )


def desired_script_permissions(spreadsheets: list[dict]) -> list[dict]:
    desired: dict[tuple[str, str, str], dict] = {}
    for spreadsheet in spreadsheets:
        for permission in spreadsheet.get("permissions", []):
            role = permission.get("role")
            if role == "owner":
                continue
            if permission.get("type") not in {"user", "group"}:
                continue
            key = build_permission_key(permission)
            desired[key] = {
                "type": permission["type"],
                "emailAddress": permission["emailAddress"],
                "role": role,
                "displayName": permission.get("displayName", ""),
                "sourceSpreadsheetIds": sorted(
                    {
                        *desired.get(key, {}).get("sourceSpreadsheetIds", []),
                        spreadsheet["id"],
                    }
                ),
            }
    return sorted(desired.values(), key=lambda item: (item["role"], item["emailAddress"]))


def sync_script_permissions(script_project_id: str, target_permissions: list[dict], apply: bool, send_email: bool) -> dict:
    script_meta = get_file_metadata(script_project_id)
    existing = list_permissions(script_project_id)
    existing_keys = {build_permission_key(permission) for permission in existing}

    missing = [
        permission
        for permission in target_permissions
        if build_permission_key(permission) not in existing_keys
    ]

    applied = []
    if apply:
        for permission in missing:
            result = run_gws(
                "drive",
                "permissions",
                "create",
                params={
                    "fileId": script_project_id,
                    "supportsAllDrives": True,
                    "sendNotificationEmail": send_email,
                    "fields": "id,type,role,emailAddress",
                },
                body={
                    "type": permission["type"],
                    "role": permission["role"],
                    "emailAddress": permission["emailAddress"],
                },
            )
            applied.append(result)
        existing = list_permissions(script_project_id)

    return {
        "metadata": script_meta,
        "existingPermissions": existing,
        "missingPermissions": missing,
        "appliedPermissions": applied,
    }


def analyze_folder(folder_id: str) -> dict:
    files = list_folder_files(folder_id)
    spreadsheets = []
    other_files = []

    for file in files:
        if file.get("mimeType") != "application/vnd.google-apps.spreadsheet":
            other_files.append(file)
            continue

        structure = get_spreadsheet_structure(file["id"])
        permissions = list_permissions(file["id"])
        sheets = []
        for sheet in structure.get("sheets", []):
            title = sheet["properties"]["title"]
            preview = get_sheet_preview(file["id"], title)
            sheets.append(
                {
                    "properties": sheet["properties"],
                    "headers": preview["headers"],
                    "sampleRow": preview["sampleRow"],
                }
            )

        spreadsheet = {
            "id": file["id"],
            "name": file["name"],
            "webViewLink": file.get("webViewLink", ""),
            "permissions": permissions,
            "sheets": sheets,
        }
        spreadsheet["projectConfigSuggestion"] = suggest_project_config(spreadsheet)
        spreadsheets.append(spreadsheet)

    spreadsheets.sort(key=lambda item: item["name"])
    other_files.sort(key=lambda item: item["name"])

    return {
        "folder": get_file_metadata(folder_id),
        "spreadsheets": spreadsheets,
        "otherFiles": other_files,
        "suggestedScriptPermissions": desired_script_permissions(spreadsheets),
    }


def main() -> int:
    args = parse_args()
    report = analyze_folder(args.folder_id)

    if args.script_project_id:
        report["scriptProject"] = sync_script_permissions(
            script_project_id=args.script_project_id,
            target_permissions=report["suggestedScriptPermissions"],
            apply=args.apply_permissions,
            send_email=args.send_notification_email,
        )

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output, encoding="utf-8")
        print(str(output_path))
    else:
        print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
