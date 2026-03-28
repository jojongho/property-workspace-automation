/**
 * 폼 제출 시 자동 실행
 * 1) 고객DB에 행 추가
 * 2) 업무일지 포맷 생성
 * 3) 팀 이메일 발송
 */

function onFormSubmit(e) {
  var responses = parseFormResponse_(e);
  var rowNumber = writeToCustomerDb_(responses);
  var diaryText = formatDiary_(responses);
  sendDiaryEmail_(responses, diaryText);

  Logger.log('상담일지 처리 완료 - 고객DB 행: ' + rowNumber);
}


/**
 * 폼 응답 파싱
 */
function parseFormResponse_(e) {
  var itemResponses = e.response.getItemResponses();
  var data = {};
  var titleMap = {
    '상담일자': 'consultDate',
    '담당자명': 'manager',
    '고객/업체명': 'companyName',
    '고객성함': 'customerName',
    '업종': 'business',
    '관심호실 (복수 선택 가능)': 'units',
    '등급': 'grade',
    '연락처': 'contact',
    '유입채널': 'channel',
    '파이프라인단계': 'pipeline',
    '상담내용': 'memo',
    '다음액션일': 'nextActionDate',
    '비고': 'remark'
  };

  for (var i = 0; i < itemResponses.length; i++) {
    var title = itemResponses[i].getItem().getTitle();
    var key = titleMap[title];
    if (key) {
      data[key] = itemResponses[i].getResponse();
    }
  }

  // 날짜 포맷 정리
  if (data.consultDate) {
    data.consultDateFormatted = formatDate_(data.consultDate);
  }
  if (data.nextActionDate) {
    data.nextActionDateFormatted = formatDate_(data.nextActionDate);
  }

  // 관심호실: 배열 → 쉼표 구분 문자열
  if (Array.isArray(data.units)) {
    data.unitsText = data.units.join(', ');
  } else {
    data.unitsText = data.units || '';
  }

  data.timestamp = new Date();

  return data;
}


/**
 * 고객DB 시트에 행 추가
 */
function writeToCustomerDb_(data) {
  var ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  var sheet = ss.getSheetByName(CONFIG.sheets.customerDb);
  var lastRow = sheet.getLastRow();
  var newRow = lastRow + 1;

  // No 자동 채번: 마지막 데이터 행의 No + 1
  var lastNo = 0;
  if (lastRow >= CONFIG.customerDataStartRow) {
    var lastNoVal = sheet.getRange(lastRow, CONFIG.customerColumns.no).getValue();
    lastNo = parseInt(lastNoVal, 10) || 0;
  }

  var cols = CONFIG.customerColumns;
  var dateStr = data.consultDateFormatted || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy. M. d');

  sheet.getRange(newRow, cols.no).setValue(lastNo + 1);
  sheet.getRange(newRow, cols.companyName).setValue(data.companyName || '');
  sheet.getRange(newRow, cols.manager).setValue(data.manager || '');
  sheet.getRange(newRow, cols.firstDate).setValue(dateStr);
  sheet.getRange(newRow, cols.business).setValue(data.business || '');
  sheet.getRange(newRow, cols.unit).setValue(data.unitsText || '');
  sheet.getRange(newRow, cols.grade).setValue(data.grade || '');
  sheet.getRange(newRow, cols.contact).setValue(data.contact || '');
  sheet.getRange(newRow, cols.customerName).setValue(data.customerName || '');
  sheet.getRange(newRow, cols.channel).setValue(data.channel || '');
  sheet.getRange(newRow, cols.lastContact).setValue(dateStr);
  sheet.getRange(newRow, cols.nextAction).setValue(data.nextActionDateFormatted || '');
  sheet.getRange(newRow, cols.pipeline).setValue(data.pipeline || '신규등록');
  sheet.getRange(newRow, cols.memo).setValue(data.memo || '');
  sheet.getRange(newRow, cols.remark).setValue(data.remark || '');

  return newRow;
}


/**
 * 날짜 문자열 파싱 (Google Forms → "yyyy-MM-dd" 형태)
 */
function formatDate_(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy. M. d');
  } catch (e) {
    return dateStr;
  }
}
