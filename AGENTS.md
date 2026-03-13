# Property Workspace Automation

## Scope
- Google Apps Script 운영 코드
- Google Drive/Sheets 마이그레이션 및 유지보수 스크립트
- 부동산 업무용 웹앱/등록 스크립트 보관

## Rules
- Apps Script 배포 대상 소스는 `apps-script/` 아래에서 유지한다.
- Apps Script push/pull 헬퍼는 `scripts/` 아래에서 유지한다.
- 외부 연동 문서는 standalone repo 기준 경로만 사용한다.
- `gws` CLI 인증에 의존하는 스크립트는 별도 비밀키를 repo에 저장하지 않는다.
- 공공데이터 API, FastAPI 서버, 건축물대장 조회 코드는 다시 도입하지 않는다.

## Key Files
- `apps-script/property-folder-automation/g-drive-folder-create.js`
- `apps-script/property-folder-automation/g-drive-folder.js`
- `scripts/gws_push_apps_script_project.py`
- `scripts/backfill_property_folder_links.py`
- `scripts/migrate_drive_folder_tree.py`
