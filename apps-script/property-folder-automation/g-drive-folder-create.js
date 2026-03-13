/**
 * 구글시트에서 호출하는 Google Drive 폴더 자동 생성 Apps Script
 *
 * ✅ 통합 폴더 구조 (최상위 폴더 통합):
 * - 모든 매물 유형: 통합매물데이터(지역별)/시군구/동읍면/통반리/[매물별 규칙]
 * 
 * 매물별 하위 구조 (기존 규칙 유지):
 * - 아파트: 시군구/동읍면/통반리/지번 단지명/-매물/동-호-타입
 * - 주택타운: 시군구/동읍면/통반리/[주택유형별 규칙]
 * - 건물/상가/원투룸: 시군구/동읍면/통반리/지번 건물명/[상가매물|원투룸매물]/[리프 폴더]
 * - 토지: 시군구/동읍면/통반리/지번 토지분류
 * - 공장창고: 시군구/동읍면/통반리/지번 명칭
 *
 * @param {Object} e - AppSheet webhook POST 데이터 (doPost용)
 * @return {Object} - 생성된 폴더 정보
 */

// 통합 최상위 폴더 ID
// - 모든 매물 유형이 같은 최상위 폴더를 사용
// - 하위 폴더 규칙만 유형별로 달라짐
const ROOT_FOLDER_ID = '1OhHhbs4OGvRu8174U6kqRex7if7bFbcz';

// 시트 기반 실행 설정값
const SHEET_NAME = '아파트매물';             // 기본 대상 시트명
const HEADER = {
  시군구: '시군구',
  동읍면: '동읍면',
  통반리: '통반리',
  지번: '지번',
  단지명: '단지명',
  주택단지: '주택단지',      // 주택타운용
  주택유형: '주택유형',      // 주택타운용
  건물명: '건물명',          // 건물/상가/원투룸용
  호수: '호수',              // 상가용 (호 칼럼명이 '호수')
  상호명: '상호명',          // 상가용
  방구조: '방구조',          // 원투룸용 (예: 1룸, 원룸, 투룸 등)
  거래유형: '거래유형',      // 상가/원투룸용 (매매, 전세, 월세 등)
  매물유형: '매물유형',      // 상가/원투룸 구분용
  주소: '주소',              // 상가/원투룸용 (행정구역이 분리되지 않은 경우)
  동: '동',
  호: '호',
  타입: '타입',
  토지분류: '토지분류',       // 토지용
  명칭: '명칭',              // 공장창고용
  관련파일: '관련파일',       // 폴더 URL을 기록할 대상 열(예: W열)
  폴더ID: '폴더ID'           // 선택: 있으면 기록, 없으면 건너뜀
};

// 메타 컬럼 고정 위치 (AppSheet 스키마 충돌 방지)
// 모든 시트에서 동일하게 A=ID, B=관련파일, C=폴더ID로 통일
const META_COLUMN_POSITIONS = {
  ID: 'A',              // A열: ID (고정)
  관련파일: 'B',        // B열: 관련파일 (고정)
  폴더ID: 'C'           // C열: 폴더ID (고정)
};

// 하위 호환성: 기존 시트별 위치 (deprecated, 점진적 마이그레이션용)
const COLUMN_POSITIONS_LEGACY = {
  '건물': { 관련파일: 'AA', 폴더ID: 'AS' },    // AA(27), AS(45) - 구버전
  '상가': { 관련파일: 'Y', 폴더ID: 'AE' },     // Y(25), AE(31) - 구버전
  '원투룸': { 관련파일: 'U', 폴더ID: 'X' },    // U(21), X(24) - 구버전
  '토지': { 관련파일: 'U', 폴더ID: 'V' },      // U(21), V(22) - 구버전
  '공장창고': { 관련파일: 'AD', 폴더ID: 'AE' }  // AD(30), AE(31) - 구버전
};

const DEFAULT_PROJECT_CONFIG = {
  managedSheets: ['아파트매물', '주택타운', '건물', '상가', '원투룸', '토지', '공장창고'],
  webhookSheetName: SHEET_NAME,
  buildingInfoSpreadsheetId: '',
  buildingInfoSheetName: '건물',
  sheetAliases: {},
  triggerSpreadsheetIds: []
};

const BUILDING_INFO_CACHE = {};

function columnLetterToIndex_(letter) {
  var col = 0;
  for (var i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col; // 1-based index
}

function getRootFolder_() {
  if (!ROOT_FOLDER_ID || !String(ROOT_FOLDER_ID).trim()) {
    throw new Error('최상위 폴더 ID가 설정되지 않았습니다. ROOT_FOLDER_ID를 확인해주세요.');
  }

  return DriveApp.getFolderById(ROOT_FOLDER_ID);
}

function sanitizeStringArray_(values, fallbackValues) {
  var source = Array.isArray(values) && values.length > 0 ? values : (fallbackValues || []);
  var result = [];
  var seen = {};

  for (var i = 0; i < source.length; i++) {
    var value = String(source[i] || '').trim();
    if (!value || seen[value]) continue;

    seen[value] = true;
    result.push(value);
  }

  return result;
}

const SHEET_HANDLER_MAP = {
  '아파트매물': { edit: handleApartmentEdit_, row: handleApartmentRow_, backfill: backfillApartmentSheet_ },
  '주택타운': { edit: handleTownEdit_, row: handleTownRow_, backfill: backfillTownSheet_ },
  '건물': { edit: handleBuildingEdit_, row: handleBuildingRow_, backfill: backfillBuildingSheet_ },
  '상가': { edit: handleBuildingEdit_, row: handleBuildingRow_, backfill: backfillBuildingSheet_ },
  '원투룸': { edit: handleBuildingEdit_, row: handleBuildingRow_, backfill: backfillBuildingSheet_ },
  '토지': { edit: handleLandEdit_, row: handleLandRow_, backfill: backfillLandSheet_ },
  '공장창고': { edit: handleFactoryEdit_, row: handleFactoryRow_, backfill: backfillFactorySheet_ }
};

function getProjectConfig_() {
  var overrides = (typeof PROJECT_CONFIG !== 'undefined' && PROJECT_CONFIG) ? PROJECT_CONFIG : {};

  return {
    managedSheets: sanitizeStringArray_(overrides.managedSheets, DEFAULT_PROJECT_CONFIG.managedSheets),
    webhookSheetName: overrides.webhookSheetName || DEFAULT_PROJECT_CONFIG.webhookSheetName,
    buildingInfoSpreadsheetId: overrides.buildingInfoSpreadsheetId || DEFAULT_PROJECT_CONFIG.buildingInfoSpreadsheetId,
    buildingInfoSheetName: overrides.buildingInfoSheetName || DEFAULT_PROJECT_CONFIG.buildingInfoSheetName,
    sheetAliases: Object.assign({}, DEFAULT_PROJECT_CONFIG.sheetAliases, overrides.sheetAliases || {}),
    triggerSpreadsheetIds: sanitizeStringArray_(overrides.triggerSpreadsheetIds, DEFAULT_PROJECT_CONFIG.triggerSpreadsheetIds)
  };
}

function resolveConfiguredSheetName_(sheetName) {
  var config = getProjectConfig_();
  return config.sheetAliases[sheetName] || sheetName;
}

function isManagedSheet_(sheetName) {
  var config = getProjectConfig_();
  var resolvedSheetName = resolveConfiguredSheetName_(sheetName);
  return config.managedSheets.indexOf(sheetName) !== -1 || config.managedSheets.indexOf(resolvedSheetName) !== -1;
}

function getSheetHandler_(sheetName) {
  var resolvedSheetName = resolveConfiguredSheetName_(sheetName);
  return SHEET_HANDLER_MAP[resolvedSheetName] || null;
}

function getWebhookSheetName_(data) {
  var config = getProjectConfig_();
  return data.sheetName || data.시트명 || data.targetSheet || data.매물유형 || config.webhookSheetName;
}

function getTriggerSpreadsheetIds_() {
  return getProjectConfig_().triggerSpreadsheetIds.slice();
}

function getManagedSheetsInSpreadsheet_(spreadsheet) {
  var managedSheets = [];
  if (!spreadsheet) return managedSheets;

  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (isManagedSheet_(sheets[i].getName())) {
      managedSheets.push(sheets[i]);
    }
  }

  return managedSheets;
}

function normalizeCellValue_(value) {
  return String(value || '').trim();
}

function getRowValueByHeader_(rowValues, header, headerName) {
  var col = header.indexOf(headerName);
  if (col < 0 || col >= rowValues.length) return '';
  return normalizeCellValue_(rowValues[col]);
}

function resolveMissingJibunFromSheetData_(sheet, header, rowNum, rowValues, matchHeaderName, filterHeaderNames, data) {
  var currentJibun = getRowValueByHeader_(rowValues, header, HEADER.지번);
  if (currentJibun) return currentJibun;

  var matchValue = getRowValueByHeader_(rowValues, header, matchHeaderName);
  if (!matchValue) return '';

  var jibunCol = header.indexOf(HEADER.지번);
  var matchCol = header.indexOf(matchHeaderName);
  if (jibunCol < 0 || matchCol < 0) return '';

  var sourceData = data || sheet.getDataRange().getValues();
  var filters = filterHeaderNames || [];

  for (var r = 1; r < sourceData.length; r++) {
    var candidateRowNum = r + 1;
    if (candidateRowNum === rowNum) continue;

    var candidate = sourceData[r];
    var candidateMatch = normalizeCellValue_(candidate[matchCol]);
    var candidateJibun = normalizeCellValue_(candidate[jibunCol]);
    if (!candidateMatch || candidateMatch !== matchValue || !candidateJibun) continue;

    var filterMatched = true;
    for (var i = 0; i < filters.length; i++) {
      var filterCol = header.indexOf(filters[i]);
      if (filterCol < 0) continue;

      var currentFilter = normalizeCellValue_(rowValues[filterCol]);
      var candidateFilter = normalizeCellValue_(candidate[filterCol]);
      if (currentFilter && candidateFilter && currentFilter !== candidateFilter) {
        filterMatched = false;
        break;
      }
    }

    if (filterMatched) {
      return candidateJibun;
    }
  }

  return '';
}

