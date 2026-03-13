// ====== 설정 정보 (고도화 버전) ======
const DATABASE_ID = "1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ"; // 데이터베이스 시트 ID
const RESPONSE_SS_ID = "1FZ3AWouL0poEP1NrpaxHsNqF6u26H8hZfefOePEe7sI"; // 고객 접수 시트 ID
const TARGET_SHEET_NAME = "매물접수"; // 응답을 저장할 시트 이름
// ===================================

/**
 * 웹앱 접속 시 HTML 페이지 반환
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('WebApp_MultiComplex_Index')
    .setTitle('부동산 통합 매물접수 & 견적 시스템')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 초기 단지 목록 가져오기
 */
function getComplexList() {
  const ss = SpreadsheetApp.openById(DATABASE_ID);
  const sheet = ss.getSheetByName("분양가");
  const data = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
  
  // 중복 제거된 단지 목록 추출
  const complexes = [...new Set(data.flat())].filter(String).sort();
  return complexes;
}

/**
 * 선택된 단지의 동 목록 가져오기 (On-Demand)
 */
function getDongList(complexName) {
  const ss = SpreadsheetApp.openById(DATABASE_ID);
  const sheet = ss.getSheetByName("분양가");
  const data = sheet.getRange("A2:B" + sheet.getLastRow()).getValues();
  
  const dongs = data
    .filter(row => row[0] === complexName)
    .map(row => row[1]);
    
  return [...new Set(dongs)].filter(String).sort((a,b) => parseInt(a) - parseInt(b));
}

/**
 * 선택된 동의 호수 목록 가져오기 (On-Demand)
 */
function getHoList(complexName, dong) {
  const ss = SpreadsheetApp.openById(DATABASE_ID);
  const sheet = ss.getSheetByName("분양가");
  const data = sheet.getRange("A2:C" + sheet.getLastRow()).getValues();
  
  const hos = data
    .filter(row => row[0] === complexName && String(row[1]) === String(dong))
    .map(row => row[2]);
    
  return [...new Set(hos)].filter(String).sort((a,b) => parseInt(a) - parseInt(b));
}

/**
 * 특정 호수의 상세 정보 (타입, 분양가, 옵션) 가져오기
 */
function getUnitDetails(complexName, dong, ho) {
  try {
    const ss = SpreadsheetApp.openById(DATABASE_ID);
    
    // 1. 분양가 시트에서 기본 정보 조회
    const priceSheet = ss.getSheetByName("분양가");
    const priceData = priceSheet.getDataRange().getValues();
    let unitInfo = null;

    for (let i = 1; i < priceData.length; i++) {
      if (priceData[i][0] === complexName && String(priceData[i][1]) === String(dong) && String(priceData[i][2]) === String(ho)) {
        unitInfo = {
          type: priceData[i][3],       // D열: 타입
          basePrice: priceData[i][7],  // H열: 분양가
          balconyPrice: priceData[i][17] || 0 // R열: 발코니 확장비
        };
        break;
      }
    }

    if (!unitInfo) return { success: false, message: "호수 정보를 찾을 수 없습니다." };

    // 2. 옵션 시트에서 해당 타입의 옵션 조회
    const optionSheet = ss.getSheetByName("옵션");
    const optionData = optionSheet.getDataRange().getValues();
    const options = [];

    for (let j = 1; j < optionData.length; j++) {
      // 단지명(A)과 타입(C)이 일치하는 품목(D), 세부(E), 가격(G) 가져오기
      if (optionData[j][0] === complexName && String(optionData[j][2]) === String(unitInfo.type)) {
        options.push({
          name: optionData[j][3],
          detail: optionData[j][4],
          price: optionData[j][6] || 0
        });
      }
    }

    return {
      success: true,
      unitInfo: unitInfo,
      options: options
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 폼 제출 및 외부 시트 저장
 */
function submitForm(formData) {
  try {
    const ss = SpreadsheetApp.openById(RESPONSE_SS_ID);
    let sheet = ss.getSheetByName(TARGET_SHEET_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(TARGET_SHEET_NAME);
      sheet.appendRow(['타임스탬프', '단지명', '동', '호', '타입', '분양가', '발코니', '선택옵션', '총합계', '이름', '연락처', '메모']);
    }

    sheet.appendRow([
      new Date(),
      formData.complex,
      formData.dong,
      formData.ho,
      formData.type,
      formData.basePrice,
      formData.balconyPrice,
      formData.selectedOptionsText,
      formData.totalAmount,
      formData.name,
      formData.phone,
      formData.memo
    ]);

    return { success: true, message: '성공적으로 접수되었습니다.' };
  } catch (e) {
    return { success: false, message: '저장 중 오류 발생: ' + e.toString() };
  }
}
