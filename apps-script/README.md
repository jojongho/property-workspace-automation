# Apps Script Assets

부동산 운영 자동화에 쓰는 Apps Script 소스를 기능별로 분리해 둔 디렉토리다.

## Layout

```text
apps-script/
├── property-folder-automation/
│   ├── appsscript.json
│   ├── g-drive-folder-create.js
│   └── g-drive-folder.js
├── property-registration/
├── webapp-dongho/
├── webapp-multi-complex/
└── archive/
```

## Main Directories

### `property-folder-automation/`

분리된 AppSheet 매물 스프레드시트들의 Drive 폴더를 중앙 Apps Script 프로젝트 하나에서 관리하는 코드다.

핵심 파일:

- `g-drive-folder-create.js`
- `g-drive-folder.js`
- `appsscript.json`

주요 운영 함수:

- `setupManagedSpreadsheetTriggers()`
- `listManagedSpreadsheetTriggers()`
- `resetManagedSpreadsheetTriggers()`
- `backfillManagedSpreadsheetFolders()`
- `continueBuildingSheetBackfill()`
- `continueRetailSheetBackfill()`

상세 운영 문서:

- `../docs/apps-script/folder-automation.md`

### `property-registration/`

매물 등록, 옵션 불러오기, 통합 등록 스크립트 보관용 디렉토리다.

### `webapp-dongho/`

동/호 선택 기반 고객 접수 웹앱 자산이다.

### `webapp-multi-complex/`

다중 단지 매물 접수 웹앱 자산이다.

### `archive/`

더 이상 운영하지 않는 레거시 스크립트 보관소다.

## Deployment Note

로컬에서 Apps Script 파일을 수정한 뒤 중앙 프로젝트에 반영할 때는 `scripts/gws_push_apps_script_project.py`를 사용한다.