function processLatestPendingRowInSheet_(sheet) {
  if (!sheet) return false;

  var sheetName = sheet.getName();
  var handler = getSheetHandler_(sheetName);
  if (!handler || !isManagedSheet_(sheetName)) {
    return false;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  var urlCol = ensured.urlCol;
  if (urlCol < 1) {
    return false;
  }

  var lastRowData = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (lastRowData[urlCol - 1]) {
    return false;
  }

  handler.row(sheet, lastRow, header);
  return true;
}

function assertRequiredFields_(data, fieldNames) {
  var missingFields = [];
  for (var i = 0; i < fieldNames.length; i++) {
    if (!data[fieldNames[i]]) {
      missingFields.push(fieldNames[i]);
    }
  }

  if (missingFields.length > 0) {
    throw new Error('필수 파라미터가 누락되었습니다: ' + missingFields.join(', '));
  }
}

function getBuildingInfoSpreadsheet_(ss) {
  var config = getProjectConfig_();

  if (config.buildingInfoSpreadsheetId) {
    return SpreadsheetApp.openById(config.buildingInfoSpreadsheetId);
  }

  if (ss) {
    return ss;
  }

  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  throw new Error('건물 기준정보 스프레드시트를 찾을 수 없습니다. PROJECT_CONFIG.buildingInfoSpreadsheetId를 설정해주세요.');
}

function getBuildingInfoCacheKey_(spreadsheetId, sheetName) {
  return spreadsheetId + '::' + sheetName;
}

function loadBuildingInfoCache_(targetSpreadsheet, sheetName) {
  var cacheKey = getBuildingInfoCacheKey_(targetSpreadsheet.getId(), sheetName);
  if (BUILDING_INFO_CACHE[cacheKey]) {
    return BUILDING_INFO_CACHE[cacheKey];
  }

  var buildingSheet = targetSpreadsheet.getSheetByName(sheetName);
  if (!buildingSheet) {
    Logger.log('오류: 건물 기준정보 시트를 찾을 수 없습니다. 시트명: ' + sheetName);
    return null;
  }

  var lastRow = buildingSheet.getLastRow();
  var lastCol = buildingSheet.getLastColumn();
  if (lastRow < 2) {
    BUILDING_INFO_CACHE[cacheKey] = {};
    return BUILDING_INFO_CACHE[cacheKey];
  }

  var data = buildingSheet.getRange(1, 1, lastRow, lastCol).getValues();
  var header = data[0];
  var colIndex = function(name) { return header.indexOf(name) + 1; };

  var 건물명Col = colIndex(HEADER.건물명);
  var 시군구Col = colIndex(HEADER.시군구);
  var 동읍면Col = colIndex(HEADER.동읍면);
  var 지번Col = colIndex(HEADER.지번);
  var 통반리Col = colIndex(HEADER.통반리);

  if (건물명Col < 1 || 시군구Col < 1 || 동읍면Col < 1 || 지번Col < 1) {
    Logger.log('오류: 건물 기준정보 시트에 필수 칼럼이 없습니다.');
    return null;
  }

  var lookup = {};
  for (var r = 2; r <= lastRow; r++) {
    var row = data[r - 1];
    var row건물명 = row[건물명Col - 1];
    var normalizedName = row건물명 ? String(row건물명).trim() : '';
    if (!normalizedName || lookup[normalizedName]) continue;

    lookup[normalizedName] = {
      시군구: normalize시군구(row[시군구Col - 1]),
      동읍면: row[동읍면Col - 1],
      통반리: 통반리Col > 0 ? row[통반리Col - 1] : '',
      지번: row[지번Col - 1]
    };
  }

  BUILDING_INFO_CACHE[cacheKey] = lookup;
  Logger.log('건물 기준정보 캐시 로드 완료: ' + targetSpreadsheet.getName() + '/' + sheetName + ' (' + Object.keys(lookup).length + '건)');
  return lookup;
}

function resolveBuildingAddressDataForWebhook_(data) {
  if (data.시군구 && data.동읍면 && data.지번) {
    return {
      시군구: normalize시군구(data.시군구),
      동읍면: data.동읍면,
      통반리: data.통반리 || '',
      지번: data.지번
    };
  }

  var buildingInfo = null;
  if (data.건물명) {
    buildingInfo = getBuildingInfoFromBuildingSheet_(null, data.건물명);
  }

  if (!buildingInfo && data.주소) {
    buildingInfo = parseAddress_(data.주소);
  }

  if (!buildingInfo) {
    throw new Error('건물 계열 매물은 시군구/동읍면/지번 또는 건물명/주소가 필요합니다.');
  }

  return {
    시군구: buildingInfo.시군구,
    동읍면: buildingInfo.동읍면,
    통반리: buildingInfo.통반리 || '',
    지번: buildingInfo.지번
  };
}

function createFolderFromWebhookData_(sheetName, data) {
  var resolvedSheetName = resolveConfiguredSheetName_(sheetName);

  if (resolvedSheetName === '아파트매물') {
    assertRequiredFields_(data, [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.단지명, HEADER.동, HEADER.호, HEADER.타입]);
    return createApartmentFolderStructure(
      data.시군구,
      data.동읍면,
      data.통반리 || '',
      data.지번,
      data.단지명,
      data.동,
      data.호,
      data.타입
    );
  }

  if (resolvedSheetName === '주택타운') {
    assertRequiredFields_(data, [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.주택단지]);
    return createTownFolderStructure(
      data.시군구,
      data.동읍면,
      data.통반리 || '',
      data.지번,
      data.주택단지,
      data.주택유형 || '',
      data.동 || '',
      data.호 || '',
      data.타입 || ''
    );
  }

  if (resolvedSheetName === '건물' || resolvedSheetName === '상가' || resolvedSheetName === '원투룸') {
    assertRequiredFields_(data, [HEADER.건물명]);
    var addressInfo = resolveBuildingAddressDataForWebhook_(data);
    return createBuildingFolderStructure(
      addressInfo.시군구,
      addressInfo.동읍면,
      addressInfo.통반리 || '',
      addressInfo.지번,
      data.건물명,
      data.매물유형 || resolvedSheetName,
      data.호 || data.호수 || '',
      data.상호명 || '',
      data.거래유형 || '',
      data.방구조 || ''
    );
  }

  if (resolvedSheetName === '토지') {
    assertRequiredFields_(data, [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.토지분류]);
    return createLandFolderStructure(
      data.시군구,
      data.동읍면,
      data.통반리 || '',
      data.지번,
      data.토지분류
    );
  }

  if (resolvedSheetName === '공장창고') {
    assertRequiredFields_(data, [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.명칭]);
    return createFactoryFolderStructure(
      data.시군구,
      data.동읍면,
      data.통반리 || '',
      data.지번,
      data.명칭
    );
  }

  throw new Error('지원하지 않는 시트입니다: ' + resolvedSheetName);
}

/**
 * AppSheet Webhook endpoint
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheetName = getWebhookSheetName_(data);
    if (!isManagedSheet_(sheetName)) {
      throw new Error('이 프로젝트 설정에서 처리하지 않는 시트입니다: ' + sheetName);
    }

    const folderUrl = createFolderFromWebhookData_(sheetName, data);

    return ContentService.createTextOutput(JSON.stringify({
      'status': 'success',
      'folderUrl': folderUrl.url,
      'folderId': folderUrl.id
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'error',
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 설치형 onEdit 트리거 진입점
 * - 시트에서 행이 생성/수정될 때 폴더 자동 생성 및 URL/ID 기록
 * - 주의: AppSheet에서 데이터를 추가하면 이 트리거가 작동하지 않을 수 있음
 */
function onEdit(e) {
  try {
    const sheetName = e.range.getSheet().getName();
    const handler = getSheetHandler_(sheetName);

    if (!handler || !isManagedSheet_(sheetName)) {
      return;
    }

    handler.edit(e);
  } catch (error) {
    Logger.log('onEdit error: ' + error);
  }
}

/**
 * onChange 트리거 진입점
 * - 시트의 변경사항(행 추가/삭제/수정)을 감지하여 폴더 자동 생성
 * - AppSheet에서 데이터 추가 시에도 동작함
 */
function onChange(e) {
  try {
    if (!e || (e.changeType !== 'INSERT_ROW' && e.changeType !== 'EDIT')) return;

    var spreadsheet = e.source;
    if (!spreadsheet) return;

    var activeSheet = spreadsheet.getActiveSheet();
    if (processLatestPendingRowInSheet_(activeSheet)) {
      Logger.log('onChange triggered: ' + activeSheet.getName() + ', changeType: ' + e.changeType);
      return;
    }

    var managedSheets = getManagedSheetsInSpreadsheet_(spreadsheet);
    for (var i = 0; i < managedSheets.length; i++) {
      var sheet = managedSheets[i];
      if (activeSheet && sheet.getSheetId() === activeSheet.getSheetId()) {
        continue;
      }

      if (processLatestPendingRowInSheet_(sheet)) {
        Logger.log('onChange fallback triggered: ' + sheet.getName() + ', changeType: ' + e.changeType);
        return;
      }
    }
  } catch (error) {
    Logger.log('onChange error: ' + error);
  }
}

function safeGetTriggerSourceId_(trigger) {
  try {
    return trigger.getTriggerSourceId();
  } catch (error) {
    return '';
  }
}

function getManagedSpreadsheetTriggers_() {
  var triggerSpreadsheetIds = getTriggerSpreadsheetIds_();
  var managedLookup = {};
  for (var i = 0; i < triggerSpreadsheetIds.length; i++) {
    managedLookup[triggerSpreadsheetIds[i]] = true;
  }

  var triggers = ScriptApp.getProjectTriggers();
  var managedTriggers = [];

  for (var j = 0; j < triggers.length; j++) {
    var trigger = triggers[j];
    var sourceId = safeGetTriggerSourceId_(trigger);
    var handlerFunction = trigger.getHandlerFunction();

    if (!sourceId || !managedLookup[sourceId]) continue;
    if (handlerFunction !== 'onEdit' && handlerFunction !== 'onChange') continue;

    managedTriggers.push({
      trigger: trigger,
      spreadsheetId: sourceId,
      handlerFunction: handlerFunction,
      eventType: String(trigger.getEventType()),
      triggerSource: String(trigger.getTriggerSource()),
      uniqueId: trigger.getUniqueId()
    });
  }

  return managedTriggers;
}

function getManagedSpreadsheetTriggerKey_(spreadsheetId, handlerFunction, eventType) {
  return spreadsheetId + '::' + handlerFunction + '::' + eventType;
}

function createManagedSpreadsheetTrigger_(spreadsheetId, handlerFunction, eventType) {
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var builder = ScriptApp.newTrigger(handlerFunction).forSpreadsheet(spreadsheet);

  if (eventType === 'ON_EDIT') {
    builder.onEdit();
  } else if (eventType === 'ON_CHANGE') {
    builder.onChange();
  } else {
    throw new Error('지원하지 않는 트리거 타입입니다: ' + eventType);
  }

  var trigger = builder.create();
  return {
    spreadsheetId: spreadsheetId,
    spreadsheetName: spreadsheet.getName(),
    handlerFunction: handlerFunction,
    eventType: eventType,
    uniqueId: trigger.getUniqueId()
  };
}

function listManagedSpreadsheetTriggers() {
  var triggerSpreadsheetIds = getTriggerSpreadsheetIds_();
  var managedTriggers = getManagedSpreadsheetTriggers_();
  var summary = {
    triggerSpreadsheetIds: triggerSpreadsheetIds,
    triggerCount: managedTriggers.length,
    triggers: managedTriggers.map(function (item) {
      return {
        spreadsheetId: item.spreadsheetId,
        handlerFunction: item.handlerFunction,
        eventType: item.eventType,
        triggerSource: item.triggerSource,
        uniqueId: item.uniqueId
      };
    })
  };

  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function setupManagedSpreadsheetTriggers() {
  var triggerSpreadsheetIds = getTriggerSpreadsheetIds_();
  if (triggerSpreadsheetIds.length === 0) {
    throw new Error('PROJECT_CONFIG.triggerSpreadsheetIds가 비어 있습니다.');
  }

  var existingTriggers = getManagedSpreadsheetTriggers_();
  var existingByKey = {};
  for (var i = 0; i < existingTriggers.length; i++) {
    var existing = existingTriggers[i];
    existingByKey[getManagedSpreadsheetTriggerKey_(existing.spreadsheetId, existing.handlerFunction, existing.eventType)] = true;
  }

  var triggerSpecs = [
    { handlerFunction: 'onEdit', eventType: 'ON_EDIT' },
    { handlerFunction: 'onChange', eventType: 'ON_CHANGE' }
  ];
  var created = [];
  var skipped = [];

  for (var j = 0; j < triggerSpreadsheetIds.length; j++) {
    var spreadsheetId = triggerSpreadsheetIds[j];

    for (var k = 0; k < triggerSpecs.length; k++) {
      var spec = triggerSpecs[k];
      var key = getManagedSpreadsheetTriggerKey_(spreadsheetId, spec.handlerFunction, spec.eventType);

      if (existingByKey[key]) {
        skipped.push({
          spreadsheetId: spreadsheetId,
          handlerFunction: spec.handlerFunction,
          eventType: spec.eventType
        });
        continue;
      }

      created.push(createManagedSpreadsheetTrigger_(spreadsheetId, spec.handlerFunction, spec.eventType));
    }
  }

  var result = {
    created: created,
    skipped: skipped,
    triggerCount: ScriptApp.getProjectTriggers().length
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function resetManagedSpreadsheetTriggers() {
  var managedTriggers = getManagedSpreadsheetTriggers_();
  var deleted = [];

  for (var i = 0; i < managedTriggers.length; i++) {
    ScriptApp.deleteTrigger(managedTriggers[i].trigger);
    deleted.push({
      spreadsheetId: managedTriggers[i].spreadsheetId,
      handlerFunction: managedTriggers[i].handlerFunction,
      eventType: managedTriggers[i].eventType,
      uniqueId: managedTriggers[i].uniqueId
    });
  }

  var setupResult = setupManagedSpreadsheetTriggers();
  var result = {
    deleted: deleted,
    created: setupResult.created,
    skipped: setupResult.skipped,
    triggerCount: setupResult.triggerCount
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function backfillManagedSpreadsheetFolders() {
  var triggerSpreadsheetIds = getTriggerSpreadsheetIds_();
  if (triggerSpreadsheetIds.length === 0) {
    throw new Error('PROJECT_CONFIG.triggerSpreadsheetIds가 비어 있습니다.');
  }

  var summary = {
    spreadsheets: [],
    totalManagedSheets: 0
  };

  for (var i = 0; i < triggerSpreadsheetIds.length; i++) {
    var spreadsheetId = triggerSpreadsheetIds[i];
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var managedSheets = getManagedSheetsInSpreadsheet_(spreadsheet);
    var spreadsheetSummary = {
      spreadsheetId: spreadsheetId,
      spreadsheetName: spreadsheet.getName(),
      sheets: []
    };

    for (var j = 0; j < managedSheets.length; j++) {
      var sheet = managedSheets[j];
      var handler = getSheetHandler_(sheet.getName());
      if (!handler || !handler.backfill) continue;

      summary.totalManagedSheets++;
      spreadsheetSummary.sheets.push(sheet.getName());
      handler.backfill(sheet);
    }

    summary.spreadsheets.push(spreadsheetSummary);
  }

  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function findManagedSheetByCanonicalName_(canonicalSheetName) {
  var triggerSpreadsheetIds = getTriggerSpreadsheetIds_();
  for (var i = 0; i < triggerSpreadsheetIds.length; i++) {
    var spreadsheet = SpreadsheetApp.openById(triggerSpreadsheetIds[i]);
    var managedSheets = getManagedSheetsInSpreadsheet_(spreadsheet);

    for (var j = 0; j < managedSheets.length; j++) {
      var sheet = managedSheets[j];
      if (resolveConfiguredSheetName_(sheet.getName()) === canonicalSheetName) {
        return {
          spreadsheetId: spreadsheet.getId(),
          spreadsheetName: spreadsheet.getName(),
          sheet: sheet
        };
      }
    }
  }

  throw new Error('관리 대상 시트를 찾을 수 없습니다: ' + canonicalSheetName);
}

function backfillManagedSheetRange_(canonicalSheetName, startRow, endRow) {
  var context = findManagedSheetByCanonicalName_(canonicalSheetName);
  var sheet = context.sheet;
  var handler = getSheetHandler_(sheet.getName());
  if (!handler || !handler.row) {
    throw new Error('행 단위 처리 핸들러가 없습니다: ' + canonicalSheetName);
  }

  var lastRow = sheet.getLastRow();
  var fromRow = Math.max(2, startRow || 2);
  var toRow = Math.min(lastRow, endRow || lastRow);
  if (toRow < fromRow) {
    return {
      spreadsheetId: context.spreadsheetId,
      spreadsheetName: context.spreadsheetName,
      sheetName: sheet.getName(),
      canonicalSheetName: canonicalSheetName,
      startRow: fromRow,
      endRow: toRow,
      processedRows: 0,
      createdRowCount: 0,
      skippedExistingCount: 0,
      remainingBlankCount: 0,
      remainingBlankRows: []
    };
  }

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  var urlCol = ensured.urlCol;
  var rowCount = toRow - fromRow + 1;
  var beforeUrls = sheet.getRange(fromRow, urlCol, rowCount, 1).getValues();

  var skippedExistingCount = 0;
  var attemptedRows = 0;
  for (var i = 0; i < rowCount; i++) {
    if (beforeUrls[i][0]) {
      skippedExistingCount++;
      continue;
    }

    attemptedRows++;
    handler.row(sheet, fromRow + i, header);
  }

  SpreadsheetApp.flush();

  var afterUrls = sheet.getRange(fromRow, urlCol, rowCount, 1).getValues();
  var createdRowCount = 0;
  var remainingBlankRows = [];
  for (var j = 0; j < rowCount; j++) {
    var beforeValue = beforeUrls[j][0];
    var afterValue = afterUrls[j][0];
    if (!beforeValue && afterValue) {
      createdRowCount++;
    }
    if (!afterValue && remainingBlankRows.length < 10) {
      remainingBlankRows.push(fromRow + j);
    }
  }

  var result = {
    spreadsheetId: context.spreadsheetId,
    spreadsheetName: context.spreadsheetName,
    sheetName: sheet.getName(),
    canonicalSheetName: canonicalSheetName,
    startRow: fromRow,
    endRow: toRow,
    processedRows: attemptedRows,
    createdRowCount: createdRowCount,
    skippedExistingCount: skippedExistingCount,
    remainingBlankCount: attemptedRows - createdRowCount,
    remainingBlankRows: remainingBlankRows
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function findFirstBlankManagedRow_(sheet, urlCol, startRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var fromRow = Math.max(2, startRow || 2);
  if (fromRow > lastRow) return null;

  var rowCount = lastRow - fromRow + 1;
  var urlValues = sheet.getRange(fromRow, urlCol, rowCount, 1).getValues();
  for (var i = 0; i < urlValues.length; i++) {
    if (!urlValues[i][0]) {
      return fromRow + i;
    }
  }

  return null;
}

function backfillNextManagedSheetChunk_(canonicalSheetName, chunkSize) {
  var context = findManagedSheetByCanonicalName_(canonicalSheetName);
  var sheet = context.sheet;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  var urlCol = ensured.urlCol;
  var startRow = findFirstBlankManagedRow_(sheet, urlCol, 2);

  if (!startRow) {
    var completedResult = {
      spreadsheetId: context.spreadsheetId,
      spreadsheetName: context.spreadsheetName,
      sheetName: sheet.getName(),
      canonicalSheetName: canonicalSheetName,
      completed: true,
      nextStartRow: null
    };
    Logger.log(JSON.stringify(completedResult, null, 2));
    return completedResult;
  }

  var endRow = Math.min(sheet.getLastRow(), startRow + chunkSize - 1);
  var summary = backfillManagedSheetRange_(canonicalSheetName, startRow, endRow);
  var nextStartRow = findFirstBlankManagedRow_(sheet, urlCol, startRow);
  summary.completed = !nextStartRow;
  summary.nextStartRow = nextStartRow;
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

// 운영용 수동 backfill entry points
// - 전체 시트 재점검이 필요하면 backfillManagedSpreadsheetFolders()
// - 대형 시트(건물/상가)는 continue* 함수로 chunk 단위 재개
function backfillApartmentSheetFolders() {
  return backfillManagedSheetRange_('아파트매물', 2);
}

function backfillTownSheetFolders() {
  return backfillManagedSheetRange_('주택타운', 2);
}

function backfillStudioSheetFolders() {
  return backfillManagedSheetRange_('원투룸', 2, 120);
}

function backfillLandSheetFolders() {
  return backfillManagedSheetRange_('토지', 2, 120);
}

function backfillFactorySheetFolders() {
  return backfillManagedSheetRange_('공장창고', 2, 120);
}

function continueBuildingSheetBackfill() {
  return backfillNextManagedSheetChunk_('건물', 15);
}

function continueRetailSheetBackfill() {
  return backfillNextManagedSheetChunk_('상가', 15);
}

/**
 * 아파트매물 편집 처리
 */
function handleApartmentEdit_(e) {
  const sheet = e.range.getSheet();
  if (resolveConfiguredSheetName_(sheet.getName()) !== '아파트매물') return;
  const editedRow = e.range.getRow();
  if (editedRow === 1) return; // 헤더 행 제외

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = (name) => header.indexOf(name) + 1; // 1-based

  // 필수값: 시군구, 동읍면, 지번, 단지명, 동, 호, 타입 모두 필요
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.단지명, HEADER.동, HEADER.호, HEADER.타입];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return; // 필수 헤더 없으면 중단
  }

  // 결과 컬럼 찾기(관련파일은 반드시 존재해야 함. 없으면 생성)
  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol; // 관련파일 열
  const idCol = ensured.idCol;   // 폴더ID가 없을 수 있음(없으면 0)

  // 현재 행 값 읽기
  const rowValues = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  // 필수값 체크
  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번:   getVal(HEADER.지번),
    단지명: getVal(HEADER.단지명),
    동: getVal(HEADER.동),
    호: getVal(HEADER.호),
    타입: getVal(HEADER.타입)
  };

  if (!values.지번) {
    values.지번 = resolveMissingJibunFromSheetData_(
      sheet,
      header,
      editedRow,
      rowValues,
      HEADER.단지명,
      [HEADER.시군구, HEADER.동읍면, HEADER.통반리]
    );
  }

  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.단지명 && values.동 && values.호 && values.타입;
  if (!hasAllRequired) return;

  // 이미 폴더 정보가 있으면 건너뜀
  const currentUrl = rowValues[urlCol - 1];
  const currentId = idCol > 0 ? rowValues[idCol - 1] : '';
  if (currentUrl) return; // URL이 이미 있으면 생성 안 함

  // 폴더 생성
  const folder = createApartmentFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.단지명,
    values.동,
    values.호,
    values.타입
  );

  // 결과 기록
  sheet.getRange(editedRow, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(editedRow, idCol).setValue(folder.id);
}

/**
 * 아파트매물 특정 행 처리 (onChange용)
 */
function handleApartmentRow_(sheet, rowNum, header) {
  const colIndex = (name) => header.indexOf(name) + 1;
  
  // 필수값: 시군구, 동읍면, 지번, 단지명, 동, 호, 타입 모두 필요
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.단지명, HEADER.동, HEADER.호, HEADER.타입];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }
  
  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;
  
  const rowValues = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];
  
  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번:   getVal(HEADER.지번),
    단지명: getVal(HEADER.단지명),
    동: getVal(HEADER.동),
    호: getVal(HEADER.호),
    타입: getVal(HEADER.타입)
  };

  if (!values.지번) {
    values.지번 = resolveMissingJibunFromSheetData_(
      sheet,
      header,
      rowNum,
      rowValues,
      HEADER.단지명,
      [HEADER.시군구, HEADER.동읍면, HEADER.통반리]
    );
  }
  
  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.단지명 && values.동 && values.호 && values.타입;
  if (!hasAllRequired) return;
  
  if (rowValues[urlCol - 1]) return; // 이미 URL이 있으면 건너뜀
  
  const folder = createApartmentFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.단지명,
    values.동,
    values.호,
    values.타입
  );
  
  sheet.getRange(rowNum, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(rowNum, idCol).setValue(folder.id);
}

/**
 * 주택타운 편집 처리
 */
function handleTownEdit_(e) {
  const sheet = e.range.getSheet();
  if (resolveConfiguredSheetName_(sheet.getName()) !== '주택타운') return;
  const editedRow = e.range.getRow();
  if (editedRow === 1) return; // 헤더 행 제외

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = (name) => header.indexOf(name) + 1;

  // 필수값: 시군구, 동읍면, 지번, 주택단지
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.주택단지];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  // 필수값 체크
  const 시군구 = getVal(HEADER.시군구);
  const 동읍면 = getVal(HEADER.동읍면);
  var 지번 = getVal(HEADER.지번);
  const 주택단지 = getVal(HEADER.주택단지);
  const 주택유형 = colIndex(HEADER.주택유형) > 0 ? getVal(HEADER.주택유형) : '';

  if (!지번) {
    지번 = resolveMissingJibunFromSheetData_(
      sheet,
      header,
      editedRow,
      rowValues,
      HEADER.주택단지,
      [HEADER.시군구, HEADER.동읍면, HEADER.통반리]
    );
  }

  if (!시군구 || !동읍면 || !지번 || !주택단지) return;

  // 이미 URL이 있으면 건너뜀
  if (rowValues[urlCol - 1]) return;

  // 폴더 생성
  const folder = createTownFolderStructure(
    시군구,
    동읍면,
    colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번,
    주택단지,
    주택유형,
    colIndex(HEADER.동) > 0 ? getVal(HEADER.동) : '',
    colIndex(HEADER.호) > 0 ? getVal(HEADER.호) : '',
    colIndex(HEADER.타입) > 0 ? getVal(HEADER.타입) : ''
  );

  // 결과 기록
  sheet.getRange(editedRow, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(editedRow, idCol).setValue(folder.id);
}

/**
 * 주택타운 특정 행 처리 (onChange용)
 */
function handleTownRow_(sheet, rowNum, header) {
  const colIndex = (name) => header.indexOf(name) + 1;
  
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.주택단지];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }
  
  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;
  
  const rowValues = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];
  
  const 시군구 = getVal(HEADER.시군구);
  const 동읍면 = getVal(HEADER.동읍면);
  var 지번 = getVal(HEADER.지번);
  const 주택단지 = getVal(HEADER.주택단지);
  const 주택유형 = colIndex(HEADER.주택유형) > 0 ? getVal(HEADER.주택유형) : '';

  if (!지번) {
    지번 = resolveMissingJibunFromSheetData_(
      sheet,
      header,
      rowNum,
      rowValues,
      HEADER.주택단지,
      [HEADER.시군구, HEADER.동읍면, HEADER.통반리]
    );
  }
  
  if (!시군구 || !동읍면 || !지번 || !주택단지) return;
  
  if (rowValues[urlCol - 1]) return; // 이미 URL이 있으면 건너뜀
  
  const folder = createTownFolderStructure(
    시군구,
    동읍면,
    colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번,
    주택단지,
    주택유형,
    colIndex(HEADER.동) > 0 ? getVal(HEADER.동) : '',
    colIndex(HEADER.호) > 0 ? getVal(HEADER.호) : '',
    colIndex(HEADER.타입) > 0 ? getVal(HEADER.타입) : ''
  );
  
  sheet.getRange(rowNum, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(rowNum, idCol).setValue(folder.id);
}

/**
 * 건물/상가/원투룸 편집 처리
 */
function handleBuildingEdit_(e) {
  const sheet = e.range.getSheet();
  const sheetName = resolveConfiguredSheetName_(sheet.getName());
  if (sheetName !== '건물' && sheetName !== '상가' && sheetName !== '원투룸') return;
  const editedRow = e.range.getRow();
  if (editedRow === 1) return;

  const ss = sheet.getParent(); // 스프레드시트 객체 가져오기
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = (name) => header.indexOf(name) + 1;

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  // 건물명은 필수
  const 건물명 = getVal(HEADER.건물명);
  if (!건물명) return;

  // 행정구역 칼럼이 있는지 확인 (건물 시트)
  const hasSeparatedAddress = colIndex(HEADER.시군구) > 0 && colIndex(HEADER.동읍면) > 0 && colIndex(HEADER.지번) > 0;
  
  let 시군구, 동읍면, 통반리, 지번;
  if (hasSeparatedAddress) {
    // 행정구역 칼럼이 분리되어 있는 경우 (건물 시트)
    시군구 = getVal(HEADER.시군구);
    동읍면 = getVal(HEADER.동읍면);
    지번 = getVal(HEADER.지번);
    통반리 = colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '';
    if (!시군구 || !동읍면 || !지번) return;
  } else {
    // 상가, 원투룸 시트: 건물 시트에서 건물명으로 행정구역 조회 시도
    var buildingInfo = getBuildingInfoFromBuildingSheet_(ss, 건물명);
    
    // 건물 시트에서 찾지 못했으면 주소 파싱 시도
    if (!buildingInfo) {
      const 주소 = colIndex(HEADER.주소) > 0 ? getVal(HEADER.주소) : '';
      if (주소) {
        Logger.log('건물 시트에서 찾지 못했습니다. 주소 파싱 시도: ' + 주소);
        buildingInfo = parseAddress_(주소);
        if (!buildingInfo) {
          Logger.log('경고: 주소 파싱 실패. 건물명: "' + 건물명 + '", 주소: "' + 주소 + '"');
          return;
        }
      } else {
        Logger.log('경고: 건물 시트에서 "' + 건물명 + '"을 찾을 수 없고, 주소 칼럼도 없습니다.');
        return;
      }
    }
    
    시군구 = buildingInfo.시군구;
    동읍면 = buildingInfo.동읍면;
    통반리 = buildingInfo.통반리 || '';
    지번 = buildingInfo.지번;
    if (!시군구 || !동읍면 || !지번) {
      Logger.log('경고: 건물 정보가 불완전합니다. 시군구: ' + 시군구 + ', 동읍면: ' + 동읍면 + ', 지번: ' + 지번);
      return;
    }
  }

  const 매물유형 = colIndex(HEADER.매물유형) > 0 ? getVal(HEADER.매물유형) : sheetName;
  
  if (rowValues[urlCol - 1]) return;

  // 호 칼럼 찾기 (호 또는 호수)
  let 호 = '';
  if (colIndex(HEADER.호) > 0) {
    호 = getVal(HEADER.호);
  } else if (colIndex(HEADER.호수) > 0) {
    호 = getVal(HEADER.호수);
  }
  
  // 상호명 (상가만)
  const 상호명 = colIndex(HEADER.상호명) > 0 ? getVal(HEADER.상호명) : '';
  
  // 방구조 (원투룸만)
  const 방구조 = colIndex(HEADER.방구조) > 0 ? getVal(HEADER.방구조) : '';
  
  // 거래유형
  const 거래유형 = colIndex(HEADER.거래유형) > 0 ? getVal(HEADER.거래유형) : '';

  // 폴더 생성
  const folder = createBuildingFolderStructure(
    시군구,
    동읍면,
    통반리 || '',
    지번,
    건물명,
    매물유형,
    호 || '',
    상호명 || '',
    거래유형 || '',
    방구조 || ''
  );

  sheet.getRange(editedRow, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(editedRow, idCol).setValue(folder.id);
}

/**
 * 건물/상가/원투룸 특정 행 처리 (onChange용)
 */
function handleBuildingRow_(sheet, rowNum, header) {
  const sheetName = resolveConfiguredSheetName_(sheet.getName());
  const ss = sheet.getParent(); // 스프레드시트 객체 가져오기
  const colIndex = (name) => header.indexOf(name) + 1;
  
  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;
  
  const rowValues = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];
  
  // 건물명은 필수
  const 건물명 = getVal(HEADER.건물명);
  if (!건물명) return;
  
  // 행정구역 칼럼이 있는지 확인 (건물 시트)
  const hasSeparatedAddress = colIndex(HEADER.시군구) > 0 && colIndex(HEADER.동읍면) > 0 && colIndex(HEADER.지번) > 0;
  
  let 시군구, 동읍면, 통반리, 지번;
  if (hasSeparatedAddress) {
    // 행정구역 칼럼이 분리되어 있는 경우 (건물 시트)
    시군구 = normalize시군구(getVal(HEADER.시군구)); // 정규화 적용
    동읍면 = getVal(HEADER.동읍면);
    지번 = getVal(HEADER.지번);
    통반리 = colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '';
    if (!시군구 || !동읍면 || !지번) return;
  } else {
    // 상가, 원투룸 시트: 건물 시트에서 건물명으로 행정구역 조회 시도
    var buildingInfo = getBuildingInfoFromBuildingSheet_(ss, 건물명);
    
    // 건물 시트에서 찾지 못했으면 주소 파싱 시도
    if (!buildingInfo) {
      const 주소 = colIndex(HEADER.주소) > 0 ? getVal(HEADER.주소) : '';
      if (주소) {
        Logger.log('건물 시트에서 찾지 못했습니다. 주소 파싱 시도: ' + 주소);
        buildingInfo = parseAddress_(주소);
        if (!buildingInfo) {
          Logger.log('경고: 주소 파싱 실패. 건물명: "' + 건물명 + '", 주소: "' + 주소 + '"');
          return;
        }
      } else {
        Logger.log('경고: 건물 시트에서 "' + 건물명 + '"을 찾을 수 없고, 주소 칼럼도 없습니다.');
        return;
      }
    }
    
    시군구 = buildingInfo.시군구;
    동읍면 = buildingInfo.동읍면;
    통반리 = buildingInfo.통반리 || '';
    지번 = buildingInfo.지번;
    if (!시군구 || !동읍면 || !지번) {
      Logger.log('경고: 건물 정보가 불완전합니다. 시군구: ' + 시군구 + ', 동읍면: ' + 동읍면 + ', 지번: ' + 지번);
      return;
    }
  }
  
  const 매물유형 = colIndex(HEADER.매물유형) > 0 ? getVal(HEADER.매물유형) : sheetName;
  
  if (rowValues[urlCol - 1]) return;

  // 호 칼럼 찾기 (호 또는 호수)
  let 호 = '';
  if (colIndex(HEADER.호) > 0) {
    호 = getVal(HEADER.호);
  } else if (colIndex(HEADER.호수) > 0) {
    호 = getVal(HEADER.호수);
  }
  
  // 상호명 (상가만)
  const 상호명 = colIndex(HEADER.상호명) > 0 ? getVal(HEADER.상호명) : '';
  
  // 방구조 (원투룸만)
  const 방구조 = colIndex(HEADER.방구조) > 0 ? getVal(HEADER.방구조) : '';
  
  // 거래유형
  const 거래유형 = colIndex(HEADER.거래유형) > 0 ? getVal(HEADER.거래유형) : '';

  const folder = createBuildingFolderStructure(
    시군구,
    동읍면,
    통반리 || '',
    지번,
    건물명,
    매물유형,
    호 || '',
    상호명 || '',
    거래유형 || '',
    방구조 || ''
  );
  
  sheet.getRange(rowNum, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(rowNum, idCol).setValue(folder.id);
}

/**
 * 토지 편집 처리
 */
function handleLandEdit_(e) {
  const sheet = e.range.getSheet();
  if (resolveConfiguredSheetName_(sheet.getName()) !== '토지') return;
  const editedRow = e.range.getRow();
  if (editedRow === 1) return;

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = (name) => header.indexOf(name) + 1;

  // 필수값: 시군구, 동읍면, 지번, 토지분류
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.토지분류];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번: getVal(HEADER.지번),
    토지분류: getVal(HEADER.토지분류)
  };

  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.토지분류;
  if (!hasAllRequired) return;

  if (rowValues[urlCol - 1]) return;

  const folder = createLandFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.토지분류
  );

  sheet.getRange(editedRow, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(editedRow, idCol).setValue(folder.id);
}

