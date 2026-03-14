const ENTRY_AUTOMATION = {
  sheets: {
    form: '아파트등록',
    property: '아파트',
    complex: '아파트단지',
    type: '타입',
    balcony: '발코니',
    option: '옵션',
    salePrice: '분양가'
  },
  fieldCells: {
    단지명: 'C4',
    동: 'C5',
    호: 'C6',
    타입: 'C7',
    거래유형: 'C8',
    거래상태: 'C9',
    분양가: 'C10',
    발코니: 'C11',
    옵션비: 'C12',
    프리미엄: 'C13',
    합계: 'C14',
    매매가: 'C15',
    전세가: 'C16',
    보증금: 'C17',
    월세: 'C18',
    관리비: 'C19',
    매물설명: 'C20',
    고객: 'C21',
    연락처: 'C22',
    입주가능일: 'C23',
    입주가능협의여부: 'C24',
    방향: 'C25',
    만기예정일: 'C26'
  },
  labelCells: {
    startRow: 4,
    column: 2,
    labels: [
      '단지명',
      '동',
      '호',
      '타입',
      '거래유형',
      '거래상태',
      '분양가',
      '발코니',
      '옵션비',
      '프리미엄',
      '합계',
      '매매가',
      '전세가',
      '보증금',
      '월세',
      '관리비',
      '매물설명',
      '고객',
      '연락처',
      '입주가능일',
      '입주가능협의여부',
      '방향',
      '만기예정일'
    ]
  },
  panel: {
    headerRange: 'L4:Q4',
    bodyStartRow: 5,
    bodyEndRow: 200,
    checkboxColumn: 12,
    categoryColumn: 13,
    detailColumn: 14,
    amountColumn: 15,
    keyColumn: 16,
    kindColumn: 17,
    headers: ['선택', '옵션구분', '내역', '금액(만)', 'selection_key', 'row_kind']
  },
  metaCells: {
    propertyId: 'AA1',
    mode: 'AA2',
    sourceRow: 'AA3',
    priceStatus: 'AA4',
    message: 'AA5'
  },
  defaults: {
    mode: 'NEW',
    거래상태: '접수',
    입주가능협의여부: false
  },
  requiredFields: ['단지명', '동', '호', '타입', '거래유형'],
  panelKinds: {
    balcony: 'BALCONY',
    option: 'OPTION'
  }
};

const ENTRY_CACHE = {};

function appendEntryAutomationMenuItems_(menu) {
  menu
    .addItem('입력폼 레이아웃 초기화', 'initializeEntryFormLayout')
    .addItem('입력폼 초기화', 'resetPropertyForm')
    .addItem('타입 패널 다시 생성', 'refreshTypePanel')
    .addItem('가격/합계 다시 계산', 'recalculateEntryForm')
    .addItem('기존 매물 불러오기', 'loadPropertyIntoForm')
    .addItem('저장', 'savePropertyFromForm')
    .addItem('입력 진단', 'showEntryDiagnostics');
}

function onEdit(e) {
  if (!e || !e.range) {
    return;
  }

  var sheet = e.range.getSheet();
  if (sheet.getName() !== ENTRY_AUTOMATION.sheets.form) {
    return;
  }

  var a1 = e.range.getA1Notation();

  if (a1 === ENTRY_AUTOMATION.fieldCells.단지명) {
    clearLoadedPropertyMeta_();
    updateComplexValidation_();
    updateTypeValidation_();
    refreshTypePanel_({ forcePriceLookup: false, preserveSelections: false });
    return;
  }

  if (a1 === ENTRY_AUTOMATION.fieldCells.타입) {
    clearLoadedPropertyMeta_();
    refreshTypePanel_({ forcePriceLookup: true, preserveSelections: false });
    return;
  }

  if (a1 === ENTRY_AUTOMATION.fieldCells.동 || a1 === ENTRY_AUTOMATION.fieldCells.호) {
    clearLoadedPropertyMeta_();
    recalculateEntryForm_({ forcePriceLookup: true });
    return;
  }

  if (a1 === ENTRY_AUTOMATION.fieldCells.프리미엄) {
    recalculateEntryForm_({ forcePriceLookup: false });
    return;
  }

  if (a1 === ENTRY_AUTOMATION.fieldCells.거래유형) {
    clearLoadedPropertyMeta_();
    return;
  }

  if (
    e.range.getColumn() === ENTRY_AUTOMATION.panel.checkboxColumn &&
    e.range.getRow() >= ENTRY_AUTOMATION.panel.bodyStartRow &&
    e.range.getRow() <= ENTRY_AUTOMATION.panel.bodyEndRow
  ) {
    recalculateEntryForm_({ forcePriceLookup: false });
  }
}

