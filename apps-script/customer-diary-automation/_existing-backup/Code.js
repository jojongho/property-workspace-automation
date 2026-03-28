/**
 * 공공데이터 API 연동 - 구글 시트 "검색입력" UI 기반 조회기
 *
 * [설치 및 사용 방법]
 * 1. 이 코드를 복사합니다.
 * 2. 데이터를 표시할 구글 시트를 열고 상단 메뉴에서 [확장 프로그램] -> [Apps Script]를 클릭합니다.
 * 3. 기존 코드를 모두 지우고 이 코드를 붙여넣습니다.
 * 4. 아래의 `API_KEY` 변수에 공공데이터포털에서 발급받은 '일반 인증키(Encoding)'를 입력합니다.
 * 5. 저장(재생 버튼 옆에 있는 디스켓 아이콘)을 누릅니다.
 * 6. 시트로 돌아가면 상단에 "공공데이터 연동" 이라는 메뉴가 새로 생깁니다. (새로고침 필요)
 * 7. [검색입력 시트 초기화] 실행 → B2 드롭다운에서 API 종류 선택 → [데이터 조회 실행]
 */

// ★ 인코딩(Encoding) 키를 그대로 입력하세요 (URL 인코딩된 형태 그대로 사용합니다)
var API_KEY =
  "Z%2BMfKoMleRlwPEc4ukEphU%2FqxcRhdzSYOf%2F%2FJaI09%2F6NoUm5NBR9bd5Yuo9nS5Pzh4%2FS42ZMOSRGx8t8EIfN8A%3D%3D";

// ─── 샘플 데이터 정의 ──────────────────────────────────────────────
// 소상공인 상가정보: B3에 시군구 코드 필요
var SAMPLES_SMALL_BIZ = [
  { label: "강남구 전체",       region: "11680", keyword: "" },
  { label: "강남구 카페",       region: "11680", keyword: "카페" },
  { label: "강남구 치킨",       region: "11680", keyword: "치킨" },
  { label: "서초구 전체",       region: "11650", keyword: "" },
  { label: "서초구 음식점",     region: "11650", keyword: "음식" },
  { label: "마포구 전체",       region: "11440", keyword: "" },
  { label: "마포구 편의점",     region: "11440", keyword: "편의점" },
  { label: "아산시 전체",       region: "44200", keyword: "" },
  { label: "아산시 부동산",     region: "44200", keyword: "부동산" },
  { label: "천안시 동남구 전체", region: "44131", keyword: "" },
];

// 가맹본부 현황: B3에 시도명, B4에 검색어
var SAMPLES_FRANCHISE = [
  { label: "서울 전체",         region: "서울특별시", keyword: "" },
  { label: "서울 치킨",         region: "서울특별시", keyword: "치킨" },
  { label: "서울 커피",         region: "서울특별시", keyword: "커피" },
  { label: "경기 전체",         region: "경기도",     keyword: "" },
  { label: "경기 편의점",       region: "경기도",     keyword: "편의점" },
  { label: "부산 전체",         region: "부산광역시", keyword: "" },
  { label: "전국 BBQ",          region: "",           keyword: "BBQ" },
  { label: "전국 맘스터치",     region: "",           keyword: "맘스터치" },
  { label: "전국 이디야",       region: "",           keyword: "이디야" },
  { label: "전국 스타벅스",     region: "",           keyword: "스타벅스" },
];

// API 타입 목록
var API_TYPES = ["소상공인 상가정보", "가맹본부 현황"];

// 가맹본부 조회 가능 년도 (2017년부터)
function getFranchiseYears_() {
  var years = [];
  var currentYear = new Date().getFullYear();
  for (var y = currentYear; y >= 2017; y--) {
    years.push(String(y));
  }
  return years;
}

// ─── 1. 시트를 열었을 때 자동으로 사용자 정의 메뉴 생성 ─────────────
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("공공데이터 연동")
    .addItem("🔍 데이터 조회 실행", "executeSearch")
    .addSeparator()
    .addItem("📋 검색입력 시트 초기화", "initSearchSheet")
    .addToUi();
  ui.createMenu("📋 상담일지")
    .addItem("폼 생성/업데이트", "createOrUpdateForm")
    .addItem("이메일 테스트", "testDiaryEmail")
    .addSeparator()
    .addItem("폼 URL 확인", "showFormUrl")
    .addToUi();
}