/**
 * 토지 특정 행 처리 (onChange용)
 */
function handleLandRow_(sheet, rowNum, header) {
  const colIndex = (name) => header.indexOf(name) + 1;

  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.토지분류];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번: getVal(HEADER.지번),
    토지분류: getVal(HEADER.토지분류)
  };

  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.토지분류;
  if (!hasAllRequired) return;

  if (rowValues[urlCol - 1]) return;

  const folder = createLandFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.토지분류
  );

  sheet.getRange(rowNum, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(rowNum, idCol).setValue(folder.id);
}

/**
 * 공장창고 편집 처리
 */
function handleFactoryEdit_(e) {
  const sheet = e.range.getSheet();
  if (resolveConfiguredSheetName_(sheet.getName()) !== '공장창고') return;
  const editedRow = e.range.getRow();
  if (editedRow === 1) return;

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = (name) => header.indexOf(name) + 1;

  // 필수값: 시군구, 동읍면, 지번, 명칭
  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.명칭];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번: getVal(HEADER.지번),
    명칭: getVal(HEADER.명칭)
  };

  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.명칭;
  if (!hasAllRequired) return;

  if (rowValues[urlCol - 1]) return;

  const folder = createFactoryFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.명칭
  );

  sheet.getRange(editedRow, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(editedRow, idCol).setValue(folder.id);
}

