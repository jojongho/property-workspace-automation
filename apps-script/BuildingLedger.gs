/**
 * 건축물대장 자동 조회 스크립트 (Vworld Geocoder API 버전 - Encoding Key 적용)
 * 
 * 사용법:
 * 1. 이 코드를 복사하여 Google Spreadsheet > 확장 프로그램 > Apps Script에 붙여넣으세요.
 * 2. 이미 Encoding API 키가 입력되어 있으므로 별도 설정이 필요 없습니다.
 * 3. 스프레드시트 새로고침 후 '건축물대장 > 조회 실행' 메뉴를 클릭하세요.
 */

// ====== API 설정 (본인의 키로 교체하세요) ======
const VWORLD_API_KEY = "92B968B8-DB3B-3A0F-B48D-B0238114DF23"; // Vworld API 키
const DATA_GO_KR_KEY = "Z%2BMfKoMleRlwPEc4ukEphU%2FqxcRhdzSYOf%2F%2FJaI09%2F6NoUm5NBR9bd5Yuo9nS5Pzh4%2FS42ZMOSRGx8t8EIfN8A%3D%3D"; // 공공데이터포털 인코딩된 서비스 키 (일반 인증키 Encoding)
// ===========================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('건축물대장')
    .addItem('조회 실행', 'fetchBuildingLedger')
    .addToUi();
}

function fetchBuildingLedger() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // 컬럼 인덱스 찾기
  const colMap = {};
  headers.forEach((header, index) => {
    colMap[header] = index;
  });

  // 필수 헤더 체크
  if (colMap['주소'] === undefined) {
    SpreadsheetApp.getUi().alert("'주소' 컬럼이 없습니다.");
    return;
  }

  // 1행부터 데이터 순회
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const address = row[colMap['주소']];
    const status = colMap['대지면적'] !== undefined ? row[colMap['대지면적']] : '';

    // 주소가 있고, 대지면적이 비어있을 때만 실행
    if (address && !status) {
      try {
        processRow(sheet, i + 1, address, colMap);
        Utilities.sleep(500); // API 과부하 방지
      } catch (e) {
        console.error(`Row ${i + 1} Error: ${e.toString()}`);
        if (colMap['구조코드명'] !== undefined) {
           sheet.getRange(i + 1, colMap['구조코드명'] + 1).setValue("에러: " + e.message);
        }
      }
    }
  }
  
  SpreadsheetApp.getUi().alert("조회 완료!");
}