// ─── 1-1. 셀 편집 이벤트: API 타입 / 샘플 변경 시 자동 연동 ──────────
function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== "검색입력") return;

  var row = e.range.getRow();
  var col = e.range.getColumn();

  // B2 (API 종류) 변경 → 샘플 드롭다운 갱신 + B3/B4/B6 초기화
  if (row === 2 && col === 2) {
    var apiType = String(e.value || "").trim();
    updateSampleDropdown_(sheet, apiType);
    updateYearDropdown_(sheet, apiType);
    sheet.getRange("B3").setValue("");
    sheet.getRange("B4").setValue("");
  }

  // B5 (샘플 선택) 변경 → B3/B4 자동 입력
  if (row === 5 && col === 2) {
    var sampleLabel = String(e.value || "").trim();
    var apiType = String(sheet.getRange("B2").getValue()).trim();
    applySampleValues_(sheet, apiType, sampleLabel);
  }
}

// ─── 1-2. 검색입력 시트 초기화 ────────────────────────────────────
function initSearchSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("검색입력");
  if (!sheet) {
    sheet = ss.insertSheet("검색입력");
  } else {
    sheet.clear();
  }

  // ── 타이틀 ──
  sheet.getRange("A1:C1").merge();
  sheet.getRange("A1").setValue("🔍 공공데이터 API 조회");
  sheet.getRange("A1")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor("#1a73e8");

  // ── 라벨 (A열) ──
  sheet.getRange("A2").setValue("API 종류");
  sheet.getRange("A3").setValue("지역코드/지역명");
  sheet.getRange("A4").setValue("검색어");
  sheet.getRange("A5").setValue("샘플 선택 (테스트용)");
  sheet.getRange("A6").setValue("기준년도 (가맹본부)");

  sheet.getRange("A2:A6")
    .setFontWeight("bold")
    .setBackground("#f3f3f3")
    .setHorizontalAlignment("right");

  // ── 기본값 ──
  sheet.getRange("B2").setValue("소상공인 상가정보");
  sheet.getRange("B3").setValue("");
  sheet.getRange("B4").setValue("");
  sheet.getRange("B5").setValue("");
  sheet.getRange("B6").setValue(String(new Date().getFullYear() - 1));

  // ── 입력 셀 스타일 ──
  sheet.getRange("B2:B6")
    .setBackground("#ffffff")
    .setBorder(true, true, true, true, false, false, "#dadce0", SpreadsheetApp.BorderStyle.SOLID);

  // ── B2: API 종류 드롭다운 ──
  var apiRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(API_TYPES, true)
    .setAllowInvalid(false)
    .setHelpText("API 종류를 선택해주세요")
    .build();
  sheet.getRange("B2").setDataValidation(apiRule);

  // ── B5: 샘플 드롭다운 ──
  updateSampleDropdown_(sheet, "소상공인 상가정보");

  // ── B6: 년도 드롭다운 (가맹본부용) ──
  updateYearDropdown_(sheet, "소상공인 상가정보");

  // ── 힌트 (C열) ──
  sheet.getRange("C2").setValue("← 클릭하여 선택").setFontColor("#9e9e9e").setFontSize(9);
  sheet.getRange("C3").setValue("← 소상공인: 시군구코드 / 가맹본부: 시도명").setFontColor("#9e9e9e").setFontSize(9);
  sheet.getRange("C5").setValue("← 선택하면 B3/B4 자동 입력").setFontColor("#9e9e9e").setFontSize(9);
  sheet.getRange("C6").setValue("← 가맹본부 API 전용 (2017~)").setFontColor("#9e9e9e").setFontSize(9);

  // ── 안내문 ──
  sheet.getRange("A8").setValue("📌 사용법");
  sheet.getRange("A8").setFontWeight("bold").setFontSize(11);
  sheet.getRange("A9").setValue("  1. B2에서 API 종류를 선택합니다.");
  sheet.getRange("A10").setValue("  2. B5에서 샘플을 선택하면 B3/B4가 자동 입력됩니다.");
  sheet.getRange("A11").setValue("  3. 또는 B3/B4에 직접 값을 입력합니다.");
  sheet.getRange("A12").setValue("  4. 가맹본부 API → B6에서 조회 년도를 선택합니다.");
  sheet.getRange("A13").setValue("  5. 메뉴 [공공데이터 연동] → [🔍 데이터 조회 실행] 클릭!");

  sheet.getRange("A15").setValue("📌 시군구 코드 참고 (소상공인 API)");
  sheet.getRange("A15").setFontWeight("bold").setFontSize(11);

  // 시군구 코드 레퍼런스 테이블
  var codeHeaders = ["시군구명", "코드"];
  var codeData = [
    ["강남구", "11680"], ["서초구", "11650"], ["송파구", "11710"],
    ["마포구", "11440"], ["영등포구", "11560"], ["종로구", "11110"],
    ["용산구", "11170"], ["강서구", "11500"], ["중구", "11140"],
    ["성동구", "11200"], ["수원시 장안구", "41111"], ["성남시 분당구", "41135"],
    ["아산시", "44200"], ["천안시 동남구", "44131"], ["천안시 서북구", "44133"],
  ];
  sheet.getRange(16, 1, 1, 2).setValues([codeHeaders]);
  sheet.getRange(16, 1, 1, 2)
    .setFontWeight("bold")
    .setBackground("#e8eaf6")
    .setFontColor("#3949ab");
  sheet.getRange(17, 1, codeData.length, 2).setValues(codeData);
  sheet.getRange(17, 1, codeData.length, 2)
    .setBorder(true, true, true, true, true, true, "#c5cae9", SpreadsheetApp.BorderStyle.SOLID);

  // ── 열 너비 설정 ──
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 280);

  // ── 결과 ──
  ss.setActiveSheet(sheet);
  ss.toast("검색입력 시트가 초기화되었습니다.\nB5에서 샘플을 선택해 테스트해 보세요!", "✅ 완료");
}