/**
 * 공장창고 특정 행 처리 (onChange용)
 */
function handleFactoryRow_(sheet, rowNum, header) {
  const colIndex = (name) => header.indexOf(name) + 1;

  const requiredHeaders = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.명칭];
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (colIndex(requiredHeaders[i]) < 1) return;
  }

  const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
  const urlCol = ensured.urlCol;
  const idCol = ensured.idCol;

  const rowValues = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const getVal = (name) => rowValues[colIndex(name) - 1];

  const values = {
    시군구: getVal(HEADER.시군구),
    동읍면: getVal(HEADER.동읍면),
    통반리: colIndex(HEADER.통반리) > 0 ? getVal(HEADER.통반리) : '',
    지번: getVal(HEADER.지번),
    명칭: getVal(HEADER.명칭)
  };

  var hasAllRequired = values.시군구 && values.동읍면 && values.지번 && values.명칭;
  if (!hasAllRequired) return;

  if (rowValues[urlCol - 1]) return;

  const folder = createFactoryFolderStructure(
    values.시군구,
    values.동읍면,
    values.통반리 || '',
    values.지번,
    values.명칭
  );

  sheet.getRange(rowNum, urlCol).setValue(folder.url);
  if (idCol > 0) sheet.getRange(rowNum, idCol).setValue(folder.id);
}

/**
 * 아파트 폴더 구조 생성
 */