function initializeEntryFormLayout() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var labels = ENTRY_AUTOMATION.labelCells.labels.map(function(label) {
    return [label];
  });

  formSheet
    .getRange(
      ENTRY_AUTOMATION.labelCells.startRow,
      ENTRY_AUTOMATION.labelCells.column,
      labels.length,
      1
    )
    .setValues(labels);
  formSheet.getRange(ENTRY_AUTOMATION.panel.headerRange).setValues([ENTRY_AUTOMATION.panel.headers]);
  formSheet.hideColumns(ENTRY_AUTOMATION.panel.keyColumn, 2);
  formSheet
    .getRange(ENTRY_AUTOMATION.fieldCells.분양가 + ':' + ENTRY_AUTOMATION.fieldCells.합계)
    .setNumberFormat('#,##0');
  formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.amountColumn,
      ENTRY_AUTOMATION.panel.bodyEndRow - ENTRY_AUTOMATION.panel.bodyStartRow + 1,
      1
    )
    .setNumberFormat('#,##0');

  updateComplexValidation_();
  updateTypeValidation_();
  clearOptionPanel_();
  clearEntryMeta_(false);

  if (!normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.거래상태).getValue())) {
    formSheet.getRange(ENTRY_AUTOMATION.fieldCells.거래상태).setValue(ENTRY_AUTOMATION.defaults.거래상태);
  }
  if (normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.입주가능협의여부).getValue()) === '') {
    formSheet
      .getRange(ENTRY_AUTOMATION.fieldCells.입주가능협의여부)
      .setValue(ENTRY_AUTOMATION.defaults.입주가능협의여부);
  }

  SpreadsheetApp.getUi().alert('아파트등록 입력폼 레이아웃을 초기화했습니다.');
}

function refreshTypePanel() {
  refreshTypePanel_({ forcePriceLookup: true, preserveSelections: true });
}

function recalculateEntryForm() {
  recalculateEntryForm_({ forcePriceLookup: true });
}

function loadPropertyIntoForm() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var propertySheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.property);
  var headers = getTrimmedHeaders_(propertySheet);
  var propertyMatch = null;

  try {
    propertyMatch = findPropertyMatch_(propertySheet, headers, readFormFields_());
  } catch (error) {
    SpreadsheetApp.getUi().alert(error.message);
    return;
  }

  if (!propertyMatch) {
    SpreadsheetApp.getUi().alert('불러올 매물을 찾지 못했습니다. 단지명/동/호/타입/거래유형 또는 메타 ID를 확인해주세요.');
    return;
  }

  var rowObject = rowToObject_(headers, propertyMatch.row);
  writeFormFields_({
    단지명: rowObject['단지명'],
    동: rowObject['동'],
    호: rowObject['호'],
    타입: rowObject['타입'],
    거래유형: rowObject['거래유형'],
    거래상태: rowObject['거래상태'] || ENTRY_AUTOMATION.defaults.거래상태,
    분양가: parseManAmount_(rowObject['분양가']),
    발코니: parseManAmount_(rowObject['발코니']),
    옵션비: parseManAmount_(rowObject['옵션비']),
    프리미엄: parseManAmount_(rowObject['프리미엄']),
    합계: parseManAmount_(rowObject['합계']),
    매매가: parseManAmount_(rowObject['매매가']),
    전세가: parseManAmount_(rowObject['전세가']),
    보증금: parseManAmount_(rowObject['보증금']),
    월세: parseManAmount_(rowObject['월세']),
    관리비: parseManAmount_(rowObject['관리비']),
    매물설명: rowObject['매물설명'],
    고객: rowObject['고객'],
    연락처: rowObject['연락처'],
    입주가능일: rowObject['입주가능일'],
    입주가능협의여부: rowObject['입주가능협의여부'],
    방향: rowObject['방향'],
    만기예정일: rowObject['만기예정일']
  });

  updateComplexValidation_();
  updateTypeValidation_();
  renderSelectionPanelForForm_({
    preserveSelectedKeys: parseSelectionField_(rowObject['선택옵션']),
    forcePriceLookup: false
  });

  if (parseManAmount_(rowObject['발코니']) > 0) {
    ensureBalconySelectionChecked_();
  }

  setEntryMeta_({
    propertyId: rowObject['ID'],
    mode: 'EDIT',
    sourceRow: propertyMatch.rowNumber,
    priceStatus: 'LOADED_FROM_DB',
    message: '기존 매물을 불러왔습니다.'
  });

  recalculateEntryForm_({ forcePriceLookup: false });
  SpreadsheetApp.getUi().alert('기존 매물을 입력폼으로 불러왔습니다.');
}

