#!/usr/bin/env python3
"""Push local Apps Script source files to an Apps Script project."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path


DEFAULT_MANIFEST = Path("apps-script/property-folder-automation/appsscript.json")
DEFAULT_CODE_FILES = [
    Path("apps-script/property-folder-automation/g-drive-folder-create.js"),
    Path("apps-script/property-folder-automation/g-drive-folder.js"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-id", required=True, help="Apps Script project ID")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Local appsscript.json path")
    parser.add_argument(
        "--code-file",
        action="append",
        default=[],
        help="Local .js/.html source file to upload. Repeatable. Defaults to the property folder files.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the payload summary without uploading")
    parser.add_argument("--verify", action="store_true", help="Fetch project content again after upload")
    parser.add_argument("--raw-output", default="", help="Optional path to save the API response JSON")
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
    return extract_json(result.stdout) if result.stdout.strip() else {}


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


def read_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_file_payload(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".js":
        file_type = "SERVER_JS"
    elif suffix == ".html":
        file_type = "HTML"
    else:
        raise RuntimeError(f"Unsupported code file type: {path}")

    return {
        "name": path.stem,
        "type": file_type,
        "source": path.read_text(encoding="utf-8"),
    }


def build_project_content(manifest_path: Path, code_paths: list[Path]) -> dict:
    if not manifest_path.exists():
        raise RuntimeError(f"Manifest file not found: {manifest_path}")

    files = [
        {
            "name": "appsscript",
            "type": "JSON",
            "source": json.dumps(read_manifest(manifest_path), ensure_ascii=False, indent=2),
        }
    ]

    for code_path in code_paths:
        if not code_path.exists():
            raise RuntimeError(f"Code file not found: {code_path}")
        files.append(build_file_payload(code_path))

    return {"files": files}


def summarize_payload(project_content: dict) -> dict:
    summary_files = []
    for file_payload in project_content["files"]:
        summary_files.append(
            {
                "name": file_payload["name"],
                "type": file_payload["type"],
                "chars": len(file_payload["source"]),
            }
        )
    return {"fileCount": len(summary_files), "files": summary_files}


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest)
    code_paths = [Path(path) for path in (args.code_file or [str(path) for path in DEFAULT_CODE_FILES])]
    project_content = build_project_content(manifest_path, code_paths)
    summary = summarize_payload(project_content)

    if args.dry_run:
        print(json.dumps({"scriptId": args.script_id, "dryRun": True, **summary}, ensure_ascii=False, indent=2))
        return 0

    credentials = get_gws_credentials()
    access_token = mint_access_token(credentials)
    response = script_api_request(
        "PUT",
        f"https://script.googleapis.com/v1/projects/{args.script_id}/content",
        access_token,
        project_content,
    )

    if args.verify:
        verify_response = script_api_request(
            "GET",
            f"https://script.googleapis.com/v1/projects/{args.script_id}/content",
            access_token,
        )
        response = {
            "update": response,
            "verify": {
                "fileCount": len(verify_response.get("files", [])),
                "files": [
                    {"name": file_payload["name"], "type": file_payload["type"]}
                    for file_payload in verify_response.get("files", [])
                ],
            },
        }

    if args.raw_output:
        Path(args.raw_output).write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"scriptId": args.script_id, **summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
