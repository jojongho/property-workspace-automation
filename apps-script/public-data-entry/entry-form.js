/**
 * 공공데이터 매물 자동입력 - 입력폼 UI, 메뉴, 워크플로우.
 *
 * 각 스프레드시트에 '공공데이터조회' 시트 기반 입력폼을 제공.
 * 커스텀 메뉴를 통해 건축물대장/분양정보 조회 → 결과 확인 → 시트 반영.
 */

/**
 * 스프레드시트 열릴 때 커스텀 메뉴 생성.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('공공데이터');
  menu.addItem('초기 설정 (시트 생성)', 'pdeSetup');
  menu.addSeparator();
  menu.addItem('건축물대장 조회', 'pdeRunBuildingLedger');

  if (pde_isApartment_()) {
    menu.addItem('분양정보 조회', 'pdeRunHousingSupply');
  }

  menu.addSeparator();
  menu.addItem('건축물대장 → 시트 반영', 'pdeApplyBuildingResult');

  if (pde_isApartment_()) {
    menu.addItem('분양정보 → 시트 반영', 'pdeApplySupplyResult');
  }

  menu.addSeparator();
  menu.addItem('입력폼 초기화', 'pdeResetForm');
  menu.addItem('API 셀프테스트', 'pdeApiSelfTest');

  menu.addToUi();
}

/**
 * 초기 설정: 공통설정 시트 + 공공데이터조회 입력폼 시트 생성.
 */
function pdeSetup() {
  var propertyType = pde_detectPropertyType_();
  if (!propertyType) {
    SpreadsheetApp.getUi().alert('이 스프레드시트의 매물유형을 판별할 수 없습니다.');
    return;
  }
  if (propertyType === PDE_PROPERTY_TYPES.LAND) {
    SpreadsheetApp.getUi().alert('토지 스프레드시트는 공공데이터 조회 대상이 아닙니다.');
    return;
  }

  // 공통설정 시트
  var configSheet = pde_getOrCreateSheet_(PDE.SHEETS.CONFIG, PDE.HEADERS.CONFIG);
  pde_seedConfig_(configSheet);

  // 공공데이터조회 입력폼 시트
  pde_createQueryFormSheet_();

  SpreadsheetApp.getUi().alert(
    '초기 설정 완료.\n' +
    '1) 공통설정 시트에 API 키를 입력하세요.\n' +
    '2) 공공데이터조회 시트에서 검색 조건을 입력하세요.\n' +
    '감지된 매물유형: ' + propertyType
  );
}

/**
 * 공공데이터조회 시트 생성 및 레이아웃 초기화.
 */
function pde_createQueryFormSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(PDE.SHEETS.QUERY_FORM);
  if (!formSheet) {
    formSheet = ss.insertSheet(PDE.SHEETS.QUERY_FORM);
  }

  // 라벨 쓰기
  var labels = PDE.FORM_LABELS.labels;
  var labelValues = labels.map(function(label) { return [label]; });
  formSheet.getRange(
    PDE.FORM_LABELS.startRow,
    PDE.FORM_LABELS.column,
    labelValues.length,
    1
  ).setValues(labelValues);

  // 제목
  formSheet.getRange('B1').setValue('공공데이터 조회');
  formSheet.getRange('B1').setFontSize(14).setFontWeight('bold');

  // 컬럼 너비
  formSheet.setColumnWidth(1, 30);   // A열 (여백)
  formSheet.setColumnWidth(2, 180);  // B열 (라벨)
  formSheet.setColumnWidth(3, 280);  // C열 (입력값)

  // 비아파트면 분양정보 관련 행 숨기기
  if (!pde_isApartment_()) {
    // 10~12행: 분양정보 관련 (주택명, 공고기간)
    formSheet.getRange('B10').setValue('(분양정보: 아파트 전용)');
    formSheet.getRange('C10:C12').setBackground('#f0f0f0');
  }

  // 결과 영역 서식
  var resultRange = formSheet.getRange('C15:C20');
  resultRange.setBackground('#f5f5f5');

  formSheet.setActiveSelection('C4');
}

/**
 * 입력폼에서 검색 조건 읽기.
 */
function pde_readFormValues_() {
  var formSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PDE.SHEETS.QUERY_FORM);
  if (!formSheet) {
    throw new Error('공공데이터조회 시트가 없습니다. 초기 설정을 먼저 실행하세요.');
  }

  return {
    address: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.address).getValue()),
    sigunguCd: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.sigunguCd).getValue()),
    bjdongCd: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.bjdongCd).getValue()),
    bun: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.bun).getValue()),
    ji: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.ji).getValue()),
    houseName: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.houseName).getValue()),
    supplyStartDate: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.supplyStartDate).getValue()),
    supplyEndDate: pde_trim_(formSheet.getRange(PDE.FORM_CELLS.supplyEndDate).getValue())
  };
}