function savePropertyFromForm() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var propertySheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.property);
  var formData = readFormFields_();
  applyFormDefaults_(formData);

  var missingFields = ENTRY_AUTOMATION.requiredFields.filter(function(fieldName) {
    return normalizeCellString_(formData[fieldName]) === '';
  });
  if (missingFields.length > 0) {
    SpreadsheetApp.getUi().alert('필수 항목을 입력해주세요: ' + missingFields.join(', '));
    return;
  }

  if (parseManAmount_(formData['분양가']) <= 0) {
    SpreadsheetApp.getUi().alert('분양가가 비어 있습니다. 가격 조회를 먼저 확인해주세요.');
    return;
  }

  var complexInfo = getComplexInfoByName_(formData['단지명']);
  if (!complexInfo) {
    SpreadsheetApp.getUi().alert('아파트단지 시트에서 단지 정보를 찾지 못했습니다: ' + formData['단지명']);
    return;
  }

  var headers = getTrimmedHeaders_(propertySheet);
  var headerIndex = buildHeaderIndex_(headers);
  var propertyValues = propertySheet.getDataRange().getValues();
  var meta = readEntryMeta_();
  var existingMatch = meta.propertyId
    ? findPropertyById_(propertyValues, headers, headerIndex, meta.propertyId)
    : null;
  var duplicateMatch = null;

  try {
    duplicateMatch = findPropertyByComposite_(
      propertyValues,
      headerIndex,
      formData['단지명'],
      formData['동'],
      formData['호'],
      formData['타입'],
      formData['거래유형']
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(error.message);
    return;
  }

  if (!existingMatch && duplicateMatch) {
    SpreadsheetApp.getUi().alert(
      '같은 단지/동/호/타입/거래유형 조합의 매물이 이미 있습니다. 먼저 불러온 뒤 수정으로 저장해주세요.'
    );
    return;
  }

  var panelSelections = getSelectedPanelRows_();
  var existingRow = existingMatch ? existingMatch.row.slice() : new Array(headers.length).fill('');
  var id = existingMatch ? existingMatch.object['ID'] : generateShortId_();
  var selectedOptionText = buildSelectionField_(panelSelections);
  var dAdId = buildAdId_(complexInfo, formData);
  var address = buildAddressFromComplexInfo_(complexInfo);
  var now = new Date();
  var writer = resolveEntryWriter_();

  setRowValueByHeader_(existingRow, headerIndex, 'ID', id);
  setRowValueByHeader_(existingRow, headerIndex, 'D_AD_ID', dAdId);
  setRowValueByHeader_(existingRow, headerIndex, '주소', address);
  setRowValueByHeader_(existingRow, headerIndex, '시도', complexInfo['시도']);
  setRowValueByHeader_(existingRow, headerIndex, '시군구', complexInfo['시군구']);
  setRowValueByHeader_(existingRow, headerIndex, '동읍면', complexInfo['동읍면']);
  setRowValueByHeader_(existingRow, headerIndex, '통반리', complexInfo['통반리']);
  setRowValueByHeader_(existingRow, headerIndex, '지번', complexInfo['지번']);
  setRowValueByHeader_(existingRow, headerIndex, '단지명', formData['단지명']);
  setRowValueByHeader_(existingRow, headerIndex, '동', normalizeCellString_(formData['동']));
  setRowValueByHeader_(existingRow, headerIndex, '호', normalizeCellString_(formData['호']));
  setRowValueByHeader_(existingRow, headerIndex, '타입', normalizeCellString_(formData['타입']));
  setRowValueByHeader_(existingRow, headerIndex, '거래유형', normalizeCellString_(formData['거래유형']));
  setRowValueByHeader_(existingRow, headerIndex, '거래상태', normalizeCellString_(formData['거래상태']));
  setRowValueByHeader_(existingRow, headerIndex, '분양가', parseManAmount_(formData['분양가']));
  setRowValueByHeader_(existingRow, headerIndex, '발코니', parseManAmount_(formData['발코니']));
  setRowValueByHeader_(existingRow, headerIndex, '옵션비', parseManAmount_(formData['옵션비']));
  setRowValueByHeader_(existingRow, headerIndex, '프리미엄', parseManAmount_(formData['프리미엄']));
  setRowValueByHeader_(existingRow, headerIndex, '합계', parseManAmount_(formData['합계']));
  setRowValueByHeader_(existingRow, headerIndex, '매매가', parseManAmount_(formData['매매가']));
  setRowValueByHeader_(existingRow, headerIndex, '전세가', parseManAmount_(formData['전세가']));
  setRowValueByHeader_(existingRow, headerIndex, '보증금', parseManAmount_(formData['보증금']));
  setRowValueByHeader_(existingRow, headerIndex, '월세', parseManAmount_(formData['월세']));
  setRowValueByHeader_(existingRow, headerIndex, '관리비', parseManAmount_(formData['관리비']));
  setRowValueByHeader_(existingRow, headerIndex, '매물설명', formData['매물설명']);
  setRowValueByHeader_(existingRow, headerIndex, '고객', formData['고객']);
  setRowValueByHeader_(existingRow, headerIndex, '연락처', normalizePhone_(formData['연락처']));
  setRowValueByHeader_(existingRow, headerIndex, '입주가능일', formData['입주가능일']);
  setRowValueByHeader_(existingRow, headerIndex, '입주가능협의여부', normalizeBooleanField_(formData['입주가능협의여부']));
  setRowValueByHeader_(existingRow, headerIndex, '방향', formData['방향']);
  setRowValueByHeader_(existingRow, headerIndex, '만기예정일', formData['만기예정일']);
  setRowValueByHeader_(existingRow, headerIndex, '선택옵션', selectedOptionText);
  setRowValueByHeader_(existingRow, headerIndex, '단지ID', complexInfo['단지ID']);
  setRowValueByHeader_(existingRow, headerIndex, '접수자', existingMatch ? existingMatch.object['접수자'] || writer : writer);
  setRowValueByHeader_(existingRow, headerIndex, '접수일', existingMatch ? existingMatch.object['접수일'] || now : now);

  if (existingMatch) {
    propertySheet
      .getRange(existingMatch.rowNumber, 1, 1, headers.length)
      .setValues([existingRow]);
  } else {
    propertySheet.appendRow(existingRow);
  }

  clearSheetCache_();

  setEntryMeta_({
    propertyId: id,
    mode: 'EDIT',
    sourceRow: existingMatch ? existingMatch.rowNumber : propertySheet.getLastRow(),
    priceStatus: readEntryMeta_().priceStatus || '',
    message: existingMatch ? '기존 행을 수정 저장했습니다.' : '새 매물을 저장했습니다.'
  });

  SpreadsheetApp.getUi().alert(existingMatch ? '기존 매물을 수정 저장했습니다.' : '새 매물을 저장했습니다.');
}

