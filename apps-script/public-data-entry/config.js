/**
 * 공공데이터 매물 자동입력 - 설정 및 상수.
 */

var PDE = Object.freeze({
  SHEETS: {
    CONFIG: '공통설정',
    QUERY_FORM: '공공데이터조회',
    BLD_RESULT: '_건축물대장_조회결과',
    SUPPLY_RESULT: '_분양정보_조회결과'
  },
  HEADERS: {
    CONFIG: ['KEY', 'VALUE', '설명']
  },
  CONFIG_KEYS: {
    DATA_GO_KR: 'DATA_GO_KR_SERVICE_KEY',
    VWORLD: 'VWORLD_API_KEY'
  },
  FORM_CELLS: {
    address: 'C4',
    sigunguCd: 'C5',
    bjdongCd: 'C6',
    bun: 'C7',
    ji: 'C8',
    houseName: 'C10',
    supplyStartDate: 'C11',
    supplyEndDate: 'C12',
    status: 'C15',
    titleCount: 'C16',
    recapCount: 'C17',
    exposCount: 'C18',
    supplyCount: 'C19',
    modelCount: 'C20'
  },
  FORM_LABELS: {
    startRow: 3,
    column: 2,
    labels: [
      '=== 검색 조건 ===',
      '주소(선택)',
      '시군구코드',
      '법정동코드',
      '번',
      '지',
      '',
      '주택명(분양정보)',
      '공고기간 시작',
      '공고기간 종료',
      '',
      '',
      '=== 조회 결과 ===',
      '조회상태',
      '총괄표제부 건수',
      '동별표제부 건수',
      '전유부 건수',
      '분양정보 건수',
      '주택형 건수'
    ]
  }
});

var PDE_PROPERTY_TYPES = Object.freeze({
  APARTMENT: 'apartment',
  HOUSE: 'house',
  BUILDING: 'building',
  FACTORY: 'factory',
  LAND: 'land'
});

/**
 * 현재 스프레드시트의 매물유형을 시트 이름으로 자동 판별.
 */
function pde_detectPropertyType_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ss.getSheets().map(function(s) { return s.getName(); });

  if (sheetNames.indexOf('아파트') >= 0 || sheetNames.indexOf('아파트단지') >= 0) {
    return PDE_PROPERTY_TYPES.APARTMENT;
  }
  if (sheetNames.indexOf('주택') >= 0) {
    return PDE_PROPERTY_TYPES.HOUSE;
  }
  if (sheetNames.indexOf('건물') >= 0 || sheetNames.indexOf('상가') >= 0) {
    return PDE_PROPERTY_TYPES.BUILDING;
  }
  if (sheetNames.indexOf('공장창고') >= 0) {
    return PDE_PROPERTY_TYPES.FACTORY;
  }
  if (sheetNames.indexOf('토지') >= 0) {
    return PDE_PROPERTY_TYPES.LAND;
  }
  return null;
}

/**
 * 공통설정 시트에서 설정값 읽기.
 */
function pde_getConfig_(key, required) {
  var sheet = pde_getOrCreateSheet_(PDE.SHEETS.CONFIG, PDE.HEADERS.CONFIG);
  var rows = pde_bodyRows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    var k = pde_trim_(rows[i][0]);
    if (k === key) {
      var value = pde_trim_(rows[i][1]);
      if (required && !value) {
        throw new Error('공통설정 시트의 ' + key + ' 값을 입력하세요.');
      }
      return value;
    }
  }
  if (required) throw new Error('공통설정 시트에 ' + key + ' 키가 없습니다.');
  return '';
}

/**
 * 공통설정 시트 초기 시드.
 */
function pde_seedConfig_(configSheet) {
  var required = [
    ['DATA_GO_KR_SERVICE_KEY', '', '공공데이터포털 Encoding 인증키'],
    ['VWORLD_API_KEY', '', '건축물대장 주소 입력 조회용(선택)']
  ];

  var lastRow = configSheet.getLastRow();
  var existing = lastRow > 1 ? configSheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  var existingKeys = {};
  existing.forEach(function(r) { existingKeys[pde_trim_(r[0])] = true; });

  var toAppend = required.filter(function(row) { return !existingKeys[row[0]]; });
  if (toAppend.length) {
    configSheet
      .getRange(configSheet.getLastRow() + 1, 1, toAppend.length, 3)
      .setValues(toAppend);
  }
}

/**
 * 현재 스프레드시트가 아파트 유형인지 확인.
 */
function pde_isApartment_() {
  return pde_detectPropertyType_() === PDE_PROPERTY_TYPES.APARTMENT;
}

/**
 * 현재 스프레드시트가 토지 유형인지 확인 (건축물대장 대상 외).
 */
function pde_isLand_() {
  return pde_detectPropertyType_() === PDE_PROPERTY_TYPES.LAND;
}