function createApartmentFolderStructure(시군구, 동읍면, 통반리, 지번, 단지명, 동, 호, 타입) {
  const rootFolder = getRootFolder_();

  // 1단계: 시군구 폴더 (정규화 적용: 지정 지역 외는 "타지역"으로 매핑)
  const normalized시군구 = normalize시군구(시군구);
  const 시군구Folder = getOrCreateFolder(rootFolder, normalized시군구);

  // 2단계: 동읍면 폴더
  const 동읍면Folder = getOrCreateFolder(시군구Folder, 동읍면);

  // 3단계: 통반리 폴더 (통반리 정보가 있을 때만 생성)
  let 부모Folder = 동읍면Folder;

  if (통반리 && 통반리.trim() !== '') {
    부모Folder = getOrCreateFolder(동읍면Folder, 통반리);
  }

  // 4단계: 지번 단지명 폴더
  const 단지Folder = getOrCreateFolder(부모Folder, `${지번} ${단지명}`);

  // 5단계: 매물 폴더 (고정, 하이픈으로 시작하여 정렬 시 맨 앞에 위치)
  const 매물Folder = getOrCreateFolder(단지Folder, '-매물');

  // 6단계: 동-호-타입 폴더
  const 최종Folder = getOrCreateFolder(매물Folder, `${동}-${호}-${타입}`);

  return {
    url: 최종Folder.getUrl(),
    id: 최종Folder.getId()
  };
}

/**
 * 주택타운 폴더 구조 생성
 * 주택유형에 따라 다른 규칙 적용:
 * - 단독: [지번 단독] (대시 없음, -매물 없음)
 * - 단지형 전원주택: [단지명]/-매물/[지번번지 동동 호호] (단위 포함)
 * - 빌라/타운하우스/듀플렉스: [단지명]/-매물/[지번번지 동동 호호 타입] (단위 포함, 없는 값 제외)
 */
function createTownFolderStructure(시군구, 동읍면, 통반리, 지번, 주택단지, 주택유형, 동, 호, 타입) {
  const rootFolder = getRootFolder_();

  // 1단계: 시군구 폴더 (정규화 적용: 지정 지역 외는 "타지역"으로 매핑)
  const normalized시군구 = normalize시군구(시군구);
  const 시군구Folder = getOrCreateFolder(rootFolder, normalized시군구);

  // 2단계: 동읍면 폴더
  const 동읍면Folder = getOrCreateFolder(시군구Folder, 동읍면);

  // 3단계: 통반리 폴더 (통반리 정보가 있을 때만 생성)
  let 부모Folder = 동읍면Folder;
  if (통반리 && 통반리.trim() !== '') {
    부모Folder = getOrCreateFolder(동읍면Folder, 통반리);
  }

  // 주택유형 확인 (대소문자 무시, 공백 제거)
  const normalizedType = 주택유형 ? String(주택유형).trim().toLowerCase() : '';
  
  // 단독주택: [지번 단독] (대시 없음)
  if (normalizedType === '단독' || 주택단지 === '단독') {
    const 단독Folder = getOrCreateFolder(부모Folder, 지번 + '번지 ' + 주택단지);
    return {
      url: 단독Folder.getUrl(),
      id: 단독Folder.getId()
    };
  }

  // 단지형 전원주택: [단지명]/-매물/[지번번지 동동 호호]
  if (normalizedType === '단지형 전원주택' || normalizedType === '전원주택') {
    // 주택단지 폴더명: 지번 없이 주택단지만
    const 단지Folder = getOrCreateFolder(부모Folder, 주택단지);
    const 매물Folder = getOrCreateFolder(단지Folder, '-매물');
    
    // 리프 폴더: 지번번지 동동 호호 (단위 포함)
    var leafParts = [];
    if (지번) leafParts.push(지번 + '번지');
    if (동) leafParts.push(동 + '동');
    if (호) leafParts.push(호 + '호');
    const leafName = leafParts.length > 0 ? leafParts.join(' ') : 지번 + '번지';
    const 최종Folder = getOrCreateFolder(매물Folder, leafName);
    
    return {
      url: 최종Folder.getUrl(),
      id: 최종Folder.getId()
    };
  }

  // 빌라/타운하우스/듀플렉스: [단지명]/-매물/[지번번지 동동 호호 타입]
  // 주택단지 폴더명: 지번 없이 주택단지만
  const 단지Folder = getOrCreateFolder(부모Folder, 주택단지);
  const 매물Folder = getOrCreateFolder(단지Folder, '-매물');
  
  // 리프 폴더: 지번번지 동동 호호 타입 (단위 포함, 없는 값은 제외)
  var parts = [];
  if (지번) parts.push(지번 + '번지');
  if (동) parts.push(동 + '동');
  if (호) parts.push(호 + '호');
  if (타입) parts.push(타입);
  const leafName = parts.length > 0 ? parts.join(' ') : 지번 + '번지';
  const 최종Folder = getOrCreateFolder(매물Folder, leafName);
  
  return {
    url: 최종Folder.getUrl(),
    id: 최종Folder.getId()
  };
}

/**
 * 건물/상가/원투룸 폴더 구조 생성
 * 폴더 구조:
 * - 행정구역 → [지번 건물명] → -매물 → 리프 폴더
 * - 상가 매물 리프: [호 상호명 거래유형]
 * - 원투룸 매물 리프: [호 방구조 거래유형]
 * 
 * 반환값: [지번 건물명] 폴더의 URL과 ID
 */
function createBuildingFolderStructure(시군구, 동읍면, 통반리, 지번, 건물명, 매물유형, 호, 상호명, 거래유형, 방구조) {
  // 매물유형이 '상가' 또는 '원투룸'인지 확인
  const normalizedType = 매물유형 ? String(매물유형).trim().toLowerCase() : '';
  const is상가 = normalizedType === '상가' || normalizedType.includes('상가');
  const is원투룸 = normalizedType === '원투룸' || normalizedType.includes('원투룸');
  
  const rootFolder = getRootFolder_();
  
  // 1단계: 시군구 폴더 (정규화 적용)
  const normalized시군구 = normalize시군구(시군구);
  const 시군구Folder = getOrCreateFolder(rootFolder, normalized시군구);
  
  // 2단계: 동읍면 폴더
  const 동읍면Folder = getOrCreateFolder(시군구Folder, 동읍면);
  
  // 3단계: 통반리 폴더 (통반리 정보가 있을 때만 생성)
  let 부모Folder = 동읍면Folder;
  if (통반리 && 통반리.trim() !== '') {
    부모Folder = getOrCreateFolder(동읍면Folder, 통반리);
  }
  
  // 4단계: 지번 건물명 폴더 (이 폴더의 URL/ID를 반환)
  const 건물Folder = getOrCreateFolder(부모Folder, 지번 + ' ' + 건물명);
  
  // 5단계: -매물 폴더 (통합)
  const 매물Folder = getOrCreateFolder(건물Folder, '-매물');
  
  // 6단계: 리프 폴더
  // 상가: [호 상호명 거래유형]
  // 원투룸: [호 방구조 거래유형]
  var leafParts = [];
  if (호) leafParts.push(호);
  if (is상가 && 상호명) {
    leafParts.push(상호명);
  } else if (is원투룸 && 방구조) {
    leafParts.push(방구조);
  }
  if (거래유형) leafParts.push(거래유형);
  
  const leafName = leafParts.length > 0 ? leafParts.join(' ') : (호 || '매물');
  getOrCreateFolder(매물Folder, leafName);
  
  // [지번 건물명] 폴더의 URL과 ID 반환
  return {
    url: 건물Folder.getUrl(),
    id: 건물Folder.getId()
  };
}

/**
 * 토지 폴더 구조 생성
 * 폴더 구조: [최상위]/시군구/동읍면/통반리/지번 토지분류
 */
function createLandFolderStructure(시군구, 동읍면, 통반리, 지번, 토지분류) {
  const rootFolder = getRootFolder_();
  
  // 1단계: 시군구 폴더 (정규화 적용)
  const normalized시군구 = normalize시군구(시군구);
  const 시군구Folder = getOrCreateFolder(rootFolder, normalized시군구);
  
  // 2단계: 동읍면 폴더
  const 동읍면Folder = getOrCreateFolder(시군구Folder, 동읍면);
  
  // 3단계: 통반리 폴더 (통반리 정보가 있을 때만 생성)
  let 부모Folder = 동읍면Folder;
  if (통반리 && 통반리.trim() !== '') {
    부모Folder = getOrCreateFolder(동읍면Folder, 통반리);
  }
  
  // 4단계: 지번 토지분류 폴더 (최종 폴더)
  const 최종Folder = getOrCreateFolder(부모Folder, 지번 + ' ' + 토지분류);
  
  return {
    url: 최종Folder.getUrl(),
    id: 최종Folder.getId()
  };
}

/**
 * 공장창고 폴더 구조 생성
 * 폴더 구조: [최상위]/시군구/동읍면/통반리/지번 명칭
 */
function createFactoryFolderStructure(시군구, 동읍면, 통반리, 지번, 명칭) {
  const rootFolder = getRootFolder_();
  
  // 1단계: 시군구 폴더 (정규화 적용)
  const normalized시군구 = normalize시군구(시군구);
  const 시군구Folder = getOrCreateFolder(rootFolder, normalized시군구);
  
  // 2단계: 동읍면 폴더
  const 동읍면Folder = getOrCreateFolder(시군구Folder, 동읍면);
  
  // 3단계: 통반리 폴더 (통반리 정보가 있을 때만 생성)
  let 부모Folder = 동읍면Folder;
  if (통반리 && 통반리.trim() !== '') {
    부모Folder = getOrCreateFolder(동읍면Folder, 통반리);
  }
  
  // 4단계: 지번 명칭 폴더 (최종 폴더)
  const 최종Folder = getOrCreateFolder(부모Folder, 지번 + ' ' + 명칭);
  
  return {
    url: 최종Folder.getUrl(),
    id: 최종Folder.getId()
  };
}

/**
 * 주소 문자열에서 행정구역 정보 파싱
 * @param {string} 주소 - 주소 문자열 (예: "충청남도 아산시 탕정면 갈산리 559-4")
 * @return {Object|null} - {시군구, 동읍면, 통반리, 지번} 또는 null
 */
function parseAddress_(주소) {
  if (!주소 || !String(주소).trim()) return null;
  
  const addressStr = String(주소).trim();
  const parts = addressStr.split(/\s+/); // 공백으로 분리
  
  var 시군구 = [];
  var 동읍면 = null;
  var 통반리 = null;
  var 지번 = null;
  
  // 각 단어를 순회하며 패턴 매칭
  for (var i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    // 시군구: "시", "군", "구"로 끝나는 단어
    if (part.match(/[시군구]$/)) {
      시군구.push(part);
      continue;
    }
    
    // 동읍면: "동", "읍", "면"으로 끝나는 단어
    if (part.match(/[동읍면]$/)) {
      if (!동읍면) {
        동읍면 = part;
      }
      continue;
    }
    
    // 통반리: "리"로 끝나는 단어
    if (part.match(/리$/)) {
      if (!통반리) {
        통반리 = part;
      }
      continue;
    }
    
    // 지번: 숫자로 시작하는 패턴 (예: "559-4", "1681", "61-10")
    if (part.match(/^\d+/) && !지번) {
      // 이미 지번을 찾았으면 건너뜀
      if (!지번) {
        지번 = part;
      }
    }
  }
  
  // 시군구 조합 및 정규화
  const 시군구Str = 시군구.length > 0 ? 시군구.join(' ') : null;
  
  if (!시군구Str || !동읍면 || !지번) {
    return null; // 필수 정보가 없으면 null 반환
  }
  
  return {
    시군구: normalize시군구(시군구Str), // 정규화 적용
    동읍면: 동읍면,
    통반리: 통반리 || '',
    지번: 지번
  };
}

/**
 * 건물 시트에서 건물명으로 행정구역 정보 조회
 * @param {Spreadsheet} ss - 스프레드시트 객체
 * @param {string} 건물명 - 조회할 건물명
 * @return {Object|null} - {시군구, 동읍면, 통반리, 지번} 또는 null
 */
