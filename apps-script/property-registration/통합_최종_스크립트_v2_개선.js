/**
 * =====================================================================================
 * 부동산 매물관리 자동화 시스템 - 통합 스크립트 v2.1 (하이브리드 ID 생성)
 * =====================================================================================
 *
 * 🔄 하이브리드 ID 생성 방식 적용:
 * - 수식으로 ID 미리 표시 (C28 매물ID, C36 고객ID)
 * - 등록 시 수식 결과를 DB에 영구 저장
 * - 과거 데이터 불변성 보장
 *
 * ✨ Phase 1 개선사항:
 * - 필수 필드 검증 강화
 * - 중복 등록 방지
 * - 접수일/접수자 자동 입력
 * - 데이터 타입 표준화
 *
 * 기능:
 * - 맞춤 메뉴
 * - 폴더 자동 생성/링크
 * - 자동 데이터 불러오기 (onEdit 트리거)
 * - 신규/수정 자동 처리
 * - 외부 통합단지DB 연동 (1XY35_z3bIIzSmD6LMK_ygM6l_ZG7_KAuXxuo0YD-c_0)
 * - 옵션 데이터 불러오기
 */

// '아파트' 폴더의 고유 ID를 상수로 지정합니다.
const ROOT_FOLDER_ID = '1Y0x3HGO1_xB35RJfA6NRE_DL5TOczUpi';

/**
 * 스프레드시트를 열 때마다 상단에 맞춤 메뉴를 생성합니다.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📁 매물 관리')
    .addItem('관련파일 폴더 생성 및 링크', 'createAndLinkFolder')
    .addItem('옵션 데이터 가져오기', 'processOptionDataFromExternalSheet')
    .addItem('입력폼 초기화', 'clearInputForm')
    .addSeparator()
    .addItem('⚙️ 시스템 정보', 'showSystemInfo')
    .addToUi();
}

/**
 * =====================================================================================
 * 1. 자동 데이터 불러오기 (onEdit 트리거)
 * =====================================================================================
 */

/**
 * C4(단지명), C5(동), C6(호) 셀이 변경될 때 자동으로 기존 데이터를 불러옵니다.
 *
 * ★ 설치 방법:
 * 1. Apps Script 에디터 왼쪽 "트리거" (⏰) 클릭
 * 2. "+ 트리거 추가" 클릭
 * 3. 설정:
 *    - 실행할 함수: onEdit
 *    - 이벤트 소스: 스프레드시트에서
 *    - 이벤트 유형: 수정 시
 */
function onEdit(e) {
  var sheet = e.source.getActiveSheet();

  // 등록검색 시트에서만 작동
  if (sheet.getName() !== '등록검색') return;

  var range = e.range;
  var editedCell = range.getA1Notation();

  // C4(단지명), C5(동), C6(호) 셀이 변경되었을 때
  if (editedCell === 'C4' || editedCell === 'C5' || editedCell === 'C6') {
    // 짧은 지연 후 실행 (C3 수식 계산 대기)
    Utilities.sleep(500);
    autoLoadExistingData();
  }
}

/**
 * C3 셀 값을 확인하고, "수정모드"일 경우 자동으로 기존 데이터를 불러옵니다.
 */
