/**
 * Apartment entry price helper builder.
 *
 * The source of truth for the sheet schema and parsing rules is:
 * docs/apps-script/apartment-entry-price-model.md
 */
const PRICE_MODEL = {
  menuName: '아파트 등록',
  sheets: {
    source: '분양가_source',
    helper: '분양가_helper',
    errors: '분양가_helper_errors'
  },
  sourceHeaders: [
    'source_id',
    'active',
    'priority',
    '단지ID',
    '단지명',
    '타입',
    '동_raw',
    '라인_raw',
    '층_from',
    '층_to',
    '분양가',
    '계약금',
    '중도금',
    '잔금',
    'note'
  ],
  helperHeaders: [
    'helper_key',
    'source_id',
    '단지ID',
    '단지명',
    '타입',
    '동',
    '층',
    '라인',
    '분양가',
    '계약금',
    '중도금',
    '잔금',
    'source_row',
    'generated_at'
  ],
  errorHeaders: [
    'error_type',
    'source_id',
    'source_row',
    'detail',
    'conflicting_key',
    'conflicting_source_id',
    'logged_at'
  ],
  errorTypes: {
    missingRequired: 'MISSING_REQUIRED',
    invalidDongToken: 'INVALID_DONG_TOKEN',
    invalidLineToken: 'INVALID_LINE_TOKEN',
    invalidFloorRange: 'INVALID_FLOOR_RANGE',
    duplicateSourceId: 'DUPLICATE_SOURCE_ID',
    duplicateHelperKey: 'DUPLICATE_HELPER_KEY',
    missingKeyPart: 'MISSING_KEY_PART'
  }
};

const PRICE_HELPER_CACHE = {};

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu(PRICE_MODEL.menuName);

  if (typeof appendEntryAutomationMenuItems_ === 'function') {
    appendEntryAutomationMenuItems_(menu);
    menu.addSeparator();
  }

  menu
    .addItem('가격 모델 시트 초기화', 'initializePriceModelSheets')
    .addItem('가격 helper 재생성', 'rebuildPriceHelper')
    .addItem('가격 helper 진단', 'showPriceHelperDiagnostics')
    .addToUi();
}

function initializePriceModelSheets() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  setUpPriceModelSheet_(spreadsheet, PRICE_MODEL.sheets.source, PRICE_MODEL.sourceHeaders, false);
  setUpPriceModelSheet_(spreadsheet, PRICE_MODEL.sheets.helper, PRICE_MODEL.helperHeaders, true);
  setUpPriceModelSheet_(spreadsheet, PRICE_MODEL.sheets.errors, PRICE_MODEL.errorHeaders, true);

  SpreadsheetApp.getUi().alert(
    '가격 모델 시트를 초기화했습니다.\n- 분양가_source\n- 분양가_helper\n- 분양가_helper_errors'
  );
}