/**
 * 입력폼에 결과 상태 쓰기.
 */
function pde_writeFormStatus_(status, counts) {
  var formSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PDE.SHEETS.QUERY_FORM);
  if (!formSheet) return;

  formSheet.getRange(PDE.FORM_CELLS.status).setValue(status);
  if (counts) {
    if (counts.titleCount !== undefined) formSheet.getRange(PDE.FORM_CELLS.titleCount).setValue(counts.titleCount);
    if (counts.recapCount !== undefined) formSheet.getRange(PDE.FORM_CELLS.recapCount).setValue(counts.recapCount);
    if (counts.exposCount !== undefined) formSheet.getRange(PDE.FORM_CELLS.exposCount).setValue(counts.exposCount);
    if (counts.detailCount !== undefined) formSheet.getRange(PDE.FORM_CELLS.supplyCount).setValue(counts.detailCount);
    if (counts.modelCount !== undefined) formSheet.getRange(PDE.FORM_CELLS.modelCount).setValue(counts.modelCount);
  }
}

/**
 * 주소로 지번코드를 조회하여 입력폼에 채우기.
 */
function pde_fillAddressCodes_(formValues) {
  if (!formValues.address) return formValues;
  if (formValues.sigunguCd && formValues.bjdongCd && formValues.bun) {
    return formValues; // 이미 코드가 있으면 스킵
  }

  var geo = pde_resolveAddress_(formValues.address);
  var formSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PDE.SHEETS.QUERY_FORM);

  if (!formValues.sigunguCd) {
    formValues.sigunguCd = geo.sigunguCd;
    formSheet.getRange(PDE.FORM_CELLS.sigunguCd).setValue(geo.sigunguCd);
  }
  if (!formValues.bjdongCd) {
    formValues.bjdongCd = geo.bjdongCd;
    formSheet.getRange(PDE.FORM_CELLS.bjdongCd).setValue(geo.bjdongCd);
  }
  if (!formValues.bun) {
    formValues.bun = geo.bun;
    formSheet.getRange(PDE.FORM_CELLS.bun).setValue(geo.bun);
  }
  if (!formValues.ji) {
    formValues.ji = geo.ji;
    formSheet.getRange(PDE.FORM_CELLS.ji).setValue(geo.ji);
  }

  return formValues;
}

/**
 * 건축물대장 조회 실행.
 */
function pdeRunBuildingLedger() {
  try {
    if (pde_isLand_()) {
      SpreadsheetApp.getUi().alert('토지는 건축물대장 조회 대상이 아닙니다.');
      return;
    }

    var formValues = pde_readFormValues_();
    formValues = pde_fillAddressCodes_(formValues);

    var sigunguCd = pde_digits_(formValues.sigunguCd);
    var bjdongCd = pde_digits_(formValues.bjdongCd);
    var bun = pde_pad4_(pde_digits_(formValues.bun));
    var ji = pde_pad4_(pde_digits_(formValues.ji)) || '0000';

    if (!sigunguCd || !bjdongCd || !bun) {
      SpreadsheetApp.getUi().alert('주소 또는 시군구코드/법정동코드/번을 입력하세요.');
      return;
    }

    pde_writeFormStatus_('조회 중...', {});

    var result = pde_fetchBuildingLedger_({
      sigunguCd: sigunguCd,
      bjdongCd: bjdongCd,
      platGbCd: '0',
      bun: bun,
      ji: ji
    });

    var counts = pde_saveBuildingResultToSheet_(result);
    pde_writeFormStatus_('완료', counts);

    SpreadsheetApp.getUi().alert(
      '건축물대장 조회 완료\n' +
      '총괄표제부: ' + counts.titleCount + '건\n' +
      '동별표제부: ' + counts.recapCount + '건\n' +
      '전유부: ' + counts.exposCount + '건\n\n' +
      '"건축물대장 → 시트 반영" 메뉴로 매물 시트에 반영할 수 있습니다.'
    );
  } catch (err) {
    pde_writeFormStatus_('실패: ' + err.message, {});
    SpreadsheetApp.getUi().alert('건축물대장 조회 실패: ' + err.message);
  }
}

/**
 * 분양정보 조회 실행 (아파트 전용).
 */