function autoLoadExistingData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('등록검색');

  // C3 셀 값 확인
  const status = sheet.getRange('C3').getValue();

  // "수정"이 포함되지 않으면 종료 (신규등록 모드)
  if (!status || status.toString().indexOf('수정') === -1) {
    return;
  }

  // 단지명, 동, 호 확인
  const apartmentName = sheet.getRange('C4').getValue();
  const dong = sheet.getRange('C5').getValue();
  const ho = sheet.getRange('C6').getValue();

  if (!apartmentName || !dong || !ho) return;

  // 기존 loadPropertyData() 함수 로직 실행
  const propertyDb = ss.getSheetByName('매물DB');
  const dbData = propertyDb.getDataRange().getValues();
  const headers = dbData[0].map(h => h.toString().trim());
  let targetRow = null;

  for (let i = 1; i < dbData.length; i++) {
    if (dbData[i][headers.indexOf('단지명')] == apartmentName &&
        dbData[i][headers.indexOf('동')] == dong &&
        dbData[i][headers.indexOf('호')] == ho) {
      targetRow = dbData[i];
      break;
    }
  }

  if (targetRow) {
    const labelsRange = sheet.getRange('B4:B50').getValues();
    for (let i = 0; i < labelsRange.length; i++) {
      const label = labelsRange[i][0].toString().trim();

      // 관련파일링크는 건너뛰기 (나중에 자동 재생성)
      if (label === '관련파일링크') continue;

      if (label) {
        const colIndex = headers.indexOf(label);
        if (colIndex !== -1) {
          sheet.getRange(i + 4, 3).setValue(targetRow[colIndex]);
        }
      }
    }

    // 폴더 링크 자동 재생성 (칩 문제 해결)
    if (apartmentName && dong && ho) {
      try {
        const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
        const apartmentFolder = getOrCreateFolder(rootFolder, apartmentName);
        const listingsFolder = getOrCreateFolder(apartmentFolder, '매물');
        const finalFolderName = `${dong}-${ho}`;
        const finalFolder = getOrCreateFolder(listingsFolder, finalFolderName);
        const folderUrl = finalFolder.getUrl();

        sheet.getRange('C24').setValue(folderUrl);
        Logger.log('✅ 폴더 링크 자동 재생성: ' + folderUrl);

      } catch (e) {
        // 실패 시 DB 값 사용 시도
        const 관련파일링크컬럼 = headers.indexOf('관련파일링크');
        if (관련파일링크컬럼 !== -1 && targetRow[관련파일링크컬럼]) {
          sheet.getRange('C24').setValue(targetRow[관련파일링크컬럼]);
          Logger.log('⚠️ 폴더 링크 자동 생성 실패, DB 값 사용: ' + e.toString());
        } else {
          Logger.log('❌ 폴더 링크 생성 실패: ' + e.toString());
        }
      }
    }

    Logger.log('✅ 기존 매물 데이터 자동 불러오기 완료: ' + apartmentName + ' ' + dong + '동 ' + ho + '호');
  }
}


/**
 * =====================================================================================
 * 2. 폴더 자동 생성 및 링크
 * =====================================================================================
 */

/**
 * '등록검색' 시트의 정보를 바탕으로 구글 드라이브에 폴더를 생성하고,
 * 해당 폴더의 링크를 C24셀에 입력한 뒤 새 탭으로 열어줍니다.
 */
function createAndLinkFolder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('등록검색');

  const apartmentName = sheet.getRange('C4').getValue();
  const dong = sheet.getRange('C5').getValue();
  const ho = sheet.getRange('C6').getValue();

  if (!apartmentName || !dong || !ho) {
    Browser.msgBox('입력 오류', '폴더를 생성하려면 단지명, 동, 호를 먼저 입력해야 합니다.', Browser.Buttons.OK);
    return;
  }

  try {
    const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const apartmentFolder = getOrCreateFolder(rootFolder, apartmentName);
    const listingsFolder = getOrCreateFolder(apartmentFolder, '매물');
    const finalFolderName = `${dong}-${ho}`;
    const finalFolder = getOrCreateFolder(listingsFolder, finalFolderName);
    const folderUrl = finalFolder.getUrl();
    sheet.getRange('C24').setValue(folderUrl);
    openUrlInNewTab(folderUrl, '파일 업로드 폴더 여는 중...');

  } catch (e) {
    Browser.msgBox('스크립트 오류', `폴더 생성 중 오류가 발생했습니다: ${e.toString()}`, Browser.Buttons.OK);
  }
}


/**
 * =====================================================================================
 * 3. 기존 데이터 수동 불러오기 (버튼용)
 * =====================================================================================
 */

/**
 * '매물DB'에서 기존 매물 정보를 찾아 '등록검색' 시트로 불러옵니다.
 * (메뉴나 버튼에서 수동으로 호출 가능)
 */