function processRow(sheet, rowIndex, address, colMap) {
  // 1. Vworld Geocoder API (주소 -> 좌표/PNU)
  const vworldUrl = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${encodeURIComponent(address)}&refine=true&simple=false&format=json&type=parcel&key=${VWORLD_API_KEY}`;
  
  const vworldRes = UrlFetchApp.fetch(vworldUrl, { muteHttpExceptions: true });
  const vworldJson = JSON.parse(vworldRes.getContentText());

  if (vworldJson.response.status !== 'OK') {
    throw new Error(`주소 검색 실패 (${vworldJson.response.status})`);
  }

  const result = vworldJson.response.result;
  const refined = vworldJson.response.refined;

  // PNU 추출 로직 개선 (refined 구조 우선 확인)
  let pnu = '';
  
  if (refined && refined.structure && refined.structure.level4LC) {
      // 1. Refined 구조에 19자리 코드가 있는 경우 (가장 정확)
      pnu = refined.structure.level4LC;
  } else if (result && result.structure) {
      // 2. Result 구조 사용 (기존 방식)
      const s = result.structure;
      // level0이 숫자인지 확인하여 코드 조합
      if (s.level0 && !isNaN(parseInt(s.level0))) {
        pnu = `${s.level0}${s.level1}${s.level2}${s.level4A}${s.level4L}${s.detail}`;
      }
  }

  if (!pnu || pnu.length < 19) {
     const inputAddress = vworldJson.response.input ? vworldJson.response.input.address : "알수없음";
     throw new Error(`주소의 PNU(고유번호)를 찾을 수 없습니다. (입력: ${inputAddress})\n팁: 지번 주소를 정확하게 입력해 보세요.`);
  }

  // PNU 파싱 (19자리: 시군구(5) + 법정동(5) + 산(1) + 번(4) + 지(4))
  const sigunguCd = pnu.substring(0, 5);
  const bjdongCd = pnu.substring(5, 10);
  const sanFlag = pnu.substring(10, 11); // 1:일반, 2:산
  const bun = pnu.substring(11, 15);
  const ji = pnu.substring(15, 19);
  
  // 산/대지 구분 (API 파라미터: 0:대지, 1:산, 2:블록)
  // PNU: 1 -> API: 0, PNU: 2 -> API: 1
  const platCode = (sanFlag === '2') ? '1' : '0';

  const roadAddr = (refined && refined.text) ? refined.text : ((result && result.text) ? result.text : address);

  // 2. 건축물대장 표제부 조회 (건축HUB API)
  // **중요**: Architecture HUB API는 파라미터 이름이 다릅니다 (sigunguCd -> sigungu_code)
  const ledgerUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${DATA_GO_KR_KEY}&sigungu_code=${sigunguCd}&bdong_code=${bjdongCd}&plat_code=${platCode}&bun=${bun}&ji=${ji}&numOfRows=1&pageNo=1&_type=json`;
  
  // console.log("Calling Ledger URL: " + ledgerUrl); // 디버깅용

  const ledgerRes = UrlFetchApp.fetch(ledgerUrl, { muteHttpExceptions: true });
  const ledgerText = ledgerRes.getContentText();
  let ledgerJson;
  
  try {
    ledgerJson = JSON.parse(ledgerText);
  } catch (e) {
    // JSON 파싱 실패 시, 응답 내용을 그대로 에러 메시지로 던져서 확인
    // <, > 문자가 있으면 태그로 오인될 수 있으므로 대괄호로 변경
    const safeText = ledgerText.replace(/</g, '[').replace(/>/g, ']');
    throw new Error(`응답이 JSON이 아닙니다: ${safeText}`);
  }
  
  // 응답 데이터 구조 확인 (body가 비어있으면 데이터 없음)
  if (!ledgerJson.response || !ledgerJson.response.body || JSON.stringify(ledgerJson.response.body) === '{}') {
     throw new Error("건축물대장 정보가 없습니다 (검색 결과 0건)");
  }

  const items = ledgerJson.response.body.items;
  if (!items || !items.item) {
     throw new Error("건축물대장 정보가 없습니다 (Items 없음)");
  }

  const item = Array.isArray(items.item) ? items.item[0] : items.item;
  
  if (!item) {
     throw new Error("건축물대장 항목을 찾을 수 없습니다");
  }

  // 3. 시트 업데이트
  const updates = [
    { key: '도로명주소', val: roadAddr },
    { key: '대지면적', val: parseFloat(item.platArea) || 0 },
    { key: '건축면적', val: parseFloat(item.archArea) || 0 },
    { key: '건폐율', val: parseFloat(item.bcRat) || 0 },
    { key: '연면적', val: parseFloat(item.totArea) || 0 },
    { key: '용적률', val: parseFloat(item.vlRat) || 0 },
    { key: '구조코드명', val: item.strctCdNm },
    { key: '기타구조', val: item.etcStrct },
    { key: '사용승인일', val: item.useAprDay },
    { key: '용적률산정연면적', val: parseFloat(item.vlRatEstmTotArea) || 0 },
    { key: '내진설계여부', val: item.rgnlLmtSe }, 
    { key: '내진능력', val: item.rgnlLmtSe } 
  ];

  updates.forEach(u => {
    if (colMap[u.key] !== undefined) {
      sheet.getRange(rowIndex, colMap[u.key] + 1).setValue(u.val);
    }
  });
  
  // 일반건물여부
  if (colMap['일반건물여부'] !== undefined) {
    sheet.getRange(rowIndex, colMap['일반건물여부'] + 1).setValue(item.mainPurpsCdNm ? '일반건물' : '기타');
  }
}
