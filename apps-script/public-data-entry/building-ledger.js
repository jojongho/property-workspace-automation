/**
 * 공공데이터 매물 자동입력 - 건축물대장 API (3종).
 *
 * 1) 총괄표제부 (getBrTitleInfo) - 건물 전체 정보
 * 2) 동별표제부 (getBrRecapTitleInfo) - 동별 정보 (아파트 전용)
 * 3) 전유부 (getBrExposPubuseAreaInfo) - 호별 전유면적/용도
 */

var PDE_BLD_ENDPOINTS = Object.freeze({
  TITLE: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
  RECAP: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo',
  EXPOS: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo'
});

var PDE_BLD_TITLE_FIELDS = Object.freeze([
  'rnum', 'platPlc', 'sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji',
  'mgmBldrgstPk', 'regstrGbCd', 'regstrGbCdNm', 'regstrKindCd', 'regstrKindCdNm',
  'newPlatPlc', 'bldNm', 'splotNm', 'block', 'lot', 'bylotCnt',
  'naRoadCd', 'naBjdongCd', 'naUgrndCd', 'naMainBun', 'naSubBun',
  'dongNm', 'mainAtchGbCd', 'mainAtchGbCdNm',
  'platArea', 'archArea', 'bcRat', 'totArea', 'vlRatEstmTotArea', 'vlRat',
  'strctCd', 'strctCdNm', 'etcStrct', 'mainPurpsCd', 'mainPurpsCdNm', 'etcPurps',
  'roofCd', 'roofCdNm', 'etcRoof',
  'hhldCnt', 'fmlyCnt', 'heit', 'grndFlrCnt', 'ugrndFlrCnt',
  'rideUseElvtCnt', 'emgenUseElvtCnt',
  'atchBldCnt', 'atchBldArea', 'totDongTotArea',
  'indrMechUtcnt', 'indrMechArea', 'oudrMechUtcnt', 'oudrMechArea',
  'indrAutoUtcnt', 'indrAutoArea', 'oudrAutoUtcnt', 'oudrAutoArea',
  'pmsDay', 'stcnsDay', 'useAprDay',
  'pmsnoYear', 'pmsnoKikCd', 'pmsnoKikCdNm', 'pmsnoGbCd', 'pmsnoGbCdNm',
  'hoCnt', 'engrGrade', 'engrRat', 'engrEpi',
  'gnBldGrade', 'gnBldCert', 'itgBldGrade', 'itgBldCert',
  'crtnDay', 'rserthqkDsgnApplyYn', 'rserthqkAblty'
]);

var PDE_BLD_RECAP_FIELDS = Object.freeze([
  'rnum', 'platPlc', 'sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji',
  'mgmBldrgstPk', 'regstrGbCd', 'regstrGbCdNm', 'regstrKindCd', 'regstrKindCdNm',
  'newPlatPlc', 'bldNm', 'splotNm', 'block', 'lot',
  'naRoadCd', 'naBjdongCd', 'naUgrndCd', 'naMainBun', 'naSubBun',
  'dongNm', 'mainAtchGbCd', 'mainAtchGbCdNm',
  'platArea', 'archArea', 'bcRat', 'totArea', 'vlRatEstmTotArea', 'vlRat',
  'strctCd', 'strctCdNm', 'etcStrct', 'mainPurpsCd', 'mainPurpsCdNm', 'etcPurps',
  'hhldCnt', 'fmlyCnt', 'heit', 'grndFlrCnt', 'ugrndFlrCnt',
  'rideUseElvtCnt', 'emgenUseElvtCnt',
  'atchBldCnt', 'atchBldArea',
  'pmsDay', 'stcnsDay', 'useAprDay', 'crtnDay'
]);