function loadPropertyData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('등록검색');
  const propertyDb = ss.getSheetByName('매물DB');

  const status = sheet.getRange('C3').getValue();
  if (status.indexOf('신규') !== -1) {
    Browser.msgBox('알림', '신규 매물입니다. 불러올 데이터가 없습니다.', Browser.Buttons.OK);
    return;
  }

  const apartmentName = sheet.getRange('C4').getValue();
  const dong = sheet.getRange('C5').getValue();
  const ho = sheet.getRange('C6').getValue();

  if (!apartmentName || !dong || !ho) {
    Browser.msgBox('입력 오류', '단지명, 동, 호를 먼저 입력해주세요.', Browser.Buttons.OK);
    return;
  }

  const dbData = propertyDb.getDataRange().getValues();
  const headers = dbData[0].map(h => h.toString().trim());
  let targetRow = null;

  for (let i = 1; i < dbData.length; i++) {
    if (dbData[i][headers.indexOf('단지명')] == apartmentName &&
        dbData[i][headers.indexOf('동')] == dong &&
        dbData[i][headers.indexOf('호')] == ho) {
      targetRow = dbData[i];
      break;
    }
  }

  if (targetRow) {
    const labelsRange = sheet.getRange('B4:B50').getValues();
    for (let i = 0; i < labelsRange.length; i++) {
      const label = labelsRange[i][0].toString().trim();
      if (label) {
        const colIndex = headers.indexOf(label);
        if (colIndex !== -1) {
          sheet.getRange(i + 4, 3).setValue(targetRow[colIndex]);
        }
      }
    }
    Browser.msgBox('성공', '기존 매물 정보를 성공적으로 불러왔습니다.', Browser.Buttons.OK);
  } else {
    Browser.msgBox('오류', '데이터베이스에서 일치하는 매물을 찾지 못했습니다.', Browser.Buttons.OK);
  }
}


/**
 * =====================================================================================
 * 4. 매물 + 고객 정보 등록/수정 (통합) - ✨ Phase 1 개선 적용
 * =====================================================================================
 */

/**
 * ★★★ [Phase 1 개선 완료 - 하이브리드 방식] ★★★
 * '등록검색' 시트의 데이터를 '신규 등록' 하거나 기존 데이터를 '수정(덮어쓰기)' 합니다.
 *
 * ✨ 하이브리드 방식:
 * - C28(매물ID), C36(고객ID)의 수식 결과를 읽어서 DB에 저장
 * - 사용자는 등록 전 ID 미리 확인 가능
 * - 등록 시점의 ID를 DB에 영구 저장 (과거 데이터 불변성 보장)
 *
 * ✨ 개선 기능:
 * - 필수 필드 검증 (단지명, 동, 호, 타입, 거래유형, 거래상태)
 * - 접수일/접수자 자동 입력
 * - 중복 등록 방지
 * - 데이터 타입 표준화
 *
 * ★ 이미지 버튼에 할당:
 * 1. 등록 버튼 이미지 클릭
 * 2. 오른쪽 상단 ⋮ (더보기) 클릭
 * 3. "스크립트 할당" 선택
 * 4. 함수명 입력: registerPropertyAndClient
 */