// ─── 헬퍼: 선택된 API 타입에 맞는 샘플 드롭다운 갱신 ────────────────
function updateSampleDropdown_(sheet, apiType) {
  var samples;
  if (apiType.indexOf("소상공인") !== -1 || apiType.indexOf("상가정보") !== -1) {
    samples = SAMPLES_SMALL_BIZ;
  } else if (apiType.indexOf("가맹본부") !== -1 || apiType.indexOf("프랜차이즈") !== -1) {
    samples = SAMPLES_FRANCHISE;
  } else {
    sheet.getRange("B5").clearDataValidations().setValue("");
    return;
  }

  var sampleLabels = samples.map(function (s) { return s.label; });
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(sampleLabels, true)
    .setAllowInvalid(false)
    .setHelpText("샘플 데이터를 선택하면 B3/B4가 자동 입력됩니다")
    .build();
  sheet.getRange("B5").setDataValidation(rule).setValue("");
}

// ─── 헬퍼: 년도 드롭다운 갱신 (가맹본부한테만 보이도록) ─────────────
function updateYearDropdown_(sheet, apiType) {
  if (apiType.indexOf("가맹본부") !== -1 || apiType.indexOf("프랜차이즈") !== -1) {
    var years = getFranchiseYears_();
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(years, true)
      .setAllowInvalid(false)
      .setHelpText("가맹사업 기준년도를 선택하세요 (2017년부터)")
      .build();
    sheet.getRange("B6").setDataValidation(rule);
    if (!sheet.getRange("B6").getValue()) {
      sheet.getRange("B6").setValue(String(new Date().getFullYear() - 1));
    }
    sheet.getRange("A6").setFontColor("#000000");
  } else {
    sheet.getRange("B6").clearDataValidations().setValue("");
    sheet.getRange("A6").setFontColor("#bdbdbd");
  }
}