var PDE_BLD_EXPOS_FIELDS = Object.freeze([
  'rnum', 'platPlc', 'sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji',
  'mgmBldrgstPk', 'regstrGbCd', 'regstrGbCdNm', 'regstrKindCd', 'regstrKindCdNm',
  'newPlatPlc', 'bldNm', 'splotNm', 'block', 'lot',
  'naRoadCd', 'naBjdongCd', 'naUgrndCd', 'naMainBun', 'naSubBun',
  'dongNm', 'hoNm', 'flrNo', 'flrNoNm',
  'mainAtchGbCd', 'mainAtchGbCdNm',
  'area', 'etcPurps', 'mainPurpsCd', 'mainPurpsCdNm',
  'exposPubuseGbCd', 'exposPubuseGbCdNm',
  'crtnDay'
]);

var PDE_BLD_TITLE_HEADERS = Object.freeze(
  PDE_BLD_TITLE_FIELDS.map(function(f) { return PDE_BLD_FIELD_LABELS[f] || f; })
);

var PDE_BLD_RECAP_HEADERS = Object.freeze(
  PDE_BLD_RECAP_FIELDS.map(function(f) { return PDE_BLD_FIELD_LABELS[f] || f; })
);

var PDE_BLD_EXPOS_HEADERS = Object.freeze(
  PDE_BLD_EXPOS_FIELDS.map(function(f) { return PDE_BLD_FIELD_LABELS[f] || f; })
);

var PDE_BLD_FIELD_LABELS = Object.freeze({
  rnum: '순번', platPlc: '대지위치', sigunguCd: '시군구코드', bjdongCd: '법정동코드',
  platGbCd: '대지구분코드', bun: '번', ji: '지', mgmBldrgstPk: '관리건축물대장PK',
  regstrGbCd: '대장구분코드', regstrGbCdNm: '대장구분명',
  regstrKindCd: '대장종류코드', regstrKindCdNm: '대장종류명',
  newPlatPlc: '도로명대지위치', bldNm: '건물명', splotNm: '특수지명',
  block: '블록', lot: '로트', bylotCnt: '외필지수',
  naRoadCd: '새주소도로코드', naBjdongCd: '새주소법정동코드',
  naUgrndCd: '새주소지상지하코드', naMainBun: '새주소본번', naSubBun: '새주소부번',
  dongNm: '동명칭', mainAtchGbCd: '주부속구분코드', mainAtchGbCdNm: '주부속구분명',
  platArea: '대지면적', archArea: '건축면적', bcRat: '건폐율',
  totArea: '연면적', vlRatEstmTotArea: '용적률산정연면적', vlRat: '용적률',
  strctCd: '구조코드', strctCdNm: '구조명', etcStrct: '기타구조',
  mainPurpsCd: '주용도코드', mainPurpsCdNm: '주용도명', etcPurps: '기타용도',
  roofCd: '지붕코드', roofCdNm: '지붕명', etcRoof: '기타지붕',
  hhldCnt: '세대수', fmlyCnt: '가구수', heit: '높이',
  grndFlrCnt: '지상층수', ugrndFlrCnt: '지하층수',
  rideUseElvtCnt: '승용승강기수', emgenUseElvtCnt: '비상용승강기수',
  atchBldCnt: '부속건축물수', atchBldArea: '부속건축물면적', totDongTotArea: '총동연면적',
  indrMechUtcnt: '옥내기계식대수', indrMechArea: '옥내기계식면적',
  oudrMechUtcnt: '옥외기계식대수', oudrMechArea: '옥외기계식면적',
  indrAutoUtcnt: '옥내자주식대수', indrAutoArea: '옥내자주식면적',
  oudrAutoUtcnt: '옥외자주식대수', oudrAutoArea: '옥외자주식면적',
  pmsDay: '허가일', stcnsDay: '착공일', useAprDay: '사용승인일',
  pmsnoYear: '허가번호년', pmsnoKikCd: '허가번호기관코드', pmsnoKikCdNm: '허가번호기관명',
  pmsnoGbCd: '허가번호구분코드', pmsnoGbCdNm: '허가번호구분명',
  hoCnt: '호수', engrGrade: '에너지효율등급', engrRat: '에너지절감율', engrEpi: 'EPI점수',
  gnBldGrade: '친환경건축물등급', gnBldCert: '친환경건축물인증점수',
  itgBldGrade: '지능형건축물등급', itgBldCert: '지능형건축물인증점수',
  crtnDay: '생성일자', rserthqkDsgnApplyYn: '내진설계적용여부', rserthqkAblty: '내진능력',
  hoNm: '호명칭', flrNo: '층번호', flrNoNm: '층명칭',
  area: '면적', exposPubuseGbCd: '전유공용구분코드', exposPubuseGbCdNm: '전유공용구분명'
});