function getBuildingInfoFromBuildingSheet_(ss, 건물명) {
  try {
    const config = getProjectConfig_();
    const targetSpreadsheet = getBuildingInfoSpreadsheet_(ss);
    var lookup = loadBuildingInfoCache_(targetSpreadsheet, config.buildingInfoSheetName);
    if (!lookup) return null;

    var normalizedTarget = 건물명 ? String(건물명).trim() : '';
    if (!normalizedTarget) return null;

    if (lookup[normalizedTarget]) {
      return lookup[normalizedTarget];
    }

    Logger.log('건물 시트에서 "' + 건물명 + '"을 찾을 수 없습니다.');
    return null;
  } catch (error) {
    Logger.log('건물 정보 조회 오류: ' + error.toString());
    return null;
  }
}

/**
 * 폴더 가져오기 또는 생성
 * @param {Folder} parentFolder - 부모 폴더
 * @param {string} folderName - 생성할 폴더 이름
 * @return {Folder} - 폴더 객체
 */
/**
 * 시군구 값 정규화 및 타지역 매핑
 * - 지정된 3개 지역(아산시, 천안시 서북구, 천안시 동남구)은 그대로 사용
 * - 그 외 모든 지역은 "타지역"으로 매핑
 * - 공백 처리로 중복 폴더 방지
 */
function normalize시군구(시군구) {
  if (!시군구) return '';
  
  // 공백 정규화 (연속된 공백을 하나로 만들고 앞뒤 공백 제거)
  var normalized = String(시군구).replace(/\s+/g, ' ').trim();
  
  // 지정된 지역 목록
  var allowedRegions = ['아산시', '천안시 서북구', '천안시 동남구'];
  
  // 지정된 지역이면 그대로 반환, 아니면 "타지역"으로 매핑
  if (allowedRegions.indexOf(normalized) !== -1) {
    return normalized;
  } else {
    return '타지역';
  }
}

function getOrCreateFolder(parentFolder, folderName) {
  // 기존 폴더 검색
  const folders = parentFolder.getFoldersByName(folderName);

  if (folders.hasNext()) {
    // 이미 존재하면 기존 폴더 반환
    return folders.next();
  } else {
    // 없으면 새로 생성
    return parentFolder.createFolder(folderName);
  }
}

/**
 * 테스트 함수 (Apps Script 에디터에서 직접 실행)
 */
function testCreateFolder() {
  // 테스트 1: 통반리가 있는 경우
  Logger.log('=== 테스트 1: 통반리 있음 ===');
  const result1 = createApartmentFolderStructure(
    '천안시 서북구',     // 시군구
    '두정동',           // 동읍면
    '두정동',           // 통반리
    '37-1',             // 지번
    '힐스테이트두정역', // 단지명
    '101',              // 동
    '1001',             // 호
    '84A'               // 타입
  );
  Logger.log('폴더 생성 완료!');
  Logger.log('URL: ' + result1.url);
  Logger.log('ID: ' + result1.id);

  // 테스트 2: 통반리가 없는 경우 (건너뜀)
  Logger.log('\n=== 테스트 2: 통반리 없음 (건너뜀) ===');
  const result2 = createApartmentFolderStructure(
    '천안시 동남구',  // 시군구
    '신부동',         // 동읍면
    '',               // 통반리 (빈 문자열 = 폴더 건너뜀)
    '123',            // 지번
    '테스트단지',     // 단지명
    '201',            // 동
    '2001',           // 호
    '105A'            // 타입
  );
  Logger.log('폴더 생성 완료!');
  Logger.log('URL: ' + result2.url);
  Logger.log('ID: ' + result2.id);
}

/**
 * 시트 전체를 스캔하여 폴더URL/ID가 비어 있는 행에 대해 일괄 생성
 */
function backfillPropertyFolders() {
  try {
    // 활성 스프레드시트 가져오기
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      Logger.log('오류: 활성 스프레드시트를 찾을 수 없습니다.');
      return;
    }
    
    // 활성 시트 확인
    const activeSheet = ss.getActiveSheet();
    if (!activeSheet) {
      Logger.log('오류: 활성 시트를 찾을 수 없습니다.');
      return;
    }
    
    const sheetName = activeSheet.getName();
    const handler = getSheetHandler_(sheetName);
    Logger.log('활성 시트: ' + sheetName);
    
    if (!handler || !isManagedSheet_(sheetName)) {
      Logger.log('이 프로젝트 설정에서 처리하지 않는 시트: ' + sheetName);
      return;
    }

    handler.backfill(activeSheet);
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 아파트매물 일괄 보정
 */
function backfillApartmentSheet_(sheet) {
  try {
    Logger.log('아파트매물 시트 처리 시작');
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log('경고: 데이터 행이 없습니다. (lastRow: ' + lastRow + ')');
      return;
    }
    
    Logger.log('데이터 범위: 2행부터 ' + lastRow + '행, ' + lastCol + '열');

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = data[0];
    const colIndex = (name) => header.indexOf(name) + 1;

    // 헤더 확인 및 로깅
    const req = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.단지명, HEADER.동, HEADER.호, HEADER.타입];
    var missingHeaders = [];
    for (var i = 0; i < req.length; i++) {
      if (colIndex(req[i]) < 1) {
        missingHeaders.push(req[i]);
      }
    }
    
    if (missingHeaders.length > 0) {
      Logger.log('오류: 필수 헤더가 없습니다: ' + missingHeaders.join(', '));
      Logger.log('현재 헤더: ' + header.join(', '));
      return;
    }

    Logger.log('필수 헤더 확인 완료');

    const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
    const urlCol = ensured.urlCol;
    const idCol = ensured.idCol;
    
    Logger.log('결과 열 위치 - 관련파일: ' + urlCol + '열, 폴더ID: ' + idCol + '열');

    const updatesUrl = [];
    const updatesId = [];
    const targetRows = [];
    var processedCount = 0;
    var skippedCount = 0;
    var skippedByUrl = 0;
    var skippedByMissingData = 0;
    var firstSkippedRow = null;

    for (var r = 2; r <= lastRow; r++) {
      const row = data[r - 1];
      
      // 이미 URL이 있으면 건너뜀
      if (row[urlCol - 1]) {
        skippedByUrl++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: 'URL이 이미 존재',
            url: row[urlCol - 1]
          };
        }
        continue;
      }
      
      // 필수값 체크
      const 시군구 = row[colIndex(HEADER.시군구) - 1];
      const 동읍면 = row[colIndex(HEADER.동읍면) - 1];
      var 지번 = row[colIndex(HEADER.지번) - 1];
      const 단지명 = row[colIndex(HEADER.단지명) - 1];
      const 동 = row[colIndex(HEADER.동) - 1];
      const 호 = row[colIndex(HEADER.호) - 1];
      const 타입 = row[colIndex(HEADER.타입) - 1];

      if (!지번) {
        지번 = resolveMissingJibunFromSheetData_(
          sheet,
          header,
          r,
          row,
          HEADER.단지명,
          [HEADER.시군구, HEADER.동읍면, HEADER.통반리],
          data
        );
      }
      
      var ok = 시군구 && 동읍면 && 지번 && 단지명 && 동 && 호 && 타입;
      
      if (!ok) {
        skippedByMissingData++;
        skippedCount++;
        if (!firstSkippedRow) {
          var missingFields = [];
          if (!시군구) missingFields.push('시군구');
          if (!동읍면) missingFields.push('동읍면');
          if (!지번) missingFields.push('지번');
          if (!단지명) missingFields.push('단지명');
          if (!동) missingFields.push('동');
          if (!호) missingFields.push('호');
          if (!타입) missingFields.push('타입');
          firstSkippedRow = {
            row: r,
            reason: '필수값 누락',
            missing: missingFields.join(', ')
          };
        }
        continue;
      }

      // 폴더 생성
      const folder = createApartmentFolderStructure(
        시군구,
        동읍면,
        colIndex(HEADER.통반리) > 0 ? row[colIndex(HEADER.통반리) - 1] : '',
        지번,
        단지명,
        동,
        호,
        타입
      );
      
      updatesUrl.push([folder.url]);
      updatesId.push([folder.id]);
      targetRows.push(r);
      processedCount++;
    }
    
    Logger.log('=== 처리 결과 ===');
    Logger.log('처리된 행: ' + processedCount + '개');
    Logger.log('건너뛴 행: ' + skippedCount + '개');
    Logger.log('  - URL 이미 존재: ' + skippedByUrl + '개');
    Logger.log('  - 필수값 누락: ' + skippedByMissingData + '개');
    
    if (firstSkippedRow) {
      Logger.log('첫 번째 건너뛴 행 (예시): ' + firstSkippedRow.row + '행 - ' + firstSkippedRow.reason);
      if (firstSkippedRow.missing) {
        Logger.log('  누락된 필드: ' + firstSkippedRow.missing);
      }
    }
    
    // 배치 기록
    for (var i = 0; i < targetRows.length; i++) {
      sheet.getRange(targetRows[i], urlCol).setValue(updatesUrl[i][0]);
      if (idCol > 0) sheet.getRange(targetRows[i], idCol).setValue(updatesId[i][0]);
    }
    
    Logger.log('완료: ' + targetRows.length + '개 행에 폴더 정보를 기록했습니다.');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 주택타운 일괄 보정
 */
function backfillTownSheet_(sheet) {
  try {
    Logger.log('주택타운 시트 처리 시작');
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log('경고: 데이터 행이 없습니다. (lastRow: ' + lastRow + ')');
      return;
    }
    
    Logger.log('데이터 범위: 2행부터 ' + lastRow + '행, ' + lastCol + '열');

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = data[0];
    const colIndex = (name) => header.indexOf(name) + 1;

    // 헤더 확인 및 로깅
    const req = [HEADER.시군구, HEADER.동읍면, HEADER.지번, HEADER.주택단지];
    var missingHeaders = [];
    for (var i = 0; i < req.length; i++) {
      if (colIndex(req[i]) < 1) {
        missingHeaders.push(req[i]);
      }
    }
    
    if (missingHeaders.length > 0) {
      Logger.log('오류: 필수 헤더가 없습니다: ' + missingHeaders.join(', '));
      Logger.log('현재 헤더: ' + header.join(', '));
      return;
    }

    Logger.log('필수 헤더 확인 완료');

    const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
    const urlCol = ensured.urlCol;
    const idCol = ensured.idCol;
    
    Logger.log('결과 열 위치 - 관련파일: ' + urlCol + '열, 폴더ID: ' + idCol + '열');

    const updatesUrl = [];
    const updatesId = [];
    const targetRows = [];
    var processedCount = 0;
    var skippedCount = 0;
    var skippedByUrl = 0;
    var skippedByMissingData = 0;
    var firstSkippedRow = null;

    for (var r = 2; r <= lastRow; r++) {
      const row = data[r - 1];
      
      // 이미 URL이 있으면 건너뜀
      if (row[urlCol - 1]) {
        skippedByUrl++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: 'URL이 이미 존재',
            url: row[urlCol - 1]
          };
        }
        continue;
      }
      
      // 필수값 체크
      const 시군구 = row[colIndex(HEADER.시군구) - 1];
      const 동읍면 = row[colIndex(HEADER.동읍면) - 1];
      var 지번 = row[colIndex(HEADER.지번) - 1];
      const 주택단지 = row[colIndex(HEADER.주택단지) - 1];
      const 주택유형 = colIndex(HEADER.주택유형) > 0 ? row[colIndex(HEADER.주택유형) - 1] : '';
      const 통반리 = colIndex(HEADER.통반리) > 0 ? row[colIndex(HEADER.통반리) - 1] : '';
      const 동 = colIndex(HEADER.동) > 0 ? row[colIndex(HEADER.동) - 1] : '';
      const 호 = colIndex(HEADER.호) > 0 ? row[colIndex(HEADER.호) - 1] : '';
      const 타입 = colIndex(HEADER.타입) > 0 ? row[colIndex(HEADER.타입) - 1] : '';

      if (!지번) {
        지번 = resolveMissingJibunFromSheetData_(
          sheet,
          header,
          r,
          row,
          HEADER.주택단지,
          [HEADER.시군구, HEADER.동읍면, HEADER.통반리],
          data
        );
      }
      
      if (!시군구 || !동읍면 || !지번 || !주택단지) {
        skippedByMissingData++;
        skippedCount++;
        if (!firstSkippedRow) {
          var missingFields = [];
          if (!시군구) missingFields.push('시군구');
          if (!동읍면) missingFields.push('동읍면');
          if (!지번) missingFields.push('지번');
          if (!주택단지) missingFields.push('주택단지');
          firstSkippedRow = {
            row: r,
            reason: '필수값 누락',
            missing: missingFields.join(', ')
          };
        }
        continue;
      }

      // 폴더 생성
      const folder = createTownFolderStructure(
        시군구,
        동읍면,
        통반리 || '',
        지번,
        주택단지,
        주택유형 || '',
        동 || '',
        호 || '',
        타입 || ''
      );
      
      updatesUrl.push([folder.url]);
      updatesId.push([folder.id]);
      targetRows.push(r);
      processedCount++;
    }
    
    Logger.log('=== 처리 결과 ===');
    Logger.log('처리된 행: ' + processedCount + '개');
    Logger.log('건너뛴 행: ' + skippedCount + '개');
    Logger.log('  - URL 이미 존재: ' + skippedByUrl + '개');
    Logger.log('  - 필수값 누락: ' + skippedByMissingData + '개');
    
    if (firstSkippedRow) {
      Logger.log('첫 번째 건너뛴 행 (예시): ' + firstSkippedRow.row + '행 - ' + firstSkippedRow.reason);
      if (firstSkippedRow.missing) {
        Logger.log('  누락된 필드: ' + firstSkippedRow.missing);
      }
    }
    
    // 배치 기록
    for (var i = 0; i < targetRows.length; i++) {
      sheet.getRange(targetRows[i], urlCol).setValue(updatesUrl[i][0]);
      if (idCol > 0) sheet.getRange(targetRows[i], idCol).setValue(updatesId[i][0]);
    }
    
    Logger.log('완료: ' + targetRows.length + '개 행에 폴더 정보를 기록했습니다.');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 건물/상가/원투룸 일괄 보정
 */