function registerPropertyAndClient() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regSheet = ss.getSheetByName('등록검색');
  const propertyDb = ss.getSheetByName('매물DB');
  const customerDb = ss.getSheetByName('고객DB');

  // C3 셀의 상태(신규/수정)를 확인합니다.
  const status = regSheet.getRange('C3').getValue();

  // 1. '등록검색' 시트에서 입력된 데이터를 객체(Object) 형태로 변환합니다.
  const rangeData = regSheet.getRange('B4:C50').getValues();
  let dataMap = {};
  for (let i = 0; i < rangeData.length; i++) {
    if (rangeData[i][0] !== '') {
      let key = rangeData[i][0].toString().trim();
      dataMap[key] = rangeData[i][1];
    }
  }

  // ============================================
  // ✨ Phase 1 개선: 필수 필드 검증 강화
  // ============================================
  const requiredFields = ['단지명', '동', '호', '타입', '거래유형', '거래상태'];
  const missingFields = [];

  for (let field of requiredFields) {
    if (!dataMap[field] || dataMap[field] === '') {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    Browser.msgBox(
      '필수 항목 누락',
      `다음 필수 항목을 입력해주세요:\n\n${missingFields.join(', ')}`,
      Browser.Buttons.OK
    );
    return;
  }

  // ============================================
  // ✨ Phase 1 개선: 접수일/접수자 자동 입력
  // ============================================
  if (!dataMap['접수일']) {
    dataMap['접수일'] = new Date();
  }

  if (!dataMap['접수자']) {
    const userEmail = Session.getActiveUser().getEmail();
    dataMap['접수자'] = userEmail.split('@')[0]; // 이메일에서 사용자명만 추출
  }

  // ============================================
  // 🔄 하이브리드 방식: 수식 결과에서 ID 읽기
  // ============================================

  // C28(매물ID) 수식 결과 읽기
  const propertyId = regSheet.getRange('C28').getValue();
  if (!propertyId || propertyId.toString().includes('자동 생성 수정 X')) {
    Browser.msgBox(
      'ID 생성 오류',
      '매물ID가 제대로 생성되지 않았습니다.\n단지명, 동, 호, 타입을 확인해주세요.',
      Browser.Buttons.OK
    );
    return;
  }
  dataMap['매물ID'] = propertyId;

  // C36(고객ID) 수식 결과 읽기
  const customerId = regSheet.getRange('C36').getValue();
  if (!customerId || customerId.toString().includes('자동 생성 수정 X')) {
    Browser.msgBox(
      'ID 생성 오류',
      '고객ID가 제대로 생성되지 않았습니다.\n단지명, 동, 호를 확인해주세요.',
      Browser.Buttons.OK
    );
    return;
  }
  dataMap['고객ID'] = customerId;

  // ============================================
  // ✨ Phase 1 개선: 데이터 타입 표준화
  // ============================================

  // 타입 필드: 문자열로 강제 변환
  if (dataMap['타입']) {
    dataMap['타입'] = dataMap['타입'].toString();
  }

  // 연락처 필드: 하이픈 포함 문자열로 변환
  if (dataMap['연락처'] && !isNaN(dataMap['연락처'])) {
    const phone = dataMap['연락처'].toString();
    if (phone.length === 11) {
      dataMap['연락처'] = `${phone.substr(0,3)}-${phone.substr(3,4)}-${phone.substr(7,4)}`;
    }
  }

  // 2. 각 DB 시트의 헤더를 가져옵니다.
  const propertyHeaders = propertyDb.getRange(1, 1, 1, propertyDb.getLastColumn()).getValues()[0].map(h => h.toString().trim());
  const customerHeaders = customerDb.getRange(1, 1, 1, customerDb.getLastColumn()).getValues()[0].map(h => h.toString().trim());

  // 3. 헤더 순서에 맞게 새로운 행 데이터를 만듭니다.
  let newPropertyRow = propertyHeaders.map(header => dataMap[header] !== undefined ? dataMap[header] : null);
  let newCustomerRow = customerHeaders.map(header => dataMap[header] !== undefined ? dataMap[header] : null);

  // 4. C3 상태에 따라 '신규 등록' 또는 '수정'을 실행합니다.
  if (status.indexOf('신규') !== -1) {

    // ============================================
    // ✨ Phase 1 개선: 중복 등록 방지
    // ============================================
    const dbData = propertyDb.getDataRange().getValues();
    for (let i = 1; i < dbData.length; i++) {
      if (dbData[i][propertyHeaders.indexOf('단지명')] == dataMap['단지명'] &&
          dbData[i][propertyHeaders.indexOf('동')] == dataMap['동'] &&
          dbData[i][propertyHeaders.indexOf('호')] == dataMap['호'] &&
          dbData[i][propertyHeaders.indexOf('타입')] == dataMap['타입']) {

        const response = Browser.msgBox(
          '중복 매물 경고',
          `이미 등록된 매물입니다:\n\n${dataMap['단지명']} ${dataMap['동']}동 ${dataMap['호']}호 ${dataMap['타입']}\n\n수정 모드로 전환하시겠습니까?`,
          Browser.Buttons.YES_NO
        );

        if (response === 'yes') {
          // 기존 데이터 불러오기
          autoLoadExistingData();
        }
        return;
      }
    }

    // [신규 등록] DB 시트 마지막에 새로운 행을 추가합니다.
    propertyDb.appendRow(newPropertyRow);
    customerDb.appendRow(newCustomerRow);
    SpreadsheetApp.flush();

    Logger.log(`✅ 신규 매물 등록 완료: ${propertyId}`);
    Browser.msgBox('성공', `✨ 신규 매물 및 고객 정보가 성공적으로 등록되었습니다.\n\n매물ID: ${propertyId}\n고객ID: ${customerId}`, Browser.Buttons.OK);

    // 저장 후 입력폼 초기화 여부 확인
    const response = Browser.msgBox('입력폼 초기화', '입력폼을 초기화하시겠습니까?', Browser.Buttons.YES_NO);
    if (response === 'yes') {
      clearInputForm();
    }

  } else {
    // [수정] 기존 데이터를 찾아 덮어씁니다.
    const dbData = propertyDb.getDataRange().getValues();
    let updated = false;
    for (let i = 1; i < dbData.length; i++) {
      if (dbData[i][propertyHeaders.indexOf('단지명')] == dataMap['단지명'] &&
          dbData[i][propertyHeaders.indexOf('동')] == dataMap['동'] &&
          dbData[i][propertyHeaders.indexOf('호')] == dataMap['호']) {
        propertyDb.getRange(i + 1, 1, 1, newPropertyRow.length).setValues([newPropertyRow]);

        // 고객DB도 동일한 방식으로 업데이트 (고객ID 기준 또는 매물 기준)
        const customerDbData = customerDb.getDataRange().getValues();
        for (let j = 1; j < customerDbData.length; j++) {
          // 고객ID나 다른 기준으로 매칭 (여기서는 매물과 동일하게 처리)
          if (customerDbData[j][customerHeaders.indexOf('단지명')] == dataMap['단지명'] &&
              customerDbData[j][customerHeaders.indexOf('동')] == dataMap['동'] &&
              customerDbData[j][customerHeaders.indexOf('호')] == dataMap['호']) {
            customerDb.getRange(j + 1, 1, 1, newCustomerRow.length).setValues([newCustomerRow]);
            break;
          }
        }

        updated = true;
        break;
      }
    }

    if (updated) {
      Logger.log(`✅ 매물 수정 완료: ${propertyId}`);
      Browser.msgBox('성공', `✅ 매물 및 고객 정보가 성공적으로 수정되었습니다.\n\n매물ID: ${propertyId}`, Browser.Buttons.OK);

      // 저장 후 입력폼 초기화 여부 확인
      const response = Browser.msgBox('입력폼 초기화', '입력폼을 초기화하시겠습니까?', Browser.Buttons.YES_NO);
      if (response === 'yes') {
        clearInputForm();
      }
    } else {
      Browser.msgBox('오류', '수정할 원본 데이터를 찾지 못했습니다. 신규 등록으로 진행해주세요.', Browser.Buttons.OK);
      return;
    }
  }
}


