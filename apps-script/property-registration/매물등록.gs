function processPropertyRegistration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const formSheet = ss.getSheetByName('매물등록');
  const dbSheet = ss.getSheetByName('매물DB');
  const ui = SpreadsheetApp.getUi();

  if (!formSheet || !dbSheet) {
    ui.alert('시트 확인 필요', 
             '"매물등록"과 "매물DB" 시트가 모두 있는지 확인해주세요.', 
             ui.ButtonSet.OK);
    return;
  }

  try {
    const inputData = getInputData(formSheet);

    if (!validateRequiredFields(inputData)) {
      ui.alert('필수 항목 확인',
               '필수 입력 항목을 확인해주세요.\n(단지명, 동, 호, 타입은 필수입니다)',
               ui.ButtonSet.OK);
      return;
    }

    if (isDuplicate(dbSheet, inputData)) {
      const response = ui.alert('중복 매물 확인',
                              '동일한 매물이 이미 존재합니다.\n계속 진행하시겠습니까?',
                              ui.ButtonSet.YES_NO);

      if (response !== ui.Button.YES) {
        return;
      }
    }

    appendToDatabase(dbSheet, inputData);

    ui.alert('등록 완료',
             '매물이 성공적으로 등록되었습니다.',
             ui.ButtonSet.OK);

    clearForm();

  } catch (error) {
    Logger.log('Error in processPropertyRegistration: ' + error.toString());
    ui.alert('오류 발생',
             '처리 중 오류가 발생했습니다.\n' + error.toString(),
             ui.ButtonSet.OK);
  }
}

function getInputData(sheet) {
  const dataRange = sheet.getRange('C4:C35');
  const values = dataRange.getValues();
  return values.map(row => row[0]);
}

function validateRequiredFields(data) {
  const requiredFields = [0, 1, 2, 3];
  return requiredFields.every(index => data[index] !== '');
}

function isDuplicate(sheet, data) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const existingData = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  return existingData.some(row => 
    row[0] === data[0] && // 단지명
    row[1] === data[1] && // 동
    row[2] === data[2]    // 호
  );
}

function appendToDatabase(sheet, data) {
  const lastRow = sheet.getLastRow();
  const newRow = lastRow + 1;
  sheet.getRange(newRow, 1, 1, data.length).setValues([data]);
}

function clearForm() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('매물등록');

  // 기존 매물등록 양식 초기화 범위
  const rangesToClear = [
    'C5:C6',     // 4행 다음부터 6행까지
    'C8:C9',     // 7행을 제외하고 8행부터 9행까지
    'C13',       // 13행
    'C15:C35',   // 14행 다음부터 35행까지
    'L5:O1000'   // 옵션 목록 범위 추가
  ];

  // 모든 지정된 범위 초기화
  rangesToClear.forEach(range => {
    sheet.getRange(range).clearContent();
  });

  // 셀 포커스를 C5로 이동
  sheet.setActiveRange(sheet.getRange('C5'));

  // 데이터 유효성 검사 다시 로드 (옵션 목록 새로고침)
  try {
    const validationRange = sheet.getRange('C4'); // 데이터 유효성 검사가 있는 셀
    const validation = validationRange.getDataValidation();
    if (validation) {
      const criteria = validation.getCriteriaType();
      const args = validation.getCriteriaValues();
      validationRange.setDataValidation(validation);
    }
  } catch (error) {
    Logger.log('Error refreshing data validation: ' + error.toString());
  }
}