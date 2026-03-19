# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google Workspace automation for real estate property management. Manages Google Sheets, Drive folders, and Apps Script projects for apartment/house/land/store/factory property workflows.

**Out of scope (do not reintroduce):** public data APIs, FastAPI server, 건축물대장 조회 코드.

## Commands

```bash
make venv       # Create Python virtual environment (.venv/)
make install    # Install Python dependencies into .venv
make check      # Validate syntax: Python (py_compile) + JS (node --check)
make clean      # Remove .venv
```

Run a single Python script (always use the venv):
```bash
.venv/bin/python scripts/<script_name>.py
```

## Architecture

**Two layers, no persistent server:**

1. **`apps-script/`** — Apps Script projects deployed to Google. Each subdirectory is a self-contained project with its own `appsscript.json`. Triggered by Google Sheets events or run manually.
   - `property-folder-automation/` — Central folder manager. Reads `PROJECT_CONFIG` (array of 8 managed sheets across 5 trigger spreadsheets) and auto-creates Drive folders on sheet edits.
   - `apartment-entry-automation/` — Form automation for apartment unit entry with price model support.
   - `webapp-dongho/`, `webapp-multi-complex/` — Customer intake web apps.
   - `property-registration/` — Property listing and option scripts (mixed `.gs`/`.js`).

2. **`scripts/`** — Python scripts for batch/migration operations. All Google API access goes through the `gws` CLI (no API keys stored in repo).
   - `gws_push_apps_script_project.py` / `gws_export_apps_script_project.py` — Sync local `apps-script/` ↔ Google Apps Script.
   - `backfill_property_folder_links.py` — Backfill Drive folder links into Sheets rows.
   - `migrate_notion_property_dbs_to_sheets.py` — Upsert Notion DB rows into Google Sheets (largest script, handles all property types).
   - `migrate_drive_folder_tree.py`, `migrate_to_type_root_structure.py` — Drive folder reorganization (regional → type-based hierarchy).

## Key Conventions

- All Google Workspace auth uses `gws` CLI — no credentials or tokens stored in the repo.
- Apps Script source lives under `apps-script/`; push/pull helpers live under `scripts/`.
- Python scripts use the standard library only (no pip packages except what's in `requirements.txt`).
- Bulk/batch Drive operations should use Python scripts, not Apps Script (see `docs/apps-script/folder-automation.md`).
- Path references in docs and scripts use standalone repo-relative paths only.

## Key Docs

- `docs/apps-script/folder-automation.md` — Folder IDs, sheet aliases, function reference, safety rules for Drive automation.
- `docs/apps-script/apartment-entry-price-model.md` — Price model design spec for apartment entry form.
- `docs/apps-script/notion-property-db-migration-status.md` — Notion → Sheets migration status per property type.