function pdeRunHousingSupply() {
  try {
    if (!pde_isApartment_()) {
      SpreadsheetApp.getUi().alert('분양정보 조회는 아파트 스프레드시트에서만 사용 가능합니다.');
      return;
    }

    var formValues = pde_readFormValues_();
    if (!formValues.houseName && !formValues.supplyStartDate) {
      SpreadsheetApp.getUi().alert('주택명 또는 공고기간을 입력하세요.');
      return;
    }

    pde_writeFormStatus_('분양정보 조회 중...', {});

    var result = pde_fetchHousingSupply_(formValues);
    var counts = pde_saveSupplyResultToSheet_(result);
    pde_writeFormStatus_('완료', counts);

    SpreadsheetApp.getUi().alert(
      '분양정보 조회 완료\n' +
      '분양상세: ' + counts.detailCount + '건\n' +
      '주택형: ' + counts.modelCount + '건\n\n' +
      '"분양정보 → 시트 반영" 메뉴로 아파트단지/단지일정/타입 시트에 반영할 수 있습니다.'
    );
  } catch (err) {
    pde_writeFormStatus_('실패: ' + err.message, {});
    SpreadsheetApp.getUi().alert('분양정보 조회 실패: ' + err.message);
  }
}

/**
 * 건축물대장 조회결과 → 매물 시트 반영.
 */
function pdeApplyBuildingResult() {
  try {
    var result = pde_applyBuildingResult_();
    SpreadsheetApp.getUi().alert('건축물대장 반영 결과:\n' + result.message);
  } catch (err) {
    SpreadsheetApp.getUi().alert('건축물대장 반영 실패: ' + err.message);
  }
}

/**
 * 분양정보 조회결과 → 아파트단지/단지일정/타입 시트 반영.
 */
function pdeApplySupplyResult() {
  try {
    var result = pde_applySupplyResult_();
    SpreadsheetApp.getUi().alert('분양정보 반영 결과:\n' + result.message);
  } catch (err) {
    SpreadsheetApp.getUi().alert('분양정보 반영 실패: ' + err.message);
  }
}

/**
 * 입력폼 초기화.
 */
function pdeResetForm() {
  var formSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PDE.SHEETS.QUERY_FORM);
  if (!formSheet) {
    SpreadsheetApp.getUi().alert('공공데이터조회 시트가 없습니다.');
    return;
  }

  // 입력값 초기화
  var inputCells = ['address', 'sigunguCd', 'bjdongCd', 'bun', 'ji',
                    'houseName', 'supplyStartDate', 'supplyEndDate'];
  inputCells.forEach(function(key) {
    formSheet.getRange(PDE.FORM_CELLS[key]).clearContent();
  });

  // 결과값 초기화
  var resultCells = ['status', 'titleCount', 'recapCount', 'exposCount',
                     'supplyCount', 'modelCount'];
  resultCells.forEach(function(key) {
    formSheet.getRange(PDE.FORM_CELLS[key]).clearContent();
  });

  formSheet.setActiveSelection(PDE.FORM_CELLS.address);
  SpreadsheetApp.getUi().alert('입력폼을 초기화했습니다.');
}

/**
 * API 셀프테스트.
 */
function pdeApiSelfTest() {
  var messages = [];
  var now = new Date();

  try {
    var dataGoKey = pde_getConfig_(PDE.CONFIG_KEYS.DATA_GO_KR, true);
    messages.push('DATA_GO_KR_SERVICE_KEY: 설정됨');

    // 건축물대장 테스트 (강남구 역삼동)
    try {
      var bldItems = pde_fetchBuildingApi_(
        dataGoKey,
        PDE_BLD_ENDPOINTS.TITLE,
        { sigunguCd: '11680', bjdongCd: '10300', platGbCd: '0', bun: '0012', ji: '0000' },
        1
      );
      messages.push('건축물대장 API: 정상 (' + bldItems.length + '건)');
    } catch (bldErr) {
      messages.push('건축물대장 API: 실패 - ' + bldErr.message);
    }

    // 분양정보 테스트
    if (pde_isApartment_()) {
      try {
        var supplyResp = pde_fetchApplyhomePaged_(
          dataGoKey, 'getAPTLttotPblancDetail', {}, 5, 1
        );
        messages.push('분양정보 API: 정상 (' + (supplyResp.data || []).length + '건)');
      } catch (supplyErr) {
        messages.push('분양정보 API: 실패 - ' + supplyErr.message);
      }
    }

    // vworld 테스트
    try {
      var vworldKey = pde_getConfig_(PDE.CONFIG_KEYS.VWORLD, false);
      if (vworldKey) {
        pde_geocodeParcelByAddress_('서울특별시 강남구 역삼동 12', vworldKey);
        messages.push('VWORLD API: 정상');
      } else {
        messages.push('VWORLD API: 키 미설정 (주소 입력 조회 불가)');
      }
    } catch (vErr) {
      messages.push('VWORLD API: 실패 - ' + vErr.message);
    }
  } catch (err) {
    messages.push('설정 오류: ' + err.message);
  }

  messages.push('');
  messages.push('테스트 시각: ' + now.toLocaleString('ko-KR'));
  messages.push('매물유형: ' + (pde_detectPropertyType_() || '판별불가'));

  SpreadsheetApp.getUi().alert('API 셀프테스트 결과\n\n' + messages.join('\n'));
}