function backfillBuildingSheet_(sheet) {
  try {
    const rawSheetName = sheet.getName();
    const sheetName = resolveConfiguredSheetName_(rawSheetName);
    Logger.log('건물/상가/원투룸 시트 처리 시작: ' + rawSheetName + ' -> ' + sheetName);
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log('경고: 데이터 행이 없습니다. (lastRow: ' + lastRow + ')');
      return;
    }
    
    Logger.log('데이터 범위: 2행부터 ' + lastRow + '행, ' + lastCol + '열');

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = data[0];
    const colIndex = (name) => header.indexOf(name) + 1;

    // 건물명은 필수
    if (colIndex(HEADER.건물명) < 1) {
      Logger.log('오류: 필수 헤더 "건물명"이 없습니다.');
      Logger.log('현재 헤더: ' + header.join(', '));
      return;
    }
    
    // 행정구역 칼럼이 있는지 확인
    const hasSeparatedAddress = colIndex(HEADER.시군구) > 0 && colIndex(HEADER.동읍면) > 0 && colIndex(HEADER.지번) > 0;
    const ss = sheet.getParent(); // 스프레드시트 객체
    
    if (!hasSeparatedAddress) {
      // 상가, 원투룸 시트: 건물 시트에서 조회해야 함
      Logger.log('행정구역 칼럼이 없습니다. 건물 시트에서 정보를 조회합니다.');
    } else {
      Logger.log('필수 헤더 확인 완료 (행정구역 칼럼 분리됨)');
    }

    const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
    const urlCol = ensured.urlCol;
    const idCol = ensured.idCol;
    
    Logger.log('결과 열 위치 - 관련파일: ' + urlCol + '열, 폴더ID: ' + idCol + '열');

    const updatesUrl = [];
    const updatesId = [];
    const targetRows = [];
    var processedCount = 0;
    var skippedCount = 0;
    var skippedByUrl = 0;
    var skippedByMissingData = 0;
    var firstSkippedRow = null;

    for (var r = 2; r <= lastRow; r++) {
      const row = data[r - 1];
      
      // 이미 URL이 있으면 건너뜀
      if (row[urlCol - 1]) {
        skippedByUrl++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: 'URL이 이미 존재',
            url: row[urlCol - 1]
          };
        }
        continue;
      }
      
      // 필수값 체크
      const 건물명 = row[colIndex(HEADER.건물명) - 1];
      if (!건물명) {
        skippedByMissingData++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: '필수값 누락',
            missing: '건물명'
          };
        }
        continue;
      }
      
      let 시군구, 동읍면, 통반리, 지번;
      if (hasSeparatedAddress) {
        // 행정구역 칼럼이 분리되어 있는 경우 (건물 시트)
        시군구 = normalize시군구(row[colIndex(HEADER.시군구) - 1]); // 정규화 적용
        동읍면 = row[colIndex(HEADER.동읍면) - 1];
        지번 = row[colIndex(HEADER.지번) - 1];
        통반리 = colIndex(HEADER.통반리) > 0 ? row[colIndex(HEADER.통반리) - 1] : '';
        
        if (!시군구 || !동읍면 || !지번) {
          skippedByMissingData++;
          skippedCount++;
          if (!firstSkippedRow) {
            var missingFields = [];
            if (!시군구) missingFields.push('시군구');
            if (!동읍면) missingFields.push('동읍면');
            if (!지번) missingFields.push('지번');
            firstSkippedRow = {
              row: r,
              reason: '필수값 누락',
              missing: missingFields.join(', ')
            };
          }
          continue;
        }
      } else {
        // 상가, 원투룸 시트: 건물 시트에서 건물명으로 행정구역 조회 시도
        var buildingInfo = getBuildingInfoFromBuildingSheet_(ss, 건물명);
        
        // 건물 시트에서 찾지 못했으면 주소 파싱 시도
        if (!buildingInfo) {
          const 주소 = colIndex(HEADER.주소) > 0 ? row[colIndex(HEADER.주소) - 1] : '';
          if (주소) {
            Logger.log('건물 시트에서 찾지 못했습니다. 주소 파싱 시도: ' + 주소);
            buildingInfo = parseAddress_(주소);
            if (!buildingInfo) {
              skippedByMissingData++;
              skippedCount++;
              if (!firstSkippedRow) {
                firstSkippedRow = {
                  row: r,
                  reason: '주소 파싱 실패',
                  missing: '건물명: "' + 건물명 + '", 주소: "' + 주소 + '"'
                };
              }
              continue;
            }
          } else {
            skippedByMissingData++;
            skippedCount++;
            if (!firstSkippedRow) {
              firstSkippedRow = {
                row: r,
                reason: '건물 정보 없음',
                missing: '건물 시트에서 "' + 건물명 + '"을 찾을 수 없고, 주소 칼럼도 없음'
              };
            }
            continue;
          }
        }
        
        시군구 = buildingInfo.시군구;
        동읍면 = buildingInfo.동읍면;
        통반리 = buildingInfo.통반리 || '';
        지번 = buildingInfo.지번;
        if (!시군구 || !동읍면 || !지번) {
          skippedByMissingData++;
          skippedCount++;
          if (!firstSkippedRow) {
            firstSkippedRow = {
              row: r,
              reason: '건물 정보 불완전',
              missing: '시군구: ' + 시군구 + ', 동읍면: ' + 동읍면 + ', 지번: ' + 지번
            };
          }
          continue;
        }
      }
      
      const 매물유형 = colIndex(HEADER.매물유형) > 0 ? row[colIndex(HEADER.매물유형) - 1] : sheetName;
      
      // 호 칼럼 찾기 (호 또는 호수)
      let 호 = '';
      if (colIndex(HEADER.호) > 0) {
        호 = row[colIndex(HEADER.호) - 1];
      } else if (colIndex(HEADER.호수) > 0) {
        호 = row[colIndex(HEADER.호수) - 1];
      }
      
      const 상호명 = colIndex(HEADER.상호명) > 0 ? row[colIndex(HEADER.상호명) - 1] : '';
      const 방구조 = colIndex(HEADER.방구조) > 0 ? row[colIndex(HEADER.방구조) - 1] : '';
      const 거래유형 = colIndex(HEADER.거래유형) > 0 ? row[colIndex(HEADER.거래유형) - 1] : '';

      // 폴더 생성
      const folder = createBuildingFolderStructure(
        시군구,
        동읍면,
        통반리 || '',
        지번,
        건물명,
        매물유형 || '',
        호 || '',
        상호명 || '',
        거래유형 || '',
        방구조 || ''
      );
      
      updatesUrl.push([folder.url]);
      updatesId.push([folder.id]);
      targetRows.push(r);
      processedCount++;
    }
    
    Logger.log('=== 처리 결과 ===');
    Logger.log('처리된 행: ' + processedCount + '개');
    Logger.log('건너뛴 행: ' + skippedCount + '개');
    Logger.log('  - URL 이미 존재: ' + skippedByUrl + '개');
    Logger.log('  - 필수값 누락: ' + skippedByMissingData + '개');
    
    if (firstSkippedRow) {
      Logger.log('첫 번째 건너뛴 행 (예시): ' + firstSkippedRow.row + '행 - ' + firstSkippedRow.reason);
      if (firstSkippedRow.missing) {
        Logger.log('  누락된 필드: ' + firstSkippedRow.missing);
      }
    }
    
    // 배치 기록
    for (var i = 0; i < targetRows.length; i++) {
      sheet.getRange(targetRows[i], urlCol).setValue(updatesUrl[i][0]);
      if (idCol > 0) sheet.getRange(targetRows[i], idCol).setValue(updatesId[i][0]);
    }
    
    Logger.log('완료: ' + targetRows.length + '개 행에 폴더 정보를 기록했습니다.');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 토지 일괄 보정
 */
function backfillLandSheet_(sheet) {
  try {
    Logger.log('토지 시트 처리 시작');
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log('경고: 데이터 행이 없습니다. (lastRow: ' + lastRow + ')');
      return;
    }
    
    Logger.log('데이터 범위: 2행부터 ' + lastRow + '행, ' + lastCol + '열');

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = data[0];
    const colIndex = (name) => header.indexOf(name) + 1;

    // 필수 헤더 확인
    if (colIndex(HEADER.시군구) < 1 || colIndex(HEADER.동읍면) < 1 || colIndex(HEADER.지번) < 1 || colIndex(HEADER.토지분류) < 1) {
      Logger.log('오류: 필수 헤더가 없습니다.');
      return;
    }

    const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
    const urlCol = ensured.urlCol;
    const idCol = ensured.idCol;

    var processedCount = 0;
    var skippedCount = 0;
    var skippedByUrl = 0;
    var skippedByMissingData = 0;
    var firstSkippedRow = null;
    var updatesUrl = [];
    var updatesId = [];
    var targetRows = [];

    for (var r = 2; r <= lastRow; r++) {
      const row = data[r - 1];
      
      // 이미 URL이 있으면 건너뜀
      if (row[urlCol - 1]) {
        skippedByUrl++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: 'URL이 이미 존재',
            url: row[urlCol - 1]
          };
        }
        continue;
      }
      
      // 필수값 체크
      const 시군구 = row[colIndex(HEADER.시군구) - 1];
      const 동읍면 = row[colIndex(HEADER.동읍면) - 1];
      const 지번 = row[colIndex(HEADER.지번) - 1];
      const 토지분류 = row[colIndex(HEADER.토지분류) - 1];
      const 통반리 = colIndex(HEADER.통반리) > 0 ? row[colIndex(HEADER.통반리) - 1] : '';
      
      if (!시군구 || !동읍면 || !지번 || !토지분류) {
        skippedByMissingData++;
        skippedCount++;
        if (!firstSkippedRow) {
          var missingFields = [];
          if (!시군구) missingFields.push('시군구');
          if (!동읍면) missingFields.push('동읍면');
          if (!지번) missingFields.push('지번');
          if (!토지분류) missingFields.push('토지분류');
          firstSkippedRow = {
            row: r,
            reason: '필수값 누락',
            missing: missingFields.join(', ')
          };
        }
        continue;
      }

      // 폴더 생성
      const folder = createLandFolderStructure(
        시군구,
        동읍면,
        통반리 || '',
        지번,
        토지분류
      );
      
      updatesUrl.push([folder.url]);
      updatesId.push([folder.id]);
      targetRows.push(r);
      processedCount++;
    }
    
    Logger.log('=== 처리 결과 ===');
    Logger.log('처리된 행: ' + processedCount + '개');
    Logger.log('건너뛴 행: ' + skippedCount + '개');
    Logger.log('  - URL 이미 존재: ' + skippedByUrl + '개');
    Logger.log('  - 필수값 누락: ' + skippedByMissingData + '개');
    
    if (firstSkippedRow) {
      Logger.log('첫 번째 건너뛴 행 (예시): ' + firstSkippedRow.row + '행 - ' + firstSkippedRow.reason);
      if (firstSkippedRow.missing) {
        Logger.log('  누락된 필드: ' + firstSkippedRow.missing);
      }
    }
    
    // 배치 기록
    for (var i = 0; i < targetRows.length; i++) {
      sheet.getRange(targetRows[i], urlCol).setValue(updatesUrl[i][0]);
      if (idCol > 0) sheet.getRange(targetRows[i], idCol).setValue(updatesId[i][0]);
    }
    
    Logger.log('완료: ' + targetRows.length + '개 행에 폴더 정보를 기록했습니다.');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 공장창고 일괄 보정
 */