// ─── 헬퍼: 샘플 선택 시 B3/B4에 값 자동 입력 ────────────────────────
function applySampleValues_(sheet, apiType, sampleLabel) {
  if (!sampleLabel) return;

  var samples;
  if (apiType.indexOf("소상공인") !== -1 || apiType.indexOf("상가정보") !== -1) {
    samples = SAMPLES_SMALL_BIZ;
  } else {
    samples = SAMPLES_FRANCHISE;
  }

  for (var i = 0; i < samples.length; i++) {
    if (samples[i].label === sampleLabel) {
      sheet.getRange("B3").setValue(samples[i].region);
      sheet.getRange("B4").setValue(samples[i].keyword);
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "'" + sampleLabel + "' 샘플이 적용되었습니다.\n[🔍 데이터 조회 실행]을 클릭해주세요!",
        "샘플 적용",
      );
      return;
    }
  }
}

// ─── 2. 검색 실행 (B2셀 조건에 따라 분기) ───────────────────────────
function executeSearch() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var searchSheet = ss.getSheetByName("검색입력");

  if (!searchSheet) {
    SpreadsheetApp.getUi().alert(
      '"검색입력" 시트가 없습니다.\n메뉴에서 [공공데이터 연동] → [📋 검색입력 시트 초기화]를 먼저 실행해주세요.',
    );
    return;
  }

  var apiType = String(searchSheet.getRange("B2").getValue()).trim();
  var region = String(searchSheet.getRange("B3").getValue()).trim();
  var keyword = String(searchSheet.getRange("B4").getValue()).trim();

  if (!API_KEY || API_KEY === "여기에_인코딩키_입력") {
    SpreadsheetApp.getUi().alert(
      "API 키가 설정되지 않았습니다. Apps Script 코드에서 API_KEY 변수를 설정해주세요.",
    );
    return;
  }

  if (!apiType) {
    SpreadsheetApp.getUi().alert('B2 셀에서 API 종류를 선택해주세요.');
    return;
  }

  ss.toast("데이터를 조회 중입니다. 잠시만 기다려주세요...", "🔄 조회 중");

  try {
    if (apiType.indexOf("소상공인") !== -1 || apiType.indexOf("상가정보") !== -1) {
      fetchSmallBusinessData(region, keyword);
    } else if (apiType.indexOf("가맹본부") !== -1 || apiType.indexOf("프랜차이즈") !== -1) {
      var year = String(searchSheet.getRange("B6").getValue()).trim();
      fetchFranchiseData(region, keyword, year);
    } else {
      SpreadsheetApp.getUi().alert(
        'B2 셀에 올바른 API 종류를 선택해주세요.\n\n' +
          '지원되는 값:\n  • 소상공인 상가정보\n  • 가맹본부 현황',
      );
    }
  } catch (error) {
    Logger.log("API 오류: " + error.message + "\n" + error.stack);
    SpreadsheetApp.getUi().alert("조회 중 오류가 발생했습니다:\n\n" + error.message);
  }
}

