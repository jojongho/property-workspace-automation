# Property Workspace Automation

Google Sheets, Google Drive, Apps Script 기반의 부동산 운영 자동화 전용 standalone 저장소다.

현재 이 저장소는 다음 작업을 중심으로 구성한다.

- 분리된 매물 스프레드시트의 Drive 폴더 자동 생성
- 중앙 Apps Script 프로젝트 배포/동기화
- 기존 Drive 폴더 구조 마이그레이션
- Apps Script 운영용 웹앱 및 등록 스크립트 보관

공공데이터포털 건축물대장 API나 FastAPI 서버 코드는 이 저장소에서 제거했다.

## Structure

```text
property-workspace-automation/
├── apps-script/
│   ├── property-folder-automation/
│   ├── property-registration/
│   ├── webapp-dongho/
│   ├── webapp-multi-complex/
│   └── archive/
├── docs/
│   └── apps-script/
├── scripts/
├── Makefile
└── README.md
```

## Main Files

- `apps-script/property-folder-automation/g-drive-folder-create.js`
- `apps-script/property-folder-automation/g-drive-folder.js`
- `apps-script/property-folder-automation/appsscript.json`
- `scripts/gws_push_apps_script_project.py`
- `scripts/gws_export_apps_script_project.py`
- `scripts/gws_analyze_property_folder.py`
- `scripts/backfill_property_folder_links.py`
- `scripts/migrate_drive_folder_tree.py`
- `scripts/cleanup_empty_legacy_drive_folders.py`

## Quick Start

```bash
cd /Users/cao25/Projects/property-workspace-automation
gws auth login
make check
```

이 저장소는 상시 실행하는 서버가 없다. 대부분의 작업은 Apps Script 배포 또는 운영 스크립트 실행으로 끝난다.

## Common Commands

- `make check`
- `python3 scripts/gws_push_apps_script_project.py --script-id <SCRIPT_ID> --verify`
- `python3 scripts/gws_export_apps_script_project.py --script-id <SCRIPT_ID> --output-dir /tmp/exported-apps-script`
- `python3 scripts/gws_analyze_property_folder.py --folder-id <FOLDER_ID>`
- `python3 scripts/backfill_property_folder_links.py --canonical-sheet 건물 --row-start 2 --row-end 60`
- `python3 scripts/migrate_drive_folder_tree.py --summary-only`
- `python3 scripts/cleanup_empty_legacy_drive_folders.py`

## Docs

- `docs/apps-script/folder-automation.md`
- `apps-script/README.md`

## Notes

- `gws` CLI 인증이 선행돼야 한다.
- Apps Script 대량 복구는 편집기 실행보다 로컬 Python 스크립트를 우선 사용한다.
- 기존 Drive 폴더 데이터 이동은 삭제가 아니라 부모 변경과 병합 방식으로 처리한다.