function backfillFactorySheet_(sheet) {
  try {
    Logger.log('공장창고 시트 처리 시작');
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log('경고: 데이터 행이 없습니다. (lastRow: ' + lastRow + ')');
      return;
    }
    
    Logger.log('데이터 범위: 2행부터 ' + lastRow + '행, ' + lastCol + '열');

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = data[0];
    const colIndex = (name) => header.indexOf(name) + 1;

    // 필수 헤더 확인
    if (colIndex(HEADER.시군구) < 1 || colIndex(HEADER.동읍면) < 1 || colIndex(HEADER.지번) < 1 || colIndex(HEADER.명칭) < 1) {
      Logger.log('오류: 필수 헤더가 없습니다.');
      return;
    }

    const ensured = ensureResultColumnsForRelatedFile_(sheet, header);
    const urlCol = ensured.urlCol;
    const idCol = ensured.idCol;

    var processedCount = 0;
    var skippedCount = 0;
    var skippedByUrl = 0;
    var skippedByMissingData = 0;
    var firstSkippedRow = null;
    var updatesUrl = [];
    var updatesId = [];
    var targetRows = [];

    for (var r = 2; r <= lastRow; r++) {
      const row = data[r - 1];
      
      // 이미 URL이 있으면 건너뜀
      if (row[urlCol - 1]) {
        skippedByUrl++;
        skippedCount++;
        if (!firstSkippedRow) {
          firstSkippedRow = {
            row: r,
            reason: 'URL이 이미 존재',
            url: row[urlCol - 1]
          };
        }
        continue;
      }
      
      // 필수값 체크
      const 시군구 = row[colIndex(HEADER.시군구) - 1];
      const 동읍면 = row[colIndex(HEADER.동읍면) - 1];
      const 지번 = row[colIndex(HEADER.지번) - 1];
      const 명칭 = row[colIndex(HEADER.명칭) - 1];
      const 통반리 = colIndex(HEADER.통반리) > 0 ? row[colIndex(HEADER.통반리) - 1] : '';
      
      if (!시군구 || !동읍면 || !지번 || !명칭) {
        skippedByMissingData++;
        skippedCount++;
        if (!firstSkippedRow) {
          var missingFields = [];
          if (!시군구) missingFields.push('시군구');
          if (!동읍면) missingFields.push('동읍면');
          if (!지번) missingFields.push('지번');
          if (!명칭) missingFields.push('명칭');
          firstSkippedRow = {
            row: r,
            reason: '필수값 누락',
            missing: missingFields.join(', ')
          };
        }
        continue;
      }

      // 폴더 생성
      const folder = createFactoryFolderStructure(
        시군구,
        동읍면,
        통반리 || '',
        지번,
        명칭
      );
      
      updatesUrl.push([folder.url]);
      updatesId.push([folder.id]);
      targetRows.push(r);
      processedCount++;
    }
    
    Logger.log('=== 처리 결과 ===');
    Logger.log('처리된 행: ' + processedCount + '개');
    Logger.log('건너뛴 행: ' + skippedCount + '개');
    Logger.log('  - URL 이미 존재: ' + skippedByUrl + '개');
    Logger.log('  - 필수값 누락: ' + skippedByMissingData + '개');
    
    if (firstSkippedRow) {
      Logger.log('첫 번째 건너뛴 행 (예시): ' + firstSkippedRow.row + '행 - ' + firstSkippedRow.reason);
      if (firstSkippedRow.missing) {
        Logger.log('  누락된 필드: ' + firstSkippedRow.missing);
      }
    }
    
    // 배치 기록
    for (var i = 0; i < targetRows.length; i++) {
      sheet.getRange(targetRows[i], urlCol).setValue(updatesUrl[i][0]);
      if (idCol > 0) sheet.getRange(targetRows[i], idCol).setValue(updatesId[i][0]);
    }
    
    Logger.log('완료: ' + targetRows.length + '개 행에 폴더 정보를 기록했습니다.');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
  }
}

/**
 * 관련파일 열을 보장하고, 폴더ID는 있으면 인덱스를 반환
 * 
 * ✅ 업데이트: 모든 시트에서 고정 컬럼 위치 사용 (AppSheet 스키마 동기화)
 * - A열: ID (고정)
 * - B열: 관련파일 (고정)
 * - C열: 폴더ID (고정)
 * 
 * 이 구조는 AppSheet에서 "Regenerate Structure" 실행 후 스키마와 완벽히 일치합니다.
 */
function ensureResultColumnsForRelatedFile_(sheet, headerRow) {
  var header = headerRow || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var sheetName = sheet.getName();

  // ✅ 매물 시트가 아닌 경우 제외 (고객DB, 고정값, 건물정보 등)
  var excludedSheets = ['고객DB', '고객정보', '고정값', '건물정보', '아파트단지', '매물지도', '대시보드', '통계', '통합DB'];
  if (excludedSheets.indexOf(sheetName) !== -1) {
    Logger.log('[' + sheetName + '] 시트는 폴더 관리 대상이 아니므로 건너뜀');
    return { urlCol: 0, idCol: 0 };
  }

  // 고정 위치 사용 (AppSheet 스키마 충돌 방지)
  var idCol = META_COLUMN_POSITIONS.ID === 'A' ? 1 : columnLetterToIndex_(META_COLUMN_POSITIONS.ID);
  var urlCol = META_COLUMN_POSITIONS.관련파일 === 'B' ? 2 : columnLetterToIndex_(META_COLUMN_POSITIONS.관련파일);
  var folderIdCol = META_COLUMN_POSITIONS.폴더ID === 'C' ? 3 : columnLetterToIndex_(META_COLUMN_POSITIONS.폴더ID);

  // 헤더가 없는 경우 또는 헤더가 다른 경우 업데이트
  var currentIdHeader = header[0] || '';
  var currentUrlHeader = header[1] || '';
  var currentFolderIdHeader = header[2] || '';
  
  // A열: ID 확인 및 설정
  if (currentIdHeader !== 'ID') {
    sheet.getRange(1, idCol).setValue('ID');
  }
  
  // B열: 관련파일 확인 및 설정
  if (currentUrlHeader !== HEADER.관련파일) {
    sheet.getRange(1, urlCol).setValue(HEADER.관련파일);
  }
  
  // C열: 폴더ID 확인 및 설정
  if (currentFolderIdHeader !== HEADER.폴더ID) {
    sheet.getRange(1, folderIdCol).setValue(HEADER.폴더ID);
  }

  return { urlCol: urlCol, idCol: folderIdCol };
}

/**
 * 매물 삭제 시 폴더도 삭제 (선택사항)
 */
function doDelete(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (!data.folderId) {
      return ContentService.createTextOutput(JSON.stringify({
        'status': 'error',
        'message': 'folderId가 필요합니다.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const folder = DriveApp.getFolderById(data.folderId);
    folder.setTrashed(true);

    return ContentService.createTextOutput(JSON.stringify({
      'status': 'success',
      'message': '폴더가 삭제되었습니다.'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'error',
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 컬럼을 새 구조로 재배치하는 도구 함수
 * ⚠️ 주의사항:
 * 1. 이 함수는 기존 데이터를 A, B, C로 이동시킵니다
 * 2. 실행 전에 시트를 반드시 백업하세요 (파일 → 복사본 만들기)
 * 3. 실행 후 AppSheet에서 "Regenerate Structure"를 꼭 실행해야 합니다
 * 
 * 새 구조:
 * - A열: ID
 * - B열: 관련파일
 * - C열: 폴더ID
 * - D열부터: 기존 데이터 컬럼들 (ID, 관련파일, 폴더ID 제외)
 * 
 * 사용법:
 * 1. 대상 시트를 활성화
 * 2. 시트 백업 (중요!)
 * 3. 이 함수 실행: reorganizeColumnsToMetaFirst()
 * 4. AppSheet에서 "Regenerate Structure" 실행
 * 5. AppSheet의 컬럼 설정 확인 (App Formula, Ref 등)
 */
function reorganizeColumnsToMetaFirst() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      Logger.log('오류: 활성 스프레드시트를 찾을 수 없습니다.');
      return;
    }
    
    var sheet = ss.getActiveSheet();
    if (!sheet) {
      Logger.log('오류: 활성 시트를 찾을 수 없습니다.');
      return;
    }
    
    var sheetName = sheet.getName();
    Logger.log('⚠️ 컬럼 재구성 시작: ' + sheetName);
    Logger.log('⚠️ 주의: 실행 전에 시트 백업을 권장합니다!');
    
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    
    if (lastRow < 1 || lastCol < 1) {
      Logger.log('경고: 데이터가 없습니다.');
      return;
    }
    
    // 헤더 읽기
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    // 메타 컬럼 인덱스 찾기 (0-based)
    var idIndex = header.indexOf('ID');
    var urlIndex = header.indexOf(HEADER.관련파일);
    var folderIdIndex = header.indexOf(HEADER.폴더ID);
    
    // 새 헤더 배열 구성 (A=ID, B=관련파일, C=폴더ID, 나머지는 순서대로)
    var newHeader = [];
    var processedIndices = {};
    
    // A열: ID
    if (idIndex >= 0) {
      newHeader.push('ID');
      processedIndices[idIndex] = true;
    } else {
      newHeader.push('ID');
    }
    
    // B열: 관련파일
    if (urlIndex >= 0) {
      newHeader.push(HEADER.관련파일);
      processedIndices[urlIndex] = true;
    } else {
      newHeader.push(HEADER.관련파일);
    }
    
    // C열: 폴더ID
    if (folderIdIndex >= 0) {
      newHeader.push(HEADER.폴더ID);
      processedIndices[folderIdIndex] = true;
    } else {
      newHeader.push(HEADER.폴더ID);
    }
    
    // 나머지 컬럼들 (ID, 관련파일, 폴더ID 제외)
    for (var i = 0; i < header.length; i++) {
      if (!processedIndices[i] && header[i]) {
        newHeader.push(header[i]);
      }
    }
    
    // 전체 데이터 읽기
    var allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    
    // 새 데이터 배열 구성
    var newData = [];
    for (var r = 0; r < lastRow; r++) {
      var newRow = [];
      
      // A열: ID
      if (idIndex >= 0) {
        newRow.push(allData[r][idIndex]);
      } else {
        newRow.push('');
      }
      
      // B열: 관련파일
      if (urlIndex >= 0) {
        newRow.push(allData[r][urlIndex]);
      } else {
        newRow.push('');
      }
      
      // C열: 폴더ID
      if (folderIdIndex >= 0) {
        newRow.push(allData[r][folderIdIndex]);
      } else {
        newRow.push('');
      }
      
      // 나머지 컬럼들
      for (var i = 0; i < header.length; i++) {
        if (!processedIndices[i] && header[i]) {
          newRow.push(allData[r][i]);
        }
      }
      
      newData.push(newRow);
    }
    
    // 시트 초기화 (기존 데이터 삭제)
    sheet.clear();
    
    // 새 데이터 쓰기
    if (newData.length > 0 && newData[0].length > 0) {
      sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
    }
    
    Logger.log('✅ 컬럼 재구성 완료');
    Logger.log('새 구조: A=ID, B=관련파일, C=폴더ID, D~=데이터 컬럼');
    Logger.log('총 ' + newData.length + '행, ' + newData[0].length + '열');
    Logger.log('⚠️ 중요: AppSheet에서 "Regenerate Structure"를 실행하세요!');
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    Logger.log(error.stack);
    throw error;
  }
}