function rebuildPriceHelper() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ensurePriceModelSheet_(
    spreadsheet,
    PRICE_MODEL.sheets.source,
    PRICE_MODEL.sourceHeaders,
    false
  );
  var helperSheet = ensurePriceModelSheet_(
    spreadsheet,
    PRICE_MODEL.sheets.helper,
    PRICE_MODEL.helperHeaders,
    true
  );
  var errorSheet = ensurePriceModelSheet_(
    spreadsheet,
    PRICE_MODEL.sheets.errors,
    PRICE_MODEL.errorHeaders,
    true
  );

  validateSheetHeaders_(sourceSheet, PRICE_MODEL.sourceHeaders);
  validateSheetHeaders_(helperSheet, PRICE_MODEL.helperHeaders);
  validateSheetHeaders_(errorSheet, PRICE_MODEL.errorHeaders);

  var sourceValues = sourceSheet.getDataRange().getValues();
  var headerIndex = buildHeaderIndex_(PRICE_MODEL.sourceHeaders);
  var errors = [];
  var helperRows = [];
  var seenSourceIds = {};
  var helperKeyOwners = {};
  var generatedAt = new Date();

  for (var rowIndex = 1; rowIndex < sourceValues.length; rowIndex++) {
    var row = sourceValues[rowIndex];
    if (isRowBlank_(row)) {
      continue;
    }

    var sourceRowNumber = rowIndex + 1;
    var record = mapRowToObject_(row, headerIndex);
    if (!isPriceSourceRowActive_(record.active)) {
      continue;
    }

    var sourceId = normalizeCellString_(record.source_id);
    if (!sourceId) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.missingRequired,
        sourceId,
        sourceRowNumber,
        'source_id가 비어 있습니다.',
        '',
        '',
        generatedAt
      ));
      continue;
    }

    if (seenSourceIds[sourceId]) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.duplicateSourceId,
        sourceId,
        sourceRowNumber,
        '같은 source_id가 두 번 이상 등장했습니다.',
        '',
        seenSourceIds[sourceId],
        generatedAt
      ));
      continue;
    }
    seenSourceIds[sourceId] = String(sourceRowNumber);

    var keyBase = normalizeCellString_(record.단지ID) || normalizeCellString_(record.단지명);
    var typeName = normalizeCellString_(record.타입);
    if (!keyBase || !typeName) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.missingKeyPart,
        sourceId,
        sourceRowNumber,
        '단지ID 또는 단지명, 타입이 비어 있습니다.',
        '',
        '',
        generatedAt
      ));
      continue;
    }

    var dongResult = parseDongTokens_(record.동_raw);
    if (dongResult.error) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.invalidDongToken,
        sourceId,
        sourceRowNumber,
        dongResult.error,
        '',
        '',
        generatedAt
      ));
      continue;
    }

    var lineResult = parseLineTokens_(record.라인_raw);
    if (lineResult.error) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.invalidLineToken,
        sourceId,
        sourceRowNumber,
        lineResult.error,
        '',
        '',
        generatedAt
      ));
      continue;
    }

    var floorResult = parseFloorRange_(record.층_from, record.층_to);
    if (floorResult.error) {
      errors.push(buildErrorRow_(
        PRICE_MODEL.errorTypes.invalidFloorRange,
        sourceId,
        sourceRowNumber,
        floorResult.error,
        '',
        '',
        generatedAt
      ));
      continue;
    }

    for (var d = 0; d < dongResult.tokens.length; d++) {
      for (var l = 0; l < lineResult.tokens.length; l++) {
        for (var f = 0; f < floorResult.tokens.length; f++) {
          var dong = dongResult.tokens[d];
          var line = lineResult.tokens[l];
          var floor = floorResult.tokens[f];
          var helperKey = buildHelperKey_(keyBase, typeName, dong, line, floor);

          if (helperKeyOwners[helperKey]) {
            errors.push(buildErrorRow_(
              PRICE_MODEL.errorTypes.duplicateHelperKey,
              sourceId,
              sourceRowNumber,
              '같은 helper_key가 두 규칙에서 생성되었습니다.',
              helperKey,
              helperKeyOwners[helperKey],
              generatedAt
            ));
            continue;
          }

          helperKeyOwners[helperKey] = sourceId;
          helperRows.push([
            helperKey,
            sourceId,
            normalizeCellString_(record.단지ID),
            normalizeCellString_(record.단지명),
            typeName,
            dong,
            floor,
            line,
            normalizeNumberCell_(record.분양가),
            normalizeNumberCell_(record.계약금),
            normalizeNumberCell_(record.중도금),
            normalizeNumberCell_(record.잔금),
            sourceRowNumber,
            generatedAt
          ]);
        }
      }
    }
  }

  writeSheetWithHeaders_(errorSheet, PRICE_MODEL.errorHeaders, errors);
  errorSheet.hideSheet();

  var hasBlockingErrors = hasBlockingPriceHelperErrors_(errors);
  if (hasBlockingErrors) {
    clearPriceHelperCache_(spreadsheet.getId());
    SpreadsheetApp.getUi().alert(
      '가격 helper 생성에 실패했습니다.\n오류 ' +
      errors.length +
      '건이 기록되었습니다.\n분양가_helper_errors 시트를 확인해주세요.'
    );
    return {
      ok: false,
      helperRowCount: helperRows.length,
      errorCount: errors.length,
      partial: false,
      hasBlockingErrors: true
    };
  }

  writeSheetWithHeaders_(helperSheet, PRICE_MODEL.helperHeaders, helperRows);
  helperSheet.hideSheet();
  clearPriceHelperCache_(spreadsheet.getId());

  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert(
      '가격 helper를 부분 재생성했습니다.\n생성 행 수: ' +
      helperRows.length +
      '\n오류 행 수: ' +
      errors.length +
      '\n분양가_helper_errors 시트를 확인해주세요.'
    );

    return {
      ok: true,
      helperRowCount: helperRows.length,
      errorCount: errors.length,
      partial: true,
      hasBlockingErrors: false
    };
  }

  SpreadsheetApp.getUi().alert(
    '가격 helper를 재생성했습니다.\n생성 행 수: ' + helperRows.length
  );

  return {
    ok: true,
    helperRowCount: helperRows.length,
    errorCount: 0,
    partial: false,
    hasBlockingErrors: false
  };
}

