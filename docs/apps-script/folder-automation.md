# Folder Automation

분리된 매물 스프레드시트 여러 개를 중앙 Apps Script 프로젝트 하나에서 관리하는 운영 문서다.

## Related Files

- `apps-script/property-folder-automation/g-drive-folder-create.js`
- `apps-script/property-folder-automation/g-drive-folder.js`
- `apps-script/property-folder-automation/appsscript.json`
- `scripts/gws_push_apps_script_project.py`
- `scripts/gws_export_apps_script_project.py`
- `scripts/gws_analyze_property_folder.py`
- `scripts/backfill_property_folder_links.py`
- `scripts/migrate_drive_folder_tree.py`
- `scripts/cleanup_empty_legacy_drive_folders.py`

## Current Setup

- 최상위 폴더 ID: `1OhHhbs4OGvRu8174U6kqRex7if7bFbcz`
- 중앙 Apps Script 프로젝트가 각 스프레드시트의 설치형 트리거를 받아 처리한다.
- 시트 별칭:
  - `아파트 -> 아파트매물`
  - `주택 -> 주택타운`
- 건물 기준정보는 `근생_앱시트DB`의 `건물` 시트를 사용한다.

## Apps Script Functions

- `listManagedSpreadsheetTriggers()`
- `setupManagedSpreadsheetTriggers()`
- `resetManagedSpreadsheetTriggers()`
- `backfillManagedSpreadsheetFolders()`
- `backfillApartmentSheetFolders()`
- `backfillTownSheetFolders()`
- `backfillStudioSheetFolders()`
- `backfillLandSheetFolders()`
- `backfillFactorySheetFolders()`
- `continueBuildingSheetBackfill()`
- `continueRetailSheetBackfill()`

## Safety Rules

- 기존 폴더 삭제는 하지 않는다.
- 폴더 생성은 같은 부모 아래 같은 이름 폴더를 재사용하는 `getOrCreateFolder(...)` 패턴으로 동작한다.
- 시트의 `관련파일`, `폴더ID`가 이미 채워져 있으면 건너뛴다.
- 주소 정보가 부족할 때는 같은 단지/주택단지의 다른 행을 참고하는 정도까지만 자동 보완한다.

## Local Recovery Principle

대량 backfill이나 마이그레이션은 Apps Script 편집기보다 로컬 스크립트를 우선 사용한다.

이유:

- Apps Script 실행 시간 제한이 있다.
- 대형 시트는 수백 행 단위에서 타임아웃이 날 수 있다.
- 로컬 스크립트는 chunk 재개와 재시도가 쉽다.

예시:

```bash
python3 -u scripts/backfill_property_folder_links.py --canonical-sheet 건물 --row-start 2 --row-end 60
python3 -u scripts/migrate_drive_folder_tree.py --summary-only
python3 -u scripts/cleanup_empty_legacy_drive_folders.py
```