/**
 * 건축물대장 3종 조회 실행.
 * @param {Object} q  { sigunguCd, bjdongCd, platGbCd, bun, ji }
 * @return {{ title: Object[], recap: Object[], expos: Object[] }}
 */
function pde_fetchBuildingLedger_(q) {
  var serviceKey = pde_getConfig_(PDE.CONFIG_KEYS.DATA_GO_KR, true);
  var baseParams = {
    sigunguCd: q.sigunguCd,
    bjdongCd: q.bjdongCd,
    platGbCd: q.platGbCd,
    bun: q.bun,
    ji: q.ji
  };

  var title = [];
  var recap = [];
  var expos = [];

  // 1) 총괄표제부
  try {
    title = pde_fetchBuildingApi_(serviceKey, PDE_BLD_ENDPOINTS.TITLE, baseParams, 100);
  } catch (err) {
    // 총괄표제부 실패 시에도 동별/전유부 시도
  }

  // 2) 동별표제부 (아파트 전용이지만 일단 조회 시도)
  try {
    recap = pde_fetchBuildingApi_(serviceKey, PDE_BLD_ENDPOINTS.RECAP, baseParams, 200);
  } catch (err) {
    // 동별표제부 없는 건물은 정상
  }

  // 3) 전유부
  try {
    expos = pde_fetchBuildingApi_(serviceKey, PDE_BLD_ENDPOINTS.EXPOS, baseParams, 500);
  } catch (err) {
    // 전유부 없는 건물은 정상
  }

  return { title: title, recap: recap, expos: expos };
}

/**
 * 건축물대장 조회 결과를 임시 시트에 저장.
 */
function pde_saveBuildingResultToSheet_(result) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 조회결과 시트 생성 (3개 탭: _총괄, _동별, _전유부)
  var titleSheet = pde_getOrCreateSheet_(
    PDE.SHEETS.BLD_RESULT + '_총괄', PDE_BLD_TITLE_HEADERS, { trimExtraColumns: true }
  );
  var recapSheet = pde_getOrCreateSheet_(
    PDE.SHEETS.BLD_RESULT + '_동별', PDE_BLD_RECAP_HEADERS, { trimExtraColumns: true }
  );
  var exposSheet = pde_getOrCreateSheet_(
    PDE.SHEETS.BLD_RESULT + '_전유부', PDE_BLD_EXPOS_HEADERS, { trimExtraColumns: true }
  );

  // 기존 데이터 클리어
  pde_clearSheetBody_(titleSheet, PDE_BLD_TITLE_HEADERS.length);
  pde_clearSheetBody_(recapSheet, PDE_BLD_RECAP_HEADERS.length);
  pde_clearSheetBody_(exposSheet, PDE_BLD_EXPOS_HEADERS.length);

  // 데이터 쓰기
  if (result.title.length) {
    var titleRows = result.title.map(function(item) {
      return pde_rawFieldValues_(item, PDE_BLD_TITLE_FIELDS);
    });
    pde_appendRows_(titleSheet, titleRows);
  }

  if (result.recap.length) {
    var recapRows = result.recap.map(function(item) {
      return pde_rawFieldValues_(item, PDE_BLD_RECAP_FIELDS);
    });
    pde_appendRows_(recapSheet, recapRows);
  }

  if (result.expos.length) {
    var exposRows = result.expos.map(function(item) {
      return pde_rawFieldValues_(item, PDE_BLD_EXPOS_FIELDS);
    });
    pde_appendRows_(exposSheet, exposRows);
  }

  // 숨김 처리
  titleSheet.hideSheet();
  recapSheet.hideSheet();
  exposSheet.hideSheet();

  return {
    titleCount: result.title.length,
    recapCount: result.recap.length,
    exposCount: result.expos.length
  };
}