function showPriceHelperDiagnostics() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var helperSheet = ensurePriceModelSheet_(
    spreadsheet,
    PRICE_MODEL.sheets.helper,
    PRICE_MODEL.helperHeaders,
    true
  );
  var errorSheet = ensurePriceModelSheet_(
    spreadsheet,
    PRICE_MODEL.sheets.errors,
    PRICE_MODEL.errorHeaders,
    true
  );

  validateSheetHeaders_(helperSheet, PRICE_MODEL.helperHeaders);
  validateSheetHeaders_(errorSheet, PRICE_MODEL.errorHeaders);

  var helperLastRow = Math.max(helperSheet.getLastRow() - 1, 0);
  var errorLastRow = Math.max(errorSheet.getLastRow() - 1, 0);
  var lastGeneratedAt = '';

  if (helperLastRow > 0) {
    lastGeneratedAt = helperSheet.getRange(2, 14).getDisplayValue();
  }

  var message = [
    '가격 helper 진단',
    '- helper 행 수: ' + helperLastRow,
    '- error 행 수: ' + errorLastRow,
    '- 마지막 생성시각: ' + (lastGeneratedAt || '없음')
  ].join('\n');

  SpreadsheetApp.getUi().alert(message);
  return {
    helperRowCount: helperLastRow,
    errorRowCount: errorLastRow,
    generatedAt: lastGeneratedAt || ''
  };
}

/**
 * Custom function for spreadsheet cells.
 *
 * Example:
 * =LOOKUP_APARTMENT_PRICE("CPX_001","84A","102","2504")
 */
function LOOKUP_APARTMENT_PRICE(complexId, typeName, dong, ho) {
  if (
    !normalizeCellString_(complexId) ||
    !normalizeCellString_(typeName) ||
    !normalizeCellString_(dong) ||
    !normalizeCellString_(ho)
  ) {
    return '';
  }

  try {
    var row = lookupPriceFromHelper_(complexId, typeName, dong, ho);
    return row ? row.salePrice : '';
  } catch (error) {
    return 'PRICE_LOOKUP_ERROR: ' + error.message;
  }
}

function lookupPriceFromHelper_(complexId, typeName, dong, ho) {
  var normalizedKeyBase = normalizeCellString_(complexId);
  var normalizedType = normalizeCellString_(typeName);
  var normalizedDong = normalizeDongLookupValue_(dong);
  var hoParts = parseHoForLookup_(ho);
  var helperKey = buildHelperKey_(
    normalizedKeyBase,
    normalizedType,
    normalizedDong,
    hoParts.line,
    hoParts.floor
  );
  var helperIndex = getPriceHelperIndex_(SpreadsheetApp.getActiveSpreadsheet());
  var row = helperIndex[helperKey];

  if (!row) {
    return null;
  }

  return {
    helperKey: helperKey,
    sourceId: row.sourceId,
    complexId: row.complexId,
    complexName: row.complexName,
    typeName: row.typeName,
    dong: row.dong,
    floor: row.floor,
    line: row.line,
    salePrice: row.salePrice,
    contractPrice: row.contractPrice,
    middlePrice: row.middlePrice,
    balancePrice: row.balancePrice,
    sourceRow: row.sourceRow
  };
}

function ensurePriceModelSheet_(spreadsheet, sheetName, headers, hidden) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  var isNewSheet = false;
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    isNewSheet = true;
  }

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  if (isNewSheet || isHeaderRowBlank_(sheet, headers.length)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  if (hidden) {
    sheet.hideSheet();
  } else if (sheet.isSheetHidden()) {
    sheet.showSheet();
  }

  return sheet;
}

