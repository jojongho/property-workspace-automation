#!/usr/bin/env python3
"""Create a standalone or container-bound Apps Script project using gws auth credentials."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", required=True, help="Apps Script project title")
    parser.add_argument("--parent-id", default="", help="Optional Drive file ID to create a bound script")
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


def script_api_request(method: str, url: str, access_token: str, payload: dict | None = None) -> dict:
    command = [
        "curl",
        "-sS",
        "--fail-with-body",
        "-X",
        method,
        url,
        "-H",
        f"Authorization: Bearer {access_token}",
    ]
    input_text = ""
    if payload is not None:
        command.extend(["-H", "Content-Type: application/json", "--data-binary", "@-"])
        input_text = json.dumps(payload, ensure_ascii=False)
    return run_json_command(command, input_text=input_text)


def main() -> int:
    args = parse_args()
    credentials = get_gws_credentials()
    access_token = mint_access_token(credentials)

    payload = {"title": args.title}
    if args.parent_id:
        payload["parentId"] = args.parent_id

    response = script_api_request(
        "POST",
        "https://script.googleapis.com/v1/projects",
        access_token,
        payload,
    )

    if args.raw_output:
        Path(args.raw_output).write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "scriptId": response.get("scriptId", ""),
                "title": response.get("title", ""),
                "parentId": response.get("parentId", ""),
                "createTime": response.get("createTime", ""),
                "updateTime": response.get("updateTime", ""),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
