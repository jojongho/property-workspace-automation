#!/usr/bin/env python3
"""Export an Apps Script project to local files using gws auth credentials."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path


FILE_EXTENSION_MAP = {
    "server_js": ".js",
    "html": ".html",
    "json": ".json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-id", required=True, help="Apps Script project ID")
    parser.add_argument("--output-dir", required=True, help="Directory to write exported files into")
    parser.add_argument("--raw-output", default="", help="Optional path to save raw API JSON")
    return parser.parse_args()


def run_command(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"command failed: {' '.join(args)}"
        raise RuntimeError(message)
    return result.stdout


def run_json_command(command: list[str], input_text: str = "") -> dict:
    result = subprocess.run(command, input=input_text, capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"command failed: {' '.join(command)}"
        raise RuntimeError(message)
    return extract_json(result.stdout)


def extract_json(text: str) -> dict:
    lines = [line for line in text.splitlines() if line and not line.startswith("Using keyring backend:")]
    payload = "\n".join(lines).strip()
    if not payload:
        raise RuntimeError("No JSON payload returned")
    return json.loads(payload)


def get_gws_credentials() -> dict:
    return extract_json(run_command("gws", "auth", "export", "--unmasked"))


def mint_access_token(credentials: dict) -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": credentials["refresh_token"],
            "grant_type": "refresh_token",
        }
    )
    token_payload = run_json_command(
        [
            "curl",
            "-sS",
            "--fail-with-body",
            "https://oauth2.googleapis.com/token",
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "--data",
            payload,
        ]
    )
    return token_payload["access_token"]


def script_api_request(method: str, url: str, access_token: str) -> dict:
    return run_json_command(
        [
            "curl",
            "-sS",
            "--fail-with-body",
            "-X",
            method,
            url,
            "-H",
            f"Authorization: Bearer {access_token}",
        ]
    )


def build_filename(file_payload: dict) -> str:
    file_type = str(file_payload["type"]).lower()
    extension = FILE_EXTENSION_MAP.get(file_type)
    if extension is None:
        raise RuntimeError(f"Unsupported Apps Script file type: {file_payload['type']}")
    return f"{file_payload['name']}{extension}"


def write_project_files(files: list[dict], output_dir: Path) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for file_payload in files:
        filename = build_filename(file_payload)
        path = output_dir / filename
        path.write_text(file_payload.get("source", ""), encoding="utf-8")
        written.append(str(path))
    return written


def main() -> int:
    args = parse_args()
    credentials = get_gws_credentials()
    access_token = mint_access_token(credentials)
    content = script_api_request(
        "GET",
        f"https://script.googleapis.com/v1/projects/{args.script_id}/content",
        access_token,
    )

    if args.raw_output:
        Path(args.raw_output).write_text(
            json.dumps(content, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    written = write_project_files(content.get("files", []), Path(args.output_dir))
    summary = {
        "scriptId": args.script_id,
        "fileCount": len(content.get("files", [])),
        "writtenFiles": written,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