function resetPropertyForm() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var fieldNames = Object.keys(ENTRY_AUTOMATION.fieldCells);

  for (var i = 0; i < fieldNames.length; i++) {
    formSheet.getRange(ENTRY_AUTOMATION.fieldCells[fieldNames[i]]).clearContent();
  }

  clearOptionPanel_();
  clearEntryMeta_(true);
  updateComplexValidation_();
  updateTypeValidation_();
  formSheet.getRange(ENTRY_AUTOMATION.fieldCells.거래상태).setValue(ENTRY_AUTOMATION.defaults.거래상태);
  formSheet
    .getRange(ENTRY_AUTOMATION.fieldCells.입주가능협의여부)
    .setValue(ENTRY_AUTOMATION.defaults.입주가능협의여부);
  formSheet.setActiveSelection(ENTRY_AUTOMATION.fieldCells.단지명);
}

function showEntryDiagnostics() {
  var meta = readEntryMeta_();
  var formData = readFormFields_();
  var selectedRows = getSelectedPanelRows_();
  var message = [
    '입력 진단',
    '- mode: ' + meta.mode,
    '- propertyId: ' + meta.propertyId,
    '- sourceRow: ' + meta.sourceRow,
    '- priceStatus: ' + meta.priceStatus,
    '- 단지명: ' + normalizeCellString_(formData['단지명']),
    '- 동/호/타입: ' + [formData['동'], formData['호'], formData['타입']].map(normalizeCellString_).join(' / '),
    '- 거래유형: ' + normalizeCellString_(formData['거래유형']),
    '- 분양가/발코니/옵션비/프리미엄/합계: ' +
      [
        parseManAmount_(formData['분양가']),
        parseManAmount_(formData['발코니']),
        parseManAmount_(formData['옵션비']),
        parseManAmount_(formData['프리미엄']),
        parseManAmount_(formData['합계'])
      ].join(' / '),
    '- 선택 row 수: ' + selectedRows.length,
    '- message: ' + meta.message
  ].join('\n');

  SpreadsheetApp.getUi().alert(message);
}

function refreshTypePanel_(options) {
  var opts = options || {};
  updateComplexValidation_();
  updateTypeValidation_();
  renderSelectionPanelForForm_({
    preserveSelectedKeys: opts.preserveSelections ? getCurrentSelectionKeys_() : [],
    forcePriceLookup: opts.forcePriceLookup
  });
}

function renderSelectionPanelForForm_(options) {
  var opts = options || {};
  var formData = readFormFields_();
  var complexName = normalizeCellString_(formData['단지명']);
  var typeName = normalizeCellString_(formData['타입']);

  if (!complexName || !typeName) {
    clearOptionPanel_();
    if (opts.forcePriceLookup) {
      recalculateEntryForm_({ forcePriceLookup: true });
    }
    return;
  }

  var preserveMap = {};
  var preserveKeys = opts.preserveSelectedKeys || [];
  for (var i = 0; i < preserveKeys.length; i++) {
    preserveMap[preserveKeys[i]] = true;
  }

  var panelRows = [];
  var balconyRow = getBalconyRow_(complexName, typeName);
  if (balconyRow) {
    var balconyKey = buildBalconySelectionKey_(typeName);
    panelRows.push({
      checked: Boolean(preserveMap[balconyKey]),
      category: '발코니',
      detail: '발코니 확장',
      amountMan: convertRawWonToMan_(balconyRow['발코니 확장 공급금액']),
      selectionKey: balconyKey,
      rowKind: ENTRY_AUTOMATION.panelKinds.balcony
    });
  }

  var optionRows = getOptionRows_(complexName, typeName);
  for (var j = 0; j < optionRows.length; j++) {
    var optionSelectionKey = buildOptionSelectionKey_(optionRows[j]);
    panelRows.push({
      checked: Boolean(preserveMap[optionSelectionKey]),
      category: normalizeCellString_(optionRows[j]['옵션구분']),
      detail: buildOptionDetail_(optionRows[j]),
      amountMan: convertRawWonToMan_(optionRows[j]['공급금액']),
      selectionKey: optionSelectionKey,
      rowKind: ENTRY_AUTOMATION.panelKinds.option
    });
  }

  renderSelectionPanel_(panelRows);
  recalculateEntryForm_({ forcePriceLookup: Boolean(opts.forcePriceLookup) });
}