/**
 * =====================================================================================
 * 5. 옵션 데이터 불러오기 (외부 통합단지DB 연동)
 * =====================================================================================
 */

/**
 * 외부 스프레드시트(통합단지DB)에서 옵션 데이터를 불러와
 * E5:H 영역에 체크박스와 함께 표시합니다.
 */
function processOptionDataFromExternalSheet() {
  Logger.log('옵션 데이터 처리 시작');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 등록검색시트 = ss.getSheetByName('등록검색');

  if (!등록검색시트) {
    Logger.log('등록검색 시트를 찾을 수 없습니다.');
    return;
  }

  // B1 셀에서 외부 스프레드시트 ID 가져오기
  var externalSheetId = 등록검색시트.getRange('B1').getValue();
  Logger.log('외부 스프레드시트 ID: ' + externalSheetId);

  if (!externalSheetId) {
    Logger.log('경고: 외부 스프레드시트 ID가 없습니다.');
    SpreadsheetApp.getUi().alert('B1 셀에 외부 스프레드시트 ID를 입력해주세요.');
    return;
  }

  // C4 셀의 단지명 가져오기
  var apartmentName = 등록검색시트.getRange('C4').getValue();
  Logger.log('선택된 단지명: ' + apartmentName);

  // C7 셀의 타입 값 가져오기
  var typeValue = 등록검색시트.getRange('C7').getValue();
  Logger.log('선택된 타입 값: ' + typeValue);

  if (!typeValue) {
    Logger.log('타입 값이 없어 데이터를 초기화합니다.');
    등록검색시트.getRange('E5:H1000').clearContent();
    return;
  }

  try {
    Logger.log('외부 스프레드시트 열기 시도...');
    var externalSS = SpreadsheetApp.openById(externalSheetId);
    var 옵션시트 = externalSS.getSheetByName('옵션');

    if (!옵션시트) {
      Logger.log('경고: 외부 스프레드시트에서 옵션 시트를 찾을 수 없습니다.');
      SpreadsheetApp.getUi().alert('외부 스프레드시트에서 "옵션" 시트를 찾을 수 없습니다.');
      return;
    }

    // 헤더 설정 및 스타일링
    var headerRange = 등록검색시트.getRange('E4:H4');

    // 헤더 텍스트 설정
    등록검색시트.getRange('E4').setValue('선택');
    등록검색시트.getRange('F4').setValue('옵션구분');
    등록검색시트.getRange('G4').setValue('내역');
    등록검색시트.getRange('H4').setValue('금액(만)');

    // 헤더 스타일 적용
    headerRange.setBackground('#4A90E2')
               .setFontColor('#FFFFFF')
               .setFontWeight('bold')
               .setHorizontalAlignment('center')
               .setVerticalAlignment('middle')
               .setBorder(true, true, true, true, true, true, '#FFFFFF', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    // 행 높이 설정
    등록검색시트.setRowHeight(4, 35);

    // 기존 데이터 초기화
    등록검색시트.getRange('E5:H1000').clearContent();
    등록검색시트.getRange('E5:E1000').removeCheckboxes();
    등록검색시트.getRange('F5:F1000').breakApart();

    // 외부 옵션시트에서 데이터 가져오기 (통합DB 구조)
    var lastRow = 옵션시트.getLastRow();
    var optionsData = 옵션시트.getRange('A2:H' + lastRow).getValues();

    // 통합DB: A열=단지명, B열=옵션구분, C열=타입으로 필터링
    // 타입 매칭: "전체"이거나 타입 문자열에 현재 타입 포함 (예: "84A,84B"에 "84A" 포함)
    // 발코니확장 제외: C11에서 별도 수식으로 처리
    var filteredData = optionsData.filter(row => {
      var rowApartment = row[0];   // A열: 단지명
      var rowCategory = row[1];    // B열: 옵션구분
      var rowType = row[2];         // C열: 타입 (예: "84A,84B" 또는 "전체" 또는 "84A")

      // 단지명 매칭 체크
      if (rowApartment !== apartmentName) return false;

      // 발코니확장 제외 (C11 수식으로 별도 처리)
      if (rowCategory === "발코니확장") return false;

      // 타입 매칭 체크: "전체" 또는 현재 타입이 타입 문자열에 포함되어 있는지
      if (rowType === "전체") return true;  // "전체"는 무조건 포함

      // 타입 문자열을 쉼표로 분리하여 현재 타입이 포함되어 있는지 확인
      var typeList = rowType.toString().split(',').map(function(t) { return t.trim(); });
      return typeList.indexOf(typeValue) !== -1;
    });

    if (filteredData.length > 0) {
      var resultData = filteredData.map(row => [
        row[1],                    // 옵션구분 (B열 -> F열)
        row[7],                    // 내역 (H열 -> G열)
        convertToKoreanUnit(row[6]) // 금액 (G열 -> H열) - 만 단위로 변환
      ]);

      // 데이터 입력 (컬럼 6=F열)
      var targetRange = 등록검색시트.getRange(5, 6, resultData.length, 3);
      targetRange.setValues(resultData);

      // 데이터 영역 스타일 적용
      targetRange.setHorizontalAlignment('left')
                 .setVerticalAlignment('middle')
                 .setBorder(true, true, true, true, true, true, '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);

      // 내역 컬럼(G열) 텍스트 오버플로우 설정 (잘라내기)
      var detailRange = 등록검색시트.getRange(5, 7, resultData.length, 1);
      detailRange.setWrap(false)
                 .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
                 .setVerticalAlignment('middle');

      // 금액 컬럼(H열) 오른쪽 정렬 및 배경색
      var priceRange = 등록검색시트.getRange(5, 8, resultData.length, 1);
      priceRange.setHorizontalAlignment('right')
                .setBackground('#F5F5F5')
                .setNumberFormat('#,##0')
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

      // 옵션구분 컬럼(F열) 가운데 정렬
      var categoryRange = 등록검색시트.getRange(5, 6, resultData.length, 1);
      categoryRange.setHorizontalAlignment('center')
                   .setBackground('#E8F4FD')
                   .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

      // 행 높이 고정 (자동 조정 방지)
      for (var i = 5; i < 5 + resultData.length; i++) {
        등록검색시트.setRowHeightsForced(i, 1, 30);
      }

      // 컬럼 너비 자동 조정
      등록검색시트.setColumnWidth(5, 60);   // E열: 선택 (체크박스)
      등록검색시트.setColumnWidth(6, 120);  // F열: 옵션구분
      등록검색시트.setColumnWidth(7, 250);  // G열: 내역
      등록검색시트.setColumnWidth(8, 100);  // H열: 금액

      // 체크박스 생성 및 초기화 (컬럼 5=E열)
      var checkboxRange = 등록검색시트.getRange(5, 5, resultData.length, 1);
      checkboxRange.insertCheckboxes();
      var checkboxValues = Array(resultData.length).fill([false]);
      checkboxRange.setValues(checkboxValues);
      checkboxRange.setHorizontalAlignment('center')
                   .setVerticalAlignment('middle');

      // 동일한 옵션구분 셀 병합
      mergeSameCellsInOptionColumn(등록검색시트, 5, resultData.length);

      SpreadsheetApp.getUi().alert('✅ 옵션 데이터 처리가 완료되었습니다.');
    } else {
      SpreadsheetApp.getUi().alert('⚠️ 선택된 단지명/타입에 해당하는 옵션 데이터가 없습니다.');
    }
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    SpreadsheetApp.getUi().alert('❌ 오류가 발생했습니다: ' + error.toString());
  }
}

// 금액을 만 단위로 변환하는 함수
function convertToKoreanUnit(amount) {
  if (!amount || isNaN(amount)) return '';

  const numericValue = Number(amount.toString().replace(/[^0-9]/g, ''));
  const inManUnit = Math.floor(numericValue / 10000);

  return inManUnit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 셀 병합 함수
function mergeSameCellsInOptionColumn(sheet, startRow, rowCount) {
  if (rowCount <= 1) return;

  var values = sheet.getRange(startRow, 6, rowCount, 1).getValues();
  var mergeStart = startRow;
  var currentValue = values[0][0];

  for (var i = 1; i < rowCount; i++) {
    if (values[i][0] !== currentValue) {
      if (mergeStart < startRow + i - 1) {
        var mergeRange = sheet.getRange(mergeStart, 6, startRow + i - mergeStart, 1);
        mergeRange.merge();
        mergeRange.setVerticalAlignment('middle');
      }
      mergeStart = startRow + i;
      currentValue = values[i][0];
    }
  }

  if (mergeStart < startRow + rowCount - 1) {
    var finalMergeRange = sheet.getRange(mergeStart, 6, startRow + rowCount - mergeStart, 1);
    finalMergeRange.merge();
    finalMergeRange.setVerticalAlignment('middle');
  }
}


/**
 * =====================================================================================
 * 6. 입력폼 초기화
 * =====================================================================================
 */

/**
 * 입력 완료 후 입력값을 초기화합니다.
 * ★ 수식이 들어간 셀은 제외하고 초기화합니다.
 * - C7: 타입 (IMPORTRANGE)
 * - C10: 분양가 (IMPORTRANGE)
 * - C11: 발코니 (IMPORTRANGE)
 * - C12: 옵션 (합계 수식)
 * - C14: 합계 (수식)
 * - C28: 매물ID (수식)
 * - C36: 고객ID (수식)
 */
function clearInputForm() {
  const regSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('등록검색');

  // 수식 셀을 제외한 범위별 초기화
  const clearRanges = [
    'C4:C6',   // 단지명, 동, 호
    'C8:C9',   // C7(타입) 제외
    'C13',     // C10(분양가), C11(발코니), C12(옵션), C14(합계) 제외
    'C15:C27', // C14(합계) 제외
    'C29:C35', // C28(매물ID) 제외
    'C37:C50'  // C36(고객ID) 제외
  ];

  clearRanges.forEach(range => {
    regSheet.getRange(range).clearContent();
  });

  // 옵션 불러오기 영역 완전 초기화 (E4 헤더 제외, E5부터 깨끗하게)
  regSheet.getRange('E5:E1000').removeCheckboxes();  // 체크박스 먼저 제거
  regSheet.getRange('F5:F1000').breakApart();        // 병합 셀 해제
  regSheet.getRange('E5:H1000').clearContent();      // 내용 완전 삭제

  // 스타일도 초기화 (배경색, 테두리 등)
  regSheet.getRange('E5:H1000').clearFormat();

  // 행 높이 초기화 (기본값으로)
  regSheet.setRowHeights(5, 996, 21);  // 5행부터 1000행까지 기본 높이 21px

  Logger.log('✅ 입력폼이 초기화되었습니다 (수식 셀 보존: C7, C10, C11, C12, C14, C28, C36).');
}


/**
 * =====================================================================================
 * 7. 헬퍼(Helper) 함수들
 * =====================================================================================
 */

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(folderName);
}

function openUrlInNewTab(url, title) {
  // showModalDialog 권한 문제 회피: 메시지로 안내
  const message = title + '\n\n폴더 링크가 C24 셀에 저장되었습니다.\n클릭하여 폴더를 열어주세요.\n\n' + url;
  Browser.msgBox('폴더 생성 완료', message, Browser.Buttons.OK);
}

/**
 * ✨ 새로운 헬퍼 함수: 시스템 정보 표시
 */
function showSystemInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const propertyDb = ss.getSheetByName('매물DB');
  const customerDb = ss.getSheetByName('고객DB');

  const propertyCount = propertyDb.getLastRow() - 1; // 헤더 제외
  const customerCount = customerDb.getLastRow() - 1;

  const message = `📊 시스템 정보\n\n` +
                  `버전: v2.1 (하이브리드 ID 생성)\n\n` +
                  `매물 데이터: ${propertyCount}건\n` +
                  `고객 데이터: ${customerCount}명\n\n` +
                  `🔄 하이브리드 ID 생성 방식:\n` +
                  `- 수식으로 ID 미리 확인 (C28, C36)\n` +
                  `- 등록 시 수식 결과를 DB에 저장\n` +
                  `- 과거 데이터 불변성 보장\n\n` +
                  `✨ 적용된 개선사항:\n` +
                  `- 필수 필드 검증 강화\n` +
                  `- 중복 등록 방지\n` +
                  `- 접수일/접수자 자동 입력\n` +
                  `- 데이터 타입 표준화`;

  Browser.msgBox('시스템 정보', message, Browser.Buttons.OK);
}


/**
 * =====================================================================================
 * 설치 가이드
 * =====================================================================================
 *
 * 1. onEdit 트리거 설정:
 *    - Apps Script 에디터 > 트리거 (⏰) > + 트리거 추가
 *    - 실행할 함수: onEdit
 *    - 이벤트 유형: 수정 시
 *
 * 2. 등록 버튼에 스크립트 할당:
 *    - 등록 버튼 이미지 클릭 > ⋮ > 스크립트 할당
 *    - 함수명: registerPropertyAndClient
 *
 * 3. C3 셀 수식:
 *    =IF(AND(C4<>"", C5<>"", C6<>""),
 *      IF(COUNTIFS(매물DB!A:A, C4, 매물DB!B:B, C5, 매물DB!C:C, C6) > 0,
 *        "📝 수정모드",
 *        "✨ 신규등록"
 *      ),
 *      ""
 *    )
 *
 * 4. C28 셀 수식 (매물ID 자동 생성):
 *    =IFERROR(INDEX(아파트_단지목록[단지명축약],MATCH(C4, 아파트_단지목록[단지명],0)) & " " & C5 & "-" & C6 & "-" & C7,"ID 자동 생성 수정 X")
 *
 * 5. C36 셀 수식 (고객ID 자동 생성):
 *    =IFERROR(INDEX(아파트_단지목록[단지명축약],MATCH(C4, 아파트_단지목록[단지명],0)) & " " & C5 & "-" & C6 & " O","ID 자동 생성 수정 X")
 *
 * 6. B1 셀: 통합단지DB 스프레드시트 ID 입력
 *    (현재: 1XY35_z3bIIzSmD6LMK_ygM6l_ZG7_KAuXxuo0YD-c_0)
 *
 * 7. 통합단지DB 옵션 시트 H2 셀 배열수식:
 *    =ARRAYFORMULA(IF(D2:D="",,D2:D&" | "&E2:E&" | "&F2:F))
 *
 * =====================================================================================
 *
 * ✨ 개선사항 요약:
 *
 * 1. 🔄 하이브리드 ID 생성 방식:
 *    - C28(매물ID), C36(고객ID)에 수식으로 미리 표시
 *    - 사용자가 등록 전 ID 확인 가능
 *    - 등록 버튼 클릭 시 수식 결과를 읽어서 DB에 영구 저장
 *    - 과거 데이터 불변성 보장 (단지명축약 변경해도 기존 데이터는 불변)
 *
 * 2. 필수 필드 검증:
 *    - 단지명, 동, 호, 타입, 거래유형, 거래상태 필수 입력
 *    - 누락 시 명확한 오류 메시지
 *
 * 3. 자동 데이터 입력:
 *    - 접수일: 현재 날짜 자동 입력
 *    - 접수자: 사용자 이메일에서 자동 추출
 *
 * 4. 중복 방지:
 *    - 동일 단지명+동+호+타입 체크
 *    - 중복 시 수정 모드 전환 제안
 *
 * 5. 데이터 타입 표준화:
 *    - 타입: 문자열로 통일
 *    - 연락처: 하이픈 포함 형식 (010-XXXX-XXXX)
 *
 * =====================================================================================
 */
