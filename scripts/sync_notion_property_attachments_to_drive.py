#!/usr/bin/env python3
"""Sync Notion attachment URLs into Drive folders referenced by sheet rows."""

from __future__ import annotations

import argparse
import json
import mimetypes
import subprocess
import tempfile
import urllib.parse
from pathlib import Path
from typing import Any

from migrate_notion_property_dbs_to_sheets import (  # noqa: E402
    DATASET_CONFIGS,
    GoogleApiClient,
    build_natural_keys,
    collapse_space,
    fill_identity_fields,
    load_rows,
    make_header_index,
    normalize_input_rows,
    normalize_text,
    read_json_file,
    row_dict_from_sheet,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, choices=sorted(DATASET_CONFIGS))
    parser.add_argument("--input", required=True, help="JSON file with rows")
    parser.add_argument(
        "--input-mode",
        default="normalized",
        choices=["normalized", "raw"],
        help="normalized rows must carry __attachments; raw rows use dataset file column mapping",
    )
    parser.add_argument("--lookup", help="Optional lookup JSON for raw row normalization")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def decode_notion_file_item(item: str) -> dict[str, Any] | None:
    text = normalize_text(item)
    if not text:
        return None
    if text.startswith("file://"):
        payload = text[len("file://") :]
        payload = urllib.parse.unquote(payload)
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return {"source": text, "fileName": ""}
        source = normalize_text(data.get("source"))
        return {
            "source": source,
            "fileName": infer_file_name(source),
            "raw": data,
        }
    if text.startswith("http://") or text.startswith("https://"):
        return {"source": text, "fileName": infer_file_name(text)}
    return {"source": text, "fileName": infer_file_name(text)}


def infer_file_name(source: str) -> str:
    text = normalize_text(source)
    if not text:
        return ""
    if text.startswith("attachment:"):
        parts = text.split(":")
        if len(parts) >= 3:
            return parts[-1]
    parsed = urllib.parse.urlparse(text)
    filename = Path(urllib.parse.unquote(parsed.path)).name
    return filename or "attachment"


