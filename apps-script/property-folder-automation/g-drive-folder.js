/**
 * 분리된 매물 스프레드시트를 중앙 Apps Script 프로젝트 하나로 관리하기 위한 설정.
 *
 * 실제 시트명과 기존 로직의 canonical 이름이 다른 경우:
 * - 아파트 -> 아파트매물
 * - 주택 -> 주택타운
 *
 * 사용 순서:
 * 1. 이 파일과 g-drive-folder-create.js를 Apps Script 프로젝트에 push
 * 2. Apps Script 편집기에서 setupManagedSpreadsheetTriggers() 1회 실행
 * 3. 각 분리 스프레드시트의 편집/행추가 이벤트를 중앙 프로젝트가 처리
 *
 * 운영용 수동 함수:
 * - listManagedSpreadsheetTriggers()
 * - setupManagedSpreadsheetTriggers()
 * - resetManagedSpreadsheetTriggers()
 * - backfillManagedSpreadsheetFolders()
 * - continueBuildingSheetBackfill()
 * - continueRetailSheetBackfill()
 *
 * 대량 복구/마이그레이션은 Apps Script 편집기보다
 * scripts/backfill_property_folder_links.py 를 우선 사용한다.
 */
const PROJECT_CONFIG = {
  managedSheets: ['아파트매물', '아파트단지', '주택타운', '건물', '상가', '원투룸', '토지', '공장창고'],
  webhookSheetName: '아파트매물',
  buildingInfoSpreadsheetId: '1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E',
  buildingInfoSheetName: '건물',
  sheetAliases: {
    '아파트': '아파트매물',
    '주택': '주택타운'
  },
  triggerSpreadsheetIds: [
    '1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ', // 아파트_앱시트DB
    '1V3PVwVRFbHbrOu2JKlE1xlDVCosHy08hPUeX5HojYoU', // 주택_앱시트DB
    '1XLzFUR5yRaop74f-1tRva0TMckO1NQ2zG4p2P4-UY_E', // 근생_앱시트DB
    '1mGWLvOXUkANttGS0YBQYGgJzB9Af9oivc0uskkB6bsw', // 토지_앱시트DB
    '1GPtVtbDJEVnXuYGFnCgaA6vcigt8khdw_0-nCg7pD5U'  // 공장창고_앱시트DB
  ]
};
