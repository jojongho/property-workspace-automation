/**
 * 저장된 폼 URL 표시
 */
function showFormUrl() {
  var props = PropertiesService.getDocumentProperties();
  var formId = props.getProperty('DIARY_FORM_ID');

  if (!formId) {
    SpreadsheetApp.getUi().alert('아직 폼이 생성되지 않았습니다.\n[상담일지] → [폼 생성/업데이트]를 먼저 실행하세요.');
    return;
  }

  try {
    var form = FormApp.openById(formId);
    var publishUrl = form.getPublishedUrl();
    var shortenedUrl = form.shortenFormUrl(publishUrl);

    SpreadsheetApp.getUi().alert(
      '📋 고객 상담일지 폼\n\n' +
      '응답 URL (모바일 공유):\n' + shortenedUrl + '\n\n' +
      '편집 URL:\n' + form.getEditUrl()
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('폼을 찾을 수 없습니다. 다시 생성해 주세요.\n에러: ' + e.message);
  }
}
