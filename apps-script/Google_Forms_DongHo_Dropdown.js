// ====== 설정 정보 ======
const SHEET_NAME = "분양가";
const FORM_URL = "https://docs.google.com/forms/d/1m4duDOKkYXheCT5C--wSoxGIrjVABWJcEJRJdGUsyYw/edit";
const DONG_QUESTION_TITLE = "동을 선택하세요 (필수)";
const HO_QUESTION_TITLE = "호를 선택하세요 (필수)";
// ========================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('폼 설정')
    .addItem('종속형 드롭다운 설정', 'setupForm')
    .addToUi();
}

function setupForm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    SpreadsheetApp.getUi().alert(`오류: "${SHEET_NAME}" 시트를 찾을 수 없습니다.`);
    return;
  }

  // 동-호 매핑 데이터 추출
  const data = sheet.getRange("A2:B" + sheet.getLastRow()).getValues();
  const dongHoMap = {};
  const dongList = [];

  for (let i = 0; i < data.length; i++) {
    const dong = String(data[i][0]).trim();
    const ho = String(data[i][1]).trim();

    if (dong && ho) {
      if (!dongHoMap[dong]) {
        dongHoMap[dong] = [];
        dongList.push(dong);
      }
      dongHoMap[dong].push(ho);
    }
  }

  if (dongList.length === 0) {
    SpreadsheetApp.getUi().alert("오류: 동/호 데이터를 찾을 수 없습니다.");
    return;
  }

  // Form 연결
  const form = FormApp.openByUrl(FORM_URL);
  let dongItem = null;
  let hoItem = null;

  const items = form.getItems();
  for (const item of items) {
    if (item.getTitle() === DONG_QUESTION_TITLE) {
      dongItem = item.asListItem();
    } else if (item.getTitle() === HO_QUESTION_TITLE) {
      hoItem = item.asListItem();
    }
  }

  if (!dongItem || !hoItem) {
    SpreadsheetApp.getUi().alert("오류: Form에서 '동' 또는 '호' 질문을 찾을 수 없습니다.\n질문 제목이 정확히 일치하는지 확인하세요:\n- " + DONG_QUESTION_TITLE + "\n- " + HO_QUESTION_TITLE);
    return;
  }

  setupFormSections(form, dongHoMap, dongItem, hoItem);
}

function setupFormSections(form, dongHoMap, dongItem, hoItem) {
  // 기존 '호' 질문 제거
  if (hoItem) {
    form.deleteItem(hoItem.getIndex());
  }

  const choices = [];
  const dongList = Object.keys(dongHoMap).sort((a, b) => parseInt(a) - parseInt(b));

  // 동별 섹션 생성
  for (const dong of dongList) {
    // 새 섹션 생성
    const newSection = form.addPageBreakItem().setTitle(`${dong}동 호 선택`);
    newSection.setGoToPage(FormApp.PageNavigationType.SUBMIT);

    // 호 드롭다운 생성
    const hoList = dongHoMap[dong].sort((a, b) => parseInt(a) - parseInt(b));
    const hoSectionItem = form.addListItem().setTitle(`${dong}동 - 호 선택`);
    hoSectionItem.setRequired(true);
    hoSectionItem.setChoiceValues(hoList);

    // 동 선택 시 해당 섹션으로 이동
    choices.push(dongItem.createChoice(dong, newSection));
  }

  dongItem.setChoices(choices);

  SpreadsheetApp.getUi().alert("✅ 종속형 드롭다운 설정 완료!\n\nForm을 열어 확인하세요.");
}
