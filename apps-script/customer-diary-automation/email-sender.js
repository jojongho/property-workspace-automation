/**
 * 업무일지 이메일 발송
 * 멤버 시트에서 알림수신 체크박스(TRUE)인 멤버에게 발송
 */
function sendDiaryEmail_(data, diaryText) {
  var recipients = getEmailRecipients_();
  if (recipients.length === 0) {
    Logger.log('이메일 수신자가 없습니다. 멤버 시트의 이메일/알림수신 컬럼을 확인하세요.');
    return;
  }

  var dateStr = data.consultDateFormatted || Utilities.formatDate(new Date(), 'Asia/Seoul', 'M월 d일');
  var subject = CONFIG.emailSubjectPrefix + ' - ' +
                (data.manager || '') + ' / ' +
                (data.companyName || '') + ' (' + dateStr + ')';

  var htmlBody = formatDiaryHtml_(data, diaryText);

  // 플레인 텍스트 (카톡 복붙용으로 유지)
  var plainBody = diaryText + '\n\n---\n이 메일은 고객 상담 폼 제출 시 자동 발송됩니다.';

  for (var i = 0; i < recipients.length; i++) {
    try {
      MailApp.sendEmail({
        to: recipients[i],
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody
      });
      Logger.log('이메일 발송 완료: ' + recipients[i]);
    } catch (e) {
      Logger.log('이메일 발송 실패 (' + recipients[i] + '): ' + e.message);
    }
  }
}


/**
 * 멤버 시트에서 이메일 수신 대상 목록 조회
 * 알림수신 체크박스(E열)가 TRUE인 멤버에게 발송
 */
function getEmailRecipients_() {
  var ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  var sheet = ss.getSheetByName(CONFIG.sheets.member);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A:담당자명, B:직급, C:연락처, D:이메일, E:알림수신(체크박스)
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var emails = [];

  for (var i = 0; i < data.length; i++) {
    var email = data[i][3]; // D열: 이메일
    var notify = data[i][4]; // E열: 알림수신 (체크박스 → true/false)

    if (email && notify === true) {
      emails.push(email);
    }
  }

  return emails;
}


/**
 * 테스트: 업무일지 이메일 미리보기
 * 메뉴에서 [상담일지] → [이메일 테스트] 로 실행
 */
function testDiaryEmail() {
  var testData = {
    consultDateFormatted: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy년 M월 d일'),
    manager: '테스트 담당자',
    companyName: '테스트 업체',
    customerName: '홍길동',
    business: '카페',
    unitsText: '115, 117',
    grade: 'B',
    channel: '현장방문',
    pipeline: '미팅예정',
    memo: '현장에 오후 3시 방문하여 약 1시간 가량 단지 내 상가를 둘러봄. 117호실에 관심이 많았으며, 카페 창업을 희망. 스쿨존 근처 유동인구에 대해 질문함.',
    nextActionDateFormatted: Utilities.formatDate(new Date(Date.now() + 7 * 86400000), 'Asia/Seoul', 'yyyy. M. d'),
    remark: '2차 미팅 시 임대견적서 준비'
  };

  var diaryText = formatDiary_(testData);
  var htmlBody = formatDiaryHtml_(testData, diaryText);

  // 현재 사용자에게만 테스트 발송
  var myEmail = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: myEmail,
    subject: '[테스트] ' + CONFIG.emailSubjectPrefix,
    body: diaryText,
    htmlBody: htmlBody
  });

  SpreadsheetApp.getUi().alert(
    '테스트 이메일을 ' + myEmail + ' 로 발송했습니다.\n\n' +
    '--- 카톡 복붙용 텍스트 ---\n\n' + diaryText
  );
}