function recalculateEntryForm_(options) {
  var opts = options || {};
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var priceLookupResult = null;

  if (opts.forcePriceLookup) {
    try {
      priceLookupResult = lookupPriceForCurrentForm_();
      if (priceLookupResult) {
        formSheet.getRange(ENTRY_AUTOMATION.fieldCells.분양가).setValue(priceLookupResult.salePriceMan);
        setEntryMeta_({
          priceStatus: priceLookupResult.source,
          message: priceLookupResult.message
        });
      } else {
        formSheet.getRange(ENTRY_AUTOMATION.fieldCells.분양가).clearContent();
        setEntryMeta_({
          priceStatus: 'MISSING',
          message: '가격을 찾지 못했습니다.'
        });
      }
    } catch (error) {
      formSheet.getRange(ENTRY_AUTOMATION.fieldCells.분양가).clearContent();
      setEntryMeta_({
        priceStatus: 'ERROR',
        message: error.message
      });
    }
  }

  var selectedRows = getSelectedPanelRows_();
  var balconyTotal = 0;
  var optionTotal = 0;

  for (var i = 0; i < selectedRows.length; i++) {
    if (selectedRows[i].rowKind === ENTRY_AUTOMATION.panelKinds.balcony) {
      balconyTotal += selectedRows[i].amountMan;
    } else {
      optionTotal += selectedRows[i].amountMan;
    }
  }

  formSheet.getRange(ENTRY_AUTOMATION.fieldCells.발코니).setValue(balconyTotal || '');
  formSheet.getRange(ENTRY_AUTOMATION.fieldCells.옵션비).setValue(optionTotal || '');

  var salePrice = parseManAmount_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.분양가).getValue());
  var premium = parseManAmount_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.프리미엄).getValue());
  var total = salePrice + balconyTotal + optionTotal + premium;

  formSheet.getRange(ENTRY_AUTOMATION.fieldCells.합계).setValue(total || '');
}

function lookupPriceForCurrentForm_() {
  var formData = readFormFields_();
  var complexInfo = getComplexInfoByName_(formData['단지명']);
  var complexId = complexInfo ? normalizeCellString_(complexInfo['단지ID']) : '';
  var typeName = normalizeCellString_(formData['타입']);
  var dong = normalizeCellString_(formData['동']);
  var ho = normalizeCellString_(formData['호']);

  if (!normalizeCellString_(formData['단지명']) || !dong || !ho) {
    return null;
  }

  if (complexId && typeName) {
    try {
      var helperRow = lookupPriceFromHelper_(complexId, typeName, dong, ho);
      if (helperRow) {
        return {
          source: 'HELPER',
          salePriceMan: convertRawWonToMan_(helperRow.salePrice),
          message: '분양가_helper에서 가격을 조회했습니다.'
        };
      }
    } catch (error) {
      // Fall back to the legacy sheet when helper is unavailable or incomplete.
    }
  }

  var legacyRow = findLegacySalePriceRow_(formData['단지명'], dong, ho, typeName);
  if (!legacyRow) {
    return null;
  }

  return {
    source: 'LEGACY_PRICE',
    salePriceMan: convertRawWonToMan_(legacyRow['분양가']),
    message: '기존 분양가 시트에서 가격을 조회했습니다.'
  };
}

function updateComplexValidation_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var complexRows = getSheetObjects_(ENTRY_AUTOMATION.sheets.complex);
  var complexNames = [];
  var seen = {};

  for (var i = 0; i < complexRows.length; i++) {
    var complexName = normalizeCellString_(complexRows[i]['단지명']);
    if (!complexName || seen[complexName]) {
      continue;
    }
    seen[complexName] = true;
    complexNames.push(complexName);
  }

  complexNames.sort();
  applyListValidation_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.단지명), complexNames);
}

function updateTypeValidation_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var complexName = normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.단지명).getValue());
  var typeRows = getSheetObjects_(ENTRY_AUTOMATION.sheets.type);
  var typeNames = [];
  var seen = {};

  for (var i = 0; i < typeRows.length; i++) {
    if (normalizeCellString_(typeRows[i]['단지명']) !== complexName) {
      continue;
    }
    var typeName = normalizeCellString_(typeRows[i]['약식표기']);
    if (!typeName || seen[typeName]) {
      continue;
    }
    seen[typeName] = true;
    typeNames.push(typeName);
  }

  typeNames.sort();
  applyListValidation_(formSheet.getRange(ENTRY_AUTOMATION.fieldCells.타입), typeNames);
}

function getComplexInfoByName_(complexName) {
  var targetName = normalizeCellString_(complexName);
  if (!targetName) {
    return null;
  }

  var rows = getSheetObjects_(ENTRY_AUTOMATION.sheets.complex);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeCellString_(rows[i]['단지명']) === targetName) {
      return rows[i];
    }
  }
  return null;
}