function setUpPriceModelSheet_(spreadsheet, sheetName, headers, hidden) {
  var sheet = ensurePriceModelSheet_(spreadsheet, sheetName, headers, hidden);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function validateSheetHeaders_(sheet, expectedHeaders) {
  var actualHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0];
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (String(actualHeaders[i] || '').trim() !== expectedHeaders[i]) {
      throw new Error(
        sheet.getName() +
        ' 헤더가 예상과 다릅니다. ' +
        'expected=' +
        expectedHeaders[i] +
        ', actual=' +
        String(actualHeaders[i] || '').trim()
      );
    }
  }
}

function buildHeaderIndex_(headers) {
  var index = {};
  for (var i = 0; i < headers.length; i++) {
    index[headers[i]] = i;
  }
  return index;
}

function mapRowToObject_(row, headerIndex) {
  var record = {};
  var headers = Object.keys(headerIndex);
  for (var i = 0; i < headers.length; i++) {
    record[headers[i]] = row[headerIndex[headers[i]]];
  }
  return record;
}

function isRowBlank_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i] || '').trim() !== '') {
      return false;
    }
  }
  return true;
}

function isHeaderRowBlank_(sheet, width) {
  var values = sheet.getRange(1, 1, 1, width).getValues()[0];
  return isRowBlank_(values);
}

function isPriceSourceRowActive_(value) {
  if (value === true) return true;

  var raw = normalizeCellString_(value).toUpperCase();
  return raw === 'TRUE' || raw === 'Y' || raw === 'YES' || raw === '1';
}

function normalizeCellString_(value) {
  return String(value || '').trim();
}

function normalizeNumberCell_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return '';
  }

  if (typeof value === 'number') {
    return value;
  }

  var numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return isNaN(numeric) ? '' : numeric;
}

function buildErrorRow_(errorType, sourceId, sourceRow, detail, conflictingKey, conflictingSourceId, loggedAt) {
  return [
    errorType,
    sourceId || '',
    sourceRow || '',
    detail || '',
    conflictingKey || '',
    conflictingSourceId || '',
    loggedAt
  ];
}

function writeSheetWithHeaders_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function hasBlockingPriceHelperErrors_(errors) {
  for (var i = 0; i < errors.length; i++) {
    var errorType = normalizeCellString_(errors[i][0]);
    if (
      errorType === PRICE_MODEL.errorTypes.duplicateSourceId ||
      errorType === PRICE_MODEL.errorTypes.duplicateHelperKey
    ) {
      return true;
    }
  }

  return false;
}

function parseDongTokens_(dongRaw) {
  var raw = normalizeCellString_(dongRaw);
  if (!raw) {
    return { tokens: [], error: '동_raw가 비어 있습니다.' };
  }

  var normalized = raw.replace(/,/g, ' ');
  if (/동\d/.test(normalized)) {
    return { tokens: [], error: '동_raw 구분자가 누락되었습니다: ' + raw };
  }

  var parts = normalized.split(/\s+/).filter(Boolean);
  var tokens = [];
  var seen = {};

  for (var i = 0; i < parts.length; i++) {
    var match = parts[i].match(/^(\d+)(?:~(\d+))?동?$/);
    if (!match) {
      return { tokens: [], error: '동_raw를 파싱할 수 없습니다: ' + parts[i] };
    }

    var start = Number(match[1]);
    var end = match[2] ? Number(match[2]) : start;
    if (start > end) {
      return { tokens: [], error: '동 range가 올바르지 않습니다: ' + parts[i] };
    }

    for (var value = start; value <= end; value++) {
      var dong = String(value);
      if (!seen[dong]) {
        seen[dong] = true;
        tokens.push(dong);
      }
    }
  }

  return { tokens: tokens, error: '' };
}

function parseLineTokens_(lineRaw) {
  var raw = normalizeCellString_(lineRaw);
  if (!raw) {
    return { tokens: [], error: '라인_raw가 비어 있습니다.' };
  }

  var normalized = raw.replace(/,/g, ' ');
  if (/호\d/.test(normalized)) {
    return { tokens: [], error: '라인_raw 구분자가 누락되었습니다: ' + raw };
  }

  var parts = normalized.split(/\s+/).filter(Boolean);
  var tokens = [];
  var seen = {};

  for (var i = 0; i < parts.length; i++) {
    var match = parts[i].match(/^(\d+)(?:~(\d+))?호?$/);
    if (!match) {
      return { tokens: [], error: '라인_raw를 파싱할 수 없습니다: ' + parts[i] };
    }

    var start = Number(match[1]);
    var end = match[2] ? Number(match[2]) : start;
    if (start > end) {
      return { tokens: [], error: '라인 range가 올바르지 않습니다: ' + parts[i] };
    }

    for (var value = start; value <= end; value++) {
      var line = padLineToken_(value);
      if (!seen[line]) {
        seen[line] = true;
        tokens.push(line);
      }
    }
  }

  return { tokens: tokens, error: '' };
}