def extract_attachment_descriptors(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        items = [normalize_text(item) for item in value if normalize_text(item)]
    else:
        text = normalize_text(value)
        if not text:
            return []
        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = [text]
            items = [normalize_text(item) for item in parsed if normalize_text(item)]
        else:
            items = [text]
    result: list[dict[str, Any]] = []
    for item in items:
        decoded = decode_notion_file_item(item)
        if decoded:
            result.append(decoded)
    return result


RAW_ATTACHMENT_COLUMNS: dict[str, list[str]] = {
    "land": ["토지대장", "관련자료"],
    "factory": ["매물사진", "관련자료"],
    "building": ["건축물대장", "건물사진", "관련파일", "관련자료"],
    "store": ["건축물대장", "관련파일"],
    "apartment_complex": [
        "아파트로고",
        "투시도",
        "조감도",
        "입지환경",
        "단지배치도",
        "동호수배치도",
        "입주자모집공고문",
        "관련자료",
    ],
}


def load_attachment_rows(
    dataset: str,
    input_mode: str,
    rows: list[dict[str, Any]],
    lookup_payload: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if input_mode == "normalized":
        prepared: list[dict[str, Any]] = []
        for row in rows:
            copied = dict(row)
            copied["__source_url"] = normalize_text(copied.get("__source_url") or copied.get("url"))
            attachments = copied.get("__attachments") or []
            normalized_attachments: list[dict[str, Any]] = []
            if isinstance(attachments, list):
                for item in attachments:
                    if isinstance(item, dict):
                        normalized_attachments.append(item)
                    else:
                        normalized_attachments.extend(extract_attachment_descriptors(item))
            copied["__attachments"] = normalized_attachments
            prepared.append(copied)
        return prepared

    from migrate_notion_property_dbs_to_sheets import build_lookup_maps  # local import

    lookups = build_lookup_maps(lookup_payload)
    normalized_rows = normalize_input_rows(dataset, "raw", rows, lookups)
    attachment_columns = RAW_ATTACHMENT_COLUMNS.get(dataset, [])
    prepared = []
    for raw_row, normalized_row in zip(rows, normalized_rows):
        attachments: list[dict[str, Any]] = []
        for column in attachment_columns:
            for descriptor in extract_attachment_descriptors(raw_row.get(column)):
                descriptor["column"] = column
                attachments.append(descriptor)
        if not attachments:
            continue
        copied = dict(normalized_row)
        copied["__attachments"] = attachments
        prepared.append(copied)
    return prepared


class DriveSyncClient(GoogleApiClient):
    def __init__(self) -> None:
        super().__init__()
        self.file_cache_by_parent: dict[str, dict[str, dict[str, Any]]] = {}

    def list_child_files(self, parent_id: str) -> dict[str, dict[str, Any]]:
        cached = self.file_cache_by_parent.get(parent_id)
        if cached is not None:
            return cached
        q = f"trashed = false and '{parent_id}' in parents"
        params = urllib.parse.urlencode(
            {
                "q": q,
                "fields": "files(id,name,webViewLink,mimeType,parents)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageSize": "1000",
            }
        )
        url = f"https://www.googleapis.com/drive/v3/files?{params}"
        files = self.request("GET", url).get("files", [])
        mapping = {normalize_text(item.get("name")): item for item in files if normalize_text(item.get("name"))}
        self.file_cache_by_parent[parent_id] = mapping
        return mapping

    def download_url(self, url: str, output_path: Path) -> None:
        command = [
            "curl",
            "-sS",
            "--fail-with-body",
            "--retry",
            "5",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "-L",
            url,
            "-o",
            str(output_path),
        ]
        subprocess.run(command, check=True, capture_output=True, text=False)

    def upload_file(self, parent_id: str, file_path: Path, file_name: str) -> dict[str, Any]:
        mime_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        metadata = json.dumps({"name": file_name, "parents": [parent_id]}, ensure_ascii=False)
        command = [
            "curl",
            "-sS",
            "--fail-with-body",
            "--retry",
            "5",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "-X",
            "POST",
            (
                "https://www.googleapis.com/upload/drive/v3/files"
                "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,mimeType"
            ),
            "-H",
            f"Authorization: Bearer {self.access_token}",
            "-F",
            f"metadata={metadata};type=application/json; charset=UTF-8",
            "-F",
            f"file=@{file_path};type={mime_type}",
        ]
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        uploaded = json.loads(result.stdout)
        self.file_cache_by_parent.setdefault(parent_id, {})[file_name] = uploaded
        return uploaded


def match_sheet_row_number(
    dataset: str,
    header: list[str],
    existing_rows: list[list[Any]],
    incoming_row: dict[str, Any],
) -> int | None:
    row_id = collapse_space(incoming_row.get("ID"))
    natural_keys = build_natural_keys(dataset, incoming_row)
    for row_number, row in enumerate(existing_rows, start=2):
        row_dict = row_dict_from_sheet(header, row)
        if row_id and collapse_space(row_dict.get("ID")) == row_id:
            return row_number
        row_keys = build_natural_keys(dataset, row_dict)
        if any(key and key in row_keys for key in natural_keys):
            return row_number
    return None


def main() -> int:
    args = parse_args()
    config = DATASET_CONFIGS[args.dataset]
    rows_payload = read_json_file(Path(args.input))
    rows = load_rows(rows_payload)
    lookup_payload = read_json_file(Path(args.lookup)) if args.lookup else None
    prepared_rows = load_attachment_rows(args.dataset, args.input_mode, rows, lookup_payload)

    client = DriveSyncClient()
    sheet_rows = client.get_sheet_values(config.spreadsheet_id, config.sheet_name)
    if not sheet_rows:
        raise RuntimeError(f"Target sheet is empty: {config.sheet_name}")

    header = [normalize_text(value) for value in sheet_rows[0]]
    existing_rows = sheet_rows[1:]
    index = make_header_index(header)
    folder_col = index.get("폴더ID")
    if folder_col is None:
        raise RuntimeError(f"Sheet has no 폴더ID column: {config.sheet_name}")

    summary = {
        "dataset": args.dataset,
        "rows_with_attachments": 0,
        "matched_rows": 0,
        "uploaded_files": 0,
        "skipped_existing": 0,
        "unsupported_sources": 0,
        "missing_folders": 0,
        "missing_sheet_rows": 0,
        "failed_downloads": 0,
        "dry_run": args.dry_run,
    }

    with tempfile.TemporaryDirectory(prefix="notion-attachment-sync-") as temp_dir:
        temp_root = Path(temp_dir)
        for row in prepared_rows:
            fill_identity_fields(args.dataset, config, row)
            attachments = row.get("__attachments") or []
            if not attachments:
                continue
            summary["rows_with_attachments"] += 1

            row_number = match_sheet_row_number(args.dataset, header, existing_rows, row)
            if row_number is None:
                summary["missing_sheet_rows"] += 1
                continue
            summary["matched_rows"] += 1

            sheet_row = existing_rows[row_number - 2]
            folder_id = normalize_text(sheet_row[folder_col]) if folder_col < len(sheet_row) else ""
            if not folder_id:
                summary["missing_folders"] += 1
                continue

            existing_files = client.list_child_files(folder_id)
            for attachment in attachments:
                source = normalize_text(attachment.get("source"))
                file_name = normalize_text(attachment.get("fileName")) or "attachment"
                if not source:
                    continue
                if source.startswith("attachment:"):
                    summary["unsupported_sources"] += 1
                    continue
                if file_name in existing_files:
                    summary["skipped_existing"] += 1
                    continue
                if args.dry_run:
                    summary["uploaded_files"] += 1
                    existing_files[file_name] = {"id": "dry-run", "name": file_name}
                    continue

                destination = temp_root / file_name
                try:
                    client.download_url(source, destination)
                except subprocess.CalledProcessError:
                    summary["failed_downloads"] += 1
                    continue

                client.upload_file(folder_id, destination, file_name)
                summary["uploaded_files"] += 1
                existing_files[file_name] = {"id": "uploaded", "name": file_name}
                destination.unlink(missing_ok=True)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