function getBalconyRow_(complexName, typeName) {
  var rows = getSheetObjects_(ENTRY_AUTOMATION.sheets.balcony);
  for (var i = 0; i < rows.length; i++) {
    if (
      normalizeCellString_(rows[i]['단지명']) === normalizeCellString_(complexName) &&
      normalizeCellString_(rows[i]['약식 표기']) === normalizeCellString_(typeName)
    ) {
      return rows[i];
    }
  }
  return null;
}

function getOptionRows_(complexName, typeName) {
  var rows = getSheetObjects_(ENTRY_AUTOMATION.sheets.option);
  var filtered = [];
  for (var i = 0; i < rows.length; i++) {
    if (
      normalizeCellString_(rows[i]['단지명']) === normalizeCellString_(complexName) &&
      normalizeCellString_(rows[i]['타입']) === normalizeCellString_(typeName)
    ) {
      filtered.push(rows[i]);
    }
  }

  filtered.sort(function(a, b) {
    var left = normalizeCellString_(a['옵션구분']) + '|' + buildOptionDetail_(a);
    var right = normalizeCellString_(b['옵션구분']) + '|' + buildOptionDetail_(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return filtered;
}

function findLegacySalePriceRow_(complexName, dong, ho, typeName) {
  var rows = getSheetObjects_(ENTRY_AUTOMATION.sheets.salePrice);
  var exact = null;
  var relaxed = null;

  for (var i = 0; i < rows.length; i++) {
    if (
      normalizeCellString_(rows[i]['단지명']) !== normalizeCellString_(complexName) ||
      normalizeCellString_(rows[i]['동']) !== normalizeDongLookupValue_(dong) ||
      normalizeCellString_(rows[i]['호']) !== normalizeCellString_(ho)
    ) {
      continue;
    }

    if (normalizeCellString_(rows[i]['타입']) === normalizeCellString_(typeName)) {
      exact = rows[i];
      break;
    }

    if (!relaxed) {
      relaxed = rows[i];
    }
  }

  return exact || relaxed;
}

function findPropertyMatch_(propertySheet, headers, formData) {
  var values = propertySheet.getDataRange().getValues();
  var headerIndex = buildHeaderIndex_(headers);
  var meta = readEntryMeta_();

  if (meta.propertyId) {
    return findPropertyById_(values, headers, headerIndex, meta.propertyId);
  }

  return findPropertyByComposite_(
    values,
    headerIndex,
    formData['단지명'],
    formData['동'],
    formData['호'],
    formData['타입'],
    formData['거래유형']
  );
}

function findPropertyById_(values, headers, headerIndex, propertyId) {
  var idIndex = headerIndex['ID'];
  if (typeof idIndex === 'undefined') {
    return null;
  }

  var targetId = normalizeCellString_(propertyId);
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (normalizeCellString_(values[rowIndex][idIndex]) === targetId) {
      return {
        rowNumber: rowIndex + 1,
        row: values[rowIndex],
        object: rowToObject_(headers, values[rowIndex])
      };
    }
  }
  return null;
}

function findPropertyByComposite_(values, headerIndex, complexName, dong, ho, typeName, transactionType) {
  var matches = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (
      normalizeCellString_(values[rowIndex][headerIndex['단지명']]) === normalizeCellString_(complexName) &&
      normalizeCellString_(values[rowIndex][headerIndex['동']]) === normalizeCellString_(dong) &&
      normalizeCellString_(values[rowIndex][headerIndex['호']]) === normalizeCellString_(ho) &&
      normalizeCellString_(values[rowIndex][headerIndex['타입']]) === normalizeCellString_(typeName) &&
      normalizeCellString_(values[rowIndex][headerIndex['거래유형']]) === normalizeCellString_(transactionType)
    ) {
      matches.push({
        rowNumber: rowIndex + 1,
        row: values[rowIndex],
        object: rowToObject_(Object.keys(headerIndex), values[rowIndex])
      });
    }
  }

  if (matches.length > 1) {
    throw new Error('같은 단지/동/호/타입/거래유형 조합의 행이 여러 개 있습니다.');
  }
  return matches.length === 1 ? matches[0] : null;
}

function readFormFields_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var data = {};
  var fieldNames = Object.keys(ENTRY_AUTOMATION.fieldCells);

  for (var i = 0; i < fieldNames.length; i++) {
    data[fieldNames[i]] = formSheet.getRange(ENTRY_AUTOMATION.fieldCells[fieldNames[i]]).getValue();
  }

  return data;
}

function writeFormFields_(fieldValues) {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var fieldNames = Object.keys(ENTRY_AUTOMATION.fieldCells);

  for (var i = 0; i < fieldNames.length; i++) {
    if (Object.prototype.hasOwnProperty.call(fieldValues, fieldNames[i])) {
      formSheet.getRange(ENTRY_AUTOMATION.fieldCells[fieldNames[i]]).setValue(fieldValues[fieldNames[i]]);
    }
  }
}

