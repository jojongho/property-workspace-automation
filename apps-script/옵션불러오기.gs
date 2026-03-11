// 스크립트가 처음 로드될 때 실행되는 함수
function onOpen() {
  // 이미지가 있는 셀을 클릭했을 때의 동작을 정의하는 메뉴 추가
  SpreadsheetApp.getActiveSpreadsheet().addMenu('매물 옵션 관리', [
    { name: '권한 설정', functionName: 'requestSpreadsheetPermission' },
    { name: '옵션 데이터 가져오기', functionName: 'processOptionDataFromExternalSheet' },
  ]);
}

// 스프레드시트 권한 설정을 위한 함수
function requestSpreadsheetPermission() {
  SpreadsheetApp.getActive();
  Logger.log('기본 권한이 설정되었습니다.');
  SpreadsheetApp.getUi().alert('권한이 설정되었습니다.');
}

// 금액을 만 단위로 변환하는 함수
function convertToKoreanUnit(amount) {
  if (!amount || isNaN(amount)) return '';
  
  // 숫자만 추출
  const numericValue = Number(amount.toString().replace(/[^0-9]/g, ''));
  
  // 만 단위로 변환 (10000으로 나눔)
  const inManUnit = Math.floor(numericValue / 10000);
  
  // 천 단위 구분자 추가
  return inManUnit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 메인 처리 로직
function processOptionDataFromExternalSheet() {
  Logger.log('옵션 데이터 처리 시작');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 매물등록시트 = ss.getSheetByName('매물등록');

  if (!매물등록시트) {
    Logger.log('매물등록 시트를 찾을 수 없습니다.');
    return;
  }

  // B1 셀에서 외부 스프레드시트 ID 가져오기
  var externalSheetId = 매물등록시트.getRange('B1').getValue();
  Logger.log('외부 스프레드시트 ID: ' + externalSheetId);

  if (!externalSheetId) {
    Logger.log('경고: 외부 스프레드시트 ID가 없습니다.');
    SpreadsheetApp.getUi().alert('B1 셀에 외부 스프레드시트 ID를 입력해주세요.');
    return;
  }

  // C7 셀의 타입 값 가져오기
  var typeValue = 매물등록시트.getRange('C7').getValue();
  Logger.log('선택된 타입 값: ' + typeValue);

  if (!typeValue) {
    Logger.log('타입 값이 없어 데이터를 초기화합니다.');
    매물등록시트.getRange('L5:O1000').clearContent();
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

    // 헤더 설정
    매물등록시트.getRange('M4').setValue('옵션구분');
    매물등록시트.getRange('N4').setValue('내역');
    매물등록시트.getRange('O4').setValue('금액(만)');

    // 기존 데이터 초기화
    매물등록시트.getRange('L5:O1000').clearContent();
    매물등록시트.getRange('L5:L1000').removeCheckboxes();
    매물등록시트.getRange('M5:M1000').breakApart();

    // 외부 옵션시트에서 데이터 가져오기
    var lastRow = 옵션시트.getLastRow();
    var optionsData = 옵션시트.getRange('A2:H' + lastRow).getValues();
    var filteredData = optionsData.filter(row => row[1] === typeValue);

    if (filteredData.length > 0) {
      var resultData = filteredData.map(row => [
        row[0],                    // 옵션구분 (A열 -> M열)
        row[7],                    // 내역 (H열 -> N열)
        convertToKoreanUnit(row[5]) // 금액 (F열 -> O열) - 만 단위로 변환
      ]);

      // 데이터 입력
      var targetRange = 매물등록시트.getRange(5, 13, resultData.length, 3);
      targetRange.setValues(resultData);

      // 체크박스 생성 및 초기화
      var checkboxRange = 매물등록시트.getRange(5, 12, resultData.length, 1);
      checkboxRange.insertCheckboxes();
      var checkboxValues = Array(resultData.length).fill([false]);
      checkboxRange.setValues(checkboxValues);

      // 동일한 옵션구분 셀 병합
      mergeSameCellsInOptionColumn(매물등록시트, 5, resultData.length);

      SpreadsheetApp.getUi().alert('데이터 처리가 완료되었습니다.');
    } else {
      SpreadsheetApp.getUi().alert('선택된 타입에 해당하는 데이터가 없습니다.');
    }
  } catch (error) {
    Logger.log('오류 발생: ' + error.toString());
    SpreadsheetApp.getUi().alert('오류가 발생했습니다: ' + error.toString() + '\n\n권한이 필요한 경우 상단 메뉴의 "매물 옵션 관리 > 권한 설정"을 실행해주세요.');
  }
}

// 셀 병합 함수
function mergeSameCellsInOptionColumn(sheet, startRow, rowCount) {
  if (rowCount <= 1) return;

  var values = sheet.getRange(startRow, 13, rowCount, 1).getValues();
  var mergeStart = startRow;
  var currentValue = values[0][0];

  for (var i = 1; i < rowCount; i++) {
    if (values[i][0] !== currentValue) {
      if (mergeStart < startRow + i - 1) {
        var mergeRange = sheet.getRange(mergeStart, 13, startRow + i - mergeStart, 1);
        mergeRange.merge();
        mergeRange.setVerticalAlignment('middle');
      }
      mergeStart = startRow + i;
      currentValue = values[i][0];
    }
  }

  if (mergeStart < startRow + rowCount - 1) {
    var finalMergeRange = sheet.getRange(mergeStart, 13, startRow + rowCount - mergeStart, 1);
    finalMergeRange.merge();
    finalMergeRange.setVerticalAlignment('middle');
  }
}