// ─── 3. 소상공인시장진흥공단_상가(상권)정보 API 연동 ────────────────
function fetchSmallBusinessData(region, keyword) {
  if (!region) {
    SpreadsheetApp.getUi().alert(
      "B3 셀에 시군구 코드를 입력해주세요.\n예: 44200 (아산시), 11680 (강남구)\n\n" +
        "💡 B5에서 샘플을 선택하면 자동으로 입력됩니다!",
    );
    return;
  }

  if (!/^\d+$/.test(region)) {
    SpreadsheetApp.getUi().alert(
      "상가정보 API는 B3에 숫자 시군구 코드를 입력해야 합니다.\n" +
        "예: 44200 (아산시), 11680 (강남구)\n\n" +
        "💡 검색입력 시트 하단에 주요 코드 목록이 있습니다.",
    );
    return;
  }

  // ServiceKey에 인코딩 키를 그대로 전달 (이미 URL 인코딩된 상태)
  var url =
    "http://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong" +
    "?divId=signguCd" +
    "&key=" + region +
    "&ServiceKey=" + API_KEY +
    "&pageNo=1" +
    "&numOfRows=1000" +
    "&type=json";

  var response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  var statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(
      "HTTP 요청 실패 (상태코드: " + statusCode + ")\n" +
        "응답: " + response.getContentText().substring(0, 300),
    );
  }

  var json;
  try {
    json = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(
      "응답을 JSON으로 파싱할 수 없습니다.\n응답 내용: " +
        response.getContentText().substring(0, 300),
    );
  }

  if (!json.header) {
    throw new Error("알 수 없는 API 응답 형식: " + JSON.stringify(json).substring(0, 300));
  }

  if (json.header.resultCode !== "00") {
    SpreadsheetApp.getUi().alert(
      "API 호출 실패 (" + json.header.resultCode + "): " + json.header.resultMsg +
        "\n\n💡 B3에 입력한 시군구 코드를 확인해주세요.",
    );
    return;
  }

  if (!json.body || !json.body.items || json.body.items.length === 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast("조건에 맞는 데이터가 없습니다.", "조회 결과");
    return;
  }

  var items = json.body.items;

  // 키워드 필터링
  if (keyword) {
    items = items.filter(function (item) {
      var target =
        (item.bizesNm || "") + " " + (item.brchNm || "") + " " +
        (item.indsLclsNm || "") + " " + (item.indsSclsNm || "");
      return target.indexOf(keyword) !== -1;
    });

    if (items.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        '"' + keyword + '" 키워드와 일치하는 데이터가 없습니다.', "조회 결과",
      );
      return;
    }
  }

  var headers = [
    "상호명", "지점명", "전화번호",
    "상권업종대분류명", "상권업종소분류명", "표준산업분류명",
    "시도명", "시군구명", "법정동명",
    "도로명주소", "지번주소",
  ];
  var records = items.map(function (item) {
    return [
      item.bizesNm || "", item.brchNm || "", item.telNo || "",
      item.indsLclsNm || "", item.indsSclsNm || "", item.ksicNm || "",
      item.ctprvnNm || "", item.signguNm || "", item.ldongNm || "",
      item.rdnmAdr || "", item.lnoAdr || "",
    ];
  });

  writeToResultSheet("소상공인_조회결과", headers, records);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "소상공인 데이터 " + records.length + "건 조회 완료!", "✅ 성공",
  );
}