function parseFloorRange_(fromValue, toValue) {
  var from = parseIntegerCell_(fromValue);
  if (from === null) {
    return { tokens: [], error: '층_from이 숫자가 아닙니다.' };
  }

  var to = normalizeCellString_(toValue) === '' ? from : parseIntegerCell_(toValue);
  if (to === null) {
    return { tokens: [], error: '층_to가 숫자가 아닙니다.' };
  }
  if (from > to) {
    return { tokens: [], error: '층_from이 층_to보다 큽니다.' };
  }

  var tokens = [];
  for (var floor = from; floor <= to; floor++) {
    tokens.push(String(floor));
  }

  return { tokens: tokens, error: '' };
}

function parseHoForLookup_(ho) {
  var digits = String(ho || '').replace(/[^0-9]/g, '');
  if (digits.length < 3) {
    throw new Error('호 값에서 층/라인을 분리할 수 없습니다: ' + ho);
  }

  var line = digits.slice(-2);
  var floor = String(Number(digits.slice(0, -2)));
  if (!floor || floor === 'NaN') {
    throw new Error('호 값에서 층을 파싱할 수 없습니다: ' + ho);
  }

  return {
    floor: floor,
    line: padLineToken_(line)
  };
}

function normalizeDongLookupValue_(dong) {
  var raw = normalizeCellString_(dong);
  if (!raw) {
    throw new Error('동 값이 비어 있습니다.');
  }

  var match = raw.match(/^(\d+)동?$/);
  if (!match) {
    throw new Error('동 값을 정규화할 수 없습니다: ' + dong);
  }

  return String(Number(match[1]));
}

function buildHelperKey_(complexIdOrName, typeName, dong, line, floor) {
  var parts = [
    normalizeCellString_(complexIdOrName),
    normalizeCellString_(typeName),
    normalizeCellString_(dong),
    normalizeCellString_(line),
    normalizeCellString_(floor)
  ];

  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) {
      throw new Error('helper key를 만들기 위한 값이 비어 있습니다.');
    }
  }

  return parts.join('|');
}

function getPriceHelperIndex_(spreadsheet) {
  var spreadsheetId = spreadsheet.getId();
  if (PRICE_HELPER_CACHE[spreadsheetId]) {
    return PRICE_HELPER_CACHE[spreadsheetId];
  }

  var helperSheet = spreadsheet.getSheetByName(PRICE_MODEL.sheets.helper);
  if (!helperSheet) {
    throw new Error('분양가_helper 시트를 찾을 수 없습니다.');
  }

  validateSheetHeaders_(helperSheet, PRICE_MODEL.helperHeaders);
  var values = helperSheet.getDataRange().getValues();
  var index = {};

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var row = values[rowIndex];
    var helperKey = normalizeCellString_(row[0]);
    if (!helperKey) {
      continue;
    }

    index[helperKey] = {
      sourceId: row[1],
      complexId: row[2],
      complexName: row[3],
      typeName: row[4],
      dong: row[5],
      floor: row[6],
      line: row[7],
      salePrice: row[8],
      contractPrice: row[9],
      middlePrice: row[10],
      balancePrice: row[11],
      sourceRow: row[12]
    };
  }

  PRICE_HELPER_CACHE[spreadsheetId] = index;
  return index;
}

function clearPriceHelperCache_(spreadsheetId) {
  delete PRICE_HELPER_CACHE[spreadsheetId];
}

function parseIntegerCell_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  var normalized = normalizeCellString_(value);
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function padLineToken_(value) {
  var numeric = String(value).replace(/[^0-9]/g, '');
  if (!numeric) {
    throw new Error('라인 값을 정규화할 수 없습니다: ' + value);
  }

  return numeric.length >= 2 ? numeric : '0' + numeric;
}
