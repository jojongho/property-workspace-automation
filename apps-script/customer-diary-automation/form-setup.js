/**
 * Google Form 생성 및 스프레드시트 연결
 * 메뉴에서 [상담일지] → [폼 생성/업데이트] 로 실행
 */

function createOrUpdateForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var formId = props.getProperty('DIARY_FORM_ID');
  var form;

  if (formId) {
    try {
      form = FormApp.openById(formId);
      Logger.log('기존 폼 업데이트: ' + form.getEditUrl());
      clearFormItems_(form);
    } catch (e) {
      Logger.log('기존 폼을 찾을 수 없어 새로 생성합니다.');
      form = null;
    }
  }

  if (!form) {
    form = FormApp.create('e편한세상 시티 천안아산역 - 고객 상담일지');
    props.setProperty('DIARY_FORM_ID', form.getId());
  }

  form.setDescription(
    '고객 상담 후 작성해 주세요.\n' +
    '입력하신 내용은 고객DB에 자동 등록되고, 업무일지가 팀 이메일로 발송됩니다.'
  );
  form.setConfirmationMessage('상담일지가 등록되었습니다. 고객DB 및 업무일지 이메일을 확인하세요.');

  // 담당자 목록을 멤버 시트에서 가져옴
  var managers = getManagerList_();

  // --- 폼 항목 생성 ---

  // 1. 상담일자
  form.addDateItem()
    .setTitle('상담일자')
    .setRequired(true);

  // 2. 담당자명
  if (managers.length > 0) {
    form.addListItem()
      .setTitle('담당자명')
      .setChoiceValues(managers)
      .setRequired(true);
  } else {
    form.addTextItem()
      .setTitle('담당자명')
      .setRequired(true);
  }

  // 3. 고객/업체명
  form.addTextItem()
    .setTitle('고객/업체명')
    .setRequired(true);

  // 4. 고객성함
  form.addTextItem()
    .setTitle('고객성함')
    .setRequired(false);

  // 5. 업종
  form.addTextItem()
    .setTitle('업종')
    .setRequired(false);

  // 6. 관심호실
  form.addCheckboxItem()
    .setTitle('관심호실 (복수 선택 가능)')
    .setChoiceValues(CONFIG.unitList)
    .setRequired(false);

  // 7. 등급
  form.addListItem()
    .setTitle('등급')
    .setChoiceValues(CONFIG.gradeOptions)
    .setRequired(false);

  // 8. 연락처
  form.addTextItem()
    .setTitle('연락처')
    .setRequired(false);

  // 9. 유입채널
  form.addListItem()
    .setTitle('유입채널')
    .setChoiceValues(CONFIG.channelOptions)
    .setRequired(false);

  // 10. 파이프라인단계
  form.addListItem()
    .setTitle('파이프라인단계')
    .setChoiceValues(CONFIG.pipelineOptions)
    .setRequired(true);

  // 11. 상담내용 (핵심!)
  form.addParagraphTextItem()
    .setTitle('상담내용')
    .setHelpText('고객과의 상담 내용을 자유롭게 작성해 주세요.')
    .setRequired(true);

  // 12. 다음액션일
  form.addDateItem()
    .setTitle('다음액션일')
    .setRequired(false);

  // 13. 비고
  form.addParagraphTextItem()
    .setTitle('비고')
    .setRequired(false);

  // 폼 → 스프레드시트 응답 연결
  form.setDestination(FormApp.DestinationType.SPREADSHEET, CONFIG.spreadsheetId);

  // 트리거 설정
  setupFormTrigger_(form);

  var editUrl = form.getEditUrl();
  var publishUrl = form.getPublishedUrl();
  var shortenedUrl = form.shortenFormUrl(publishUrl);

  SpreadsheetApp.getUi().alert(
    '폼이 생성되었습니다!\n\n' +
    '응답 URL (모바일 북마크용):\n' + shortenedUrl + '\n\n' +
    '편집 URL:\n' + editUrl
  );

  Logger.log('폼 응답 URL: ' + publishUrl);
  Logger.log('폼 단축 URL: ' + shortenedUrl);
  Logger.log('폼 편집 URL: ' + editUrl);
}


/**
 * 멤버 시트에서 담당자 목록 가져오기
 */
function getManagerList_() {
  var ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  var sheet = ss.getSheetByName(CONFIG.sheets.member);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  return names
    .map(function(row) { return row[0]; })
    .filter(function(name) { return name !== ''; });
}


/**
 * 기존 폼 항목 모두 삭제
 */
function clearFormItems_(form) {
  var items = form.getItems();
  for (var i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
}


/**
 * 폼 제출 트리거 설정 (중복 방지)
 */
function setupFormTrigger_(form) {
  var triggers = ScriptApp.getProjectTriggers();
  var formId = form.getId();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit' &&
        triggers[i].getTriggerSourceId() === formId) {
      Logger.log('onFormSubmit 트리거가 이미 존재합니다.');
      return;
    }
  }

  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log('onFormSubmit 트리거 생성 완료');
}