// ─── 4. 공정거래위원회_페어데이터_시도별 가맹본부현황 API 연동 ──────
//    API ID: 15143521
//    엔드포인트: /1130000/FftcCtpvJnghdqrtrsStusService/getFftcCtpvJnghdqrtrsStus
//    필수: serviceKey, pageNo, numOfRows, resultType, jngBizCrtraYr
//    선택: ctpvNm (시도명)
function fetchFranchiseData(region, keyword, year) {
  // 기준년도 필수 체크
  if (!year || !/^\d{4}$/.test(year)) {
    year = String(new Date().getFullYear() - 1); // 기본 전년도
  }

  // 올바른 엔드포인트: getFftcCtpvJnghdqrtrsStus
  var url =
    "https://apis.data.go.kr/1130000/FftcCtpvJnghdqrtrsStusService/getFftcCtpvJnghdqrtrsStus" +
    "?serviceKey=" + API_KEY +
    "&pageNo=1" +
    "&numOfRows=1000" +
    "&resultType=json" +
    "&jngBizCrtraYr=" + year;

  // 시도명 파라미터 추가 (서버 측 필터)
  if (region) {
    url += "&ctpvNm=" + encodeURIComponent(region);
  }

  Logger.log("가맹본부 API 요청 URL: " + url);

  var response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  var statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(
      "HTTP 요청 실패 (상태코드: " + statusCode + ")\n" +
        "응답: " + response.getContentText().substring(0, 300),
    );
  }

  var json;
  try {
    json = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(
      "응답을 JSON으로 파싱할 수 없습니다.\n" +
        "(API 인증키 또는 호출 제한량을 확인해주세요.)\n" +
        "응답 내용: " + response.getContentText().substring(0, 300),
    );
  }

  // 응답 구조 (플랫): { resultCode: "00", resultMsg: "NORMAL SERVICE", totalCount: N, items: [...] }
  // 또는 래핑: { response: { header: {...}, body: { items: {...} } } }
  // 두 구조 모두 처리

  var resultCode, resultMsg, items;

  if (json.resultCode !== undefined) {
    // 플랫 구조 (실제 응답 형태)
    resultCode = json.resultCode;
    resultMsg = json.resultMsg || "";
    items = json.items;
  } else if (json.response && json.response.header) {
    // 래핑 구조
    resultCode = json.response.header.resultCode;
    resultMsg = json.response.header.resultMsg || "";
    items = json.response.body ? json.response.body.items : null;
    if (items && items.item) {
      items = items.item;
    }
  } else {
    throw new Error("알 수 없는 API 응답 형식: " + JSON.stringify(json).substring(0, 300));
  }

  if (resultCode !== "00") {
    SpreadsheetApp.getUi().alert(
      "가맹본부 API 호출 실패 (" + resultCode + "): " + resultMsg +
        "\n\n💡 기준년도(B6)를 확인해주세요. 2017년 이후 데이터만 조회 가능합니다.",
    );
    return;
  }

  if (!items || (Array.isArray(items) && items.length === 0)) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      year + "년 조건에 맞는 데이터가 없습니다.", "조회 결과",
    );
    return;
  }

  if (!Array.isArray(items)) {
    items = [items];
  }

  Logger.log("가맹본부 API 총 " + items.length + "건 수신 (totalCount: " + (json.totalCount || "?") + ")");

  // 검색어 필터링 (회사명)
  if (keyword) {
    items = items.filter(function (item) {
      var targetStr = (item.coNm || "") + " " + (item.bzentyNm || "");
      return targetStr.indexOf(keyword) !== -1;
    });
  }

  if (items.length === 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "검색 조건에 맞는 데이터가 없습니다.", "조회 결과",
    );
    return;
  }

  var headers = [
    "기준년도", "시도명", "회사명", "대표자명",
    "전화번호", "사업자등록번호", "법인등록번호",
    "개인법인구분", "소재지주소",
  ];
  var records = items.map(function (item) {
    return [
      item.jngBizCrtraYr || year,
      item.ctpvNm || "",
      item.coNm || item.bzentyNm || "",
      item.rprsvNm || "",
      item.telno || "",
      item.brno || item.bizrno || "",
      item.crno || item.jurirno || "",
      item.indvdlCorpSeNm || item.indvdlCrprtDvsNm || "",
      item.lctnAddr || "",
    ];
  });

  writeToResultSheet("가맹본부_조회결과", headers, records);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "가맹본부 " + year + "년 데이터 " + records.length + "건 조회 완료!", "✅ 성공",
  );
}

// ─── 5. 시트에 데이터 기록 ──────────────────────────────────────────
function writeToResultSheet(sheetName, headers, dataArray) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var resultSheet = ss.getSheetByName(sheetName);

  if (!resultSheet) {
    resultSheet = ss.insertSheet(sheetName);
  } else {
    resultSheet.clearContents();
  }

  // 헤더
  resultSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  resultSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#4285F4")
    .setFontColor("#FFFFFF");

  // 데이터
  if (dataArray && dataArray.length > 0) {
    resultSheet
      .getRange(2, 1, dataArray.length, dataArray[0].length)
      .setValues(dataArray);

    // 짝수행 배경색
    for (var i = 0; i < dataArray.length; i++) {
      if (i % 2 === 1) {
        resultSheet
          .getRange(i + 2, 1, 1, dataArray[0].length)
          .setBackground("#f8f9fa");
      }
    }
  }

  // 열 너비 자동 조정
  resultSheet.autoResizeColumns(1, headers.length);

  // 조회 정보
  var infoRow = (dataArray ? dataArray.length : 0) + 3;
  resultSheet.getRange(infoRow, 1).setValue(
    "조회 시각: " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss") +
      " | 총 " + (dataArray ? dataArray.length : 0) + "건",
  );
  resultSheet.getRange(infoRow, 1).setFontColor("#9e9e9e").setFontSize(9);

  ss.setActiveSheet(resultSheet);
}