function applyFormDefaults_(formData) {
  if (!normalizeCellString_(formData['거래상태'])) {
    formData['거래상태'] = ENTRY_AUTOMATION.defaults.거래상태;
  }
}

function getSelectedPanelRows_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var rowCount = ENTRY_AUTOMATION.panel.bodyEndRow - ENTRY_AUTOMATION.panel.bodyStartRow + 1;
  var values = formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.checkboxColumn,
      rowCount,
      6
    )
    .getValues();
  var rows = [];

  for (var i = 0; i < values.length; i++) {
    var checked = values[i][0] === true;
    var selectionKey = normalizeCellString_(values[i][4]);
    if (!checked || !selectionKey) {
      continue;
    }

    rows.push({
      checked: checked,
      category: normalizeCellString_(values[i][1]),
      detail: normalizeCellString_(values[i][2]),
      amountMan: parseManAmount_(values[i][3]),
      selectionKey: selectionKey,
      rowKind: normalizeCellString_(values[i][5])
    });
  }

  return rows;
}

function getCurrentSelectionKeys_() {
  return getSelectedPanelRows_().map(function(row) {
    return row.selectionKey;
  });
}

function renderSelectionPanel_(panelRows) {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  clearOptionPanel_();
  formSheet.getRange(ENTRY_AUTOMATION.panel.headerRange).setValues([ENTRY_AUTOMATION.panel.headers]);

  if (!panelRows.length) {
    return;
  }

  var values = panelRows.map(function(row) {
    return [row.checked, row.category, row.detail, row.amountMan, row.selectionKey, row.rowKind];
  });

  formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.checkboxColumn,
      values.length,
      6
    )
    .setValues(values);
  formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.checkboxColumn,
      values.length,
      1
    )
    .insertCheckboxes();
}

function clearOptionPanel_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var rowCount = ENTRY_AUTOMATION.panel.bodyEndRow - ENTRY_AUTOMATION.panel.bodyStartRow + 1;
  formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.checkboxColumn,
      rowCount,
      6
    )
    .clearContent();
  formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.checkboxColumn,
      rowCount,
      1
    )
    .removeCheckboxes();
}

function ensureBalconySelectionChecked_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var rowCount = ENTRY_AUTOMATION.panel.bodyEndRow - ENTRY_AUTOMATION.panel.bodyStartRow + 1;
  var keys = formSheet
    .getRange(
      ENTRY_AUTOMATION.panel.bodyStartRow,
      ENTRY_AUTOMATION.panel.keyColumn,
      rowCount,
      2
    )
    .getValues();

  for (var i = 0; i < keys.length; i++) {
    if (normalizeCellString_(keys[i][1]) === ENTRY_AUTOMATION.panelKinds.balcony) {
      formSheet.getRange(ENTRY_AUTOMATION.panel.bodyStartRow + i, ENTRY_AUTOMATION.panel.checkboxColumn).setValue(true);
      return;
    }
  }
}

function buildSelectionField_(selectedRows) {
  return selectedRows
    .map(function(row) {
      return row.selectionKey;
    })
    .join('\n');
}

function parseSelectionField_(value) {
  return String(value || '')
    .split(/\n+/)
    .map(function(line) {
      return line.trim();
    })
    .filter(Boolean);
}

function buildBalconySelectionKey_(typeName) {
  return '발코니 확장|' + normalizeCellString_(typeName);
}

function buildOptionSelectionKey_(row) {
  var optionMerge = normalizeCellString_(row['Option-merge']);
  if (optionMerge) {
    return optionMerge;
  }

  return [
    normalizeCellString_(row['옵션구분']),
    normalizeCellString_(row['품목']),
    normalizeCellString_(row['품목세부']),
    normalizeCellString_(row['설치내역'])
  ]
    .filter(Boolean)
    .join(' | ');
}

function buildOptionDetail_(row) {
  return [
    normalizeCellString_(row['품목']),
    normalizeCellString_(row['품목세부']),
    normalizeCellString_(row['설치내역'])
  ]
    .filter(Boolean)
    .join(' | ');
}

function buildAdId_(complexInfo, formData) {
  var shortName =
    normalizeCellString_(complexInfo['단지명축약']) ||
    normalizeCellString_(complexInfo['단지ID']) ||
    normalizeCellString_(complexInfo['단지명']);
  return [shortName, normalizeCellString_(formData['동']), normalizeCellString_(formData['호']), normalizeCellString_(formData['타입'])]
    .filter(Boolean)
    .join('-');
}

function buildAddressFromComplexInfo_(complexInfo) {
  return [
    normalizeCellString_(complexInfo['시도']),
    normalizeCellString_(complexInfo['시군구']),
    normalizeCellString_(complexInfo['동읍면']),
    normalizeCellString_(complexInfo['통반리']),
    normalizeCellString_(complexInfo['지번'])
  ]
    .filter(Boolean)
    .join(' ');
}

function resolveEntryWriter_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (error) {
    email = '';
  }

  if (!email) {
    return '';
  }
  return email.split('@')[0];
}

function setEntryMeta_(meta) {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  var valueMap = meta || {};
  var current = readEntryMeta_();
  var next = {
    propertyId: Object.prototype.hasOwnProperty.call(valueMap, 'propertyId') ? valueMap.propertyId : current.propertyId,
    mode: Object.prototype.hasOwnProperty.call(valueMap, 'mode') ? valueMap.mode : current.mode,
    sourceRow: Object.prototype.hasOwnProperty.call(valueMap, 'sourceRow') ? valueMap.sourceRow : current.sourceRow,
    priceStatus: Object.prototype.hasOwnProperty.call(valueMap, 'priceStatus') ? valueMap.priceStatus : current.priceStatus,
    message: Object.prototype.hasOwnProperty.call(valueMap, 'message') ? valueMap.message : current.message
  };

  formSheet.getRange(ENTRY_AUTOMATION.metaCells.propertyId).setValue(next.propertyId || '');
  formSheet.getRange(ENTRY_AUTOMATION.metaCells.mode).setValue(next.mode || ENTRY_AUTOMATION.defaults.mode);
  formSheet.getRange(ENTRY_AUTOMATION.metaCells.sourceRow).setValue(next.sourceRow || '');
  formSheet.getRange(ENTRY_AUTOMATION.metaCells.priceStatus).setValue(next.priceStatus || '');
  formSheet.getRange(ENTRY_AUTOMATION.metaCells.message).setValue(next.message || '');
}

function clearEntryMeta_(setDefaultMode) {
  setEntryMeta_({
    propertyId: '',
    mode: setDefaultMode === false ? '' : ENTRY_AUTOMATION.defaults.mode,
    sourceRow: '',
    priceStatus: '',
    message: ''
  });
}

function clearLoadedPropertyMeta_() {
  setEntryMeta_({
    propertyId: '',
    mode: ENTRY_AUTOMATION.defaults.mode,
    sourceRow: '',
    message: ''
  });
}

function readEntryMeta_() {
  var formSheet = getRequiredSheet_(ENTRY_AUTOMATION.sheets.form);
  return {
    propertyId: normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.metaCells.propertyId).getValue()),
    mode: normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.metaCells.mode).getValue()) || ENTRY_AUTOMATION.defaults.mode,
    sourceRow: normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.metaCells.sourceRow).getValue()),
    priceStatus: normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.metaCells.priceStatus).getValue()),
    message: normalizeCellString_(formSheet.getRange(ENTRY_AUTOMATION.metaCells.message).getValue())
  };
}

function applyListValidation_(range, values) {
  if (!values.length) {
    range.clearDataValidations();
    return;
  }

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}

function getRequiredSheet_(sheetName) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('시트를 찾지 못했습니다: ' + sheetName);
  }
  return sheet;
}

function getSheetObjects_(sheetName) {
  var cacheKey = SpreadsheetApp.getActiveSpreadsheet().getId() + ':' + sheetName;
  if (ENTRY_CACHE[cacheKey]) {
    return ENTRY_CACHE[cacheKey];
  }

  var sheet = getRequiredSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (!values.length) {
    ENTRY_CACHE[cacheKey] = [];
    return ENTRY_CACHE[cacheKey];
  }

  var headers = values[0].map(function(header) {
    return normalizeCellString_(header);
  });
  var rows = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (isRowBlank_(values[rowIndex])) {
      continue;
    }
    rows.push(rowToObject_(headers, values[rowIndex], rowIndex + 1));
  }

  ENTRY_CACHE[cacheKey] = rows;
  return rows;
}

function clearSheetCache_() {
  var keys = Object.keys(ENTRY_CACHE);
  for (var i = 0; i < keys.length; i++) {
    delete ENTRY_CACHE[keys[i]];
  }
}

function getTrimmedHeaders_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function(header) {
      return normalizeCellString_(header);
    });
}

function rowToObject_(headers, row, rowNumber) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  if (rowNumber) {
    obj._rowNumber = rowNumber;
  }
  return obj;
}

function setRowValueByHeader_(row, headerIndex, headerName, value) {
  if (typeof headerIndex[headerName] === 'undefined') {
    return;
  }
  row[headerIndex[headerName]] = value;
}

function parseManAmount_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }

  var cleaned = String(value)
    .replace(/[,\s]/g, '')
    .replace(/만원|만원|만|원/g, '');
  var numeric = Number(cleaned);
  return isNaN(numeric) ? 0 : numeric;
}

function convertRawWonToMan_(value) {
  var numeric = normalizeNumberCell_(value);
  if (numeric === '') {
    return 0;
  }
  return Math.floor(numeric / 10000);
}

function normalizePhone_(value) {
  var digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length !== 11) {
    return normalizeCellString_(value);
  }
  return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
}

function normalizeBooleanField_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return '';
  }
  if (value === true || value === false) {
    return value;
  }

  var raw = normalizeCellString_(value).toUpperCase();
  if (raw === 'TRUE' || raw === 'Y' || raw === 'YES' || raw === '1') {
    return true;
  }
  if (raw === 'FALSE' || raw === 'N' || raw === 'NO' || raw === '0') {
    return false;
  }
  return normalizeCellString_(value);
}

function generateShortId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}
