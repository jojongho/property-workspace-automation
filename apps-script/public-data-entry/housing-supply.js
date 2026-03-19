/**
 * 공공데이터 매물 자동입력 - 분양정보 API (2종, 아파트 전용).
 *
 * 1) 분양상세 (getAPTLttotPblancDetail) - 단지 정보 + 일정
 * 2) 주택형 (getAPTLttotPblancMdl) - 타입별 면적, 세대수, 분양가
 */

var PDE_SUPPLY_DETAIL_FIELDS = Object.freeze([
  'HOUSE_MANAGE_NO', 'PBLANC_NO', 'HOUSE_NM', 'HOUSE_SECD', 'HOUSE_SECD_NM',
  'HOUSE_DTL_SECD', 'HOUSE_DTL_SECD_NM', 'RENT_SECD', 'RENT_SECD_NM',
  'SUBSCRPT_AREA_CODE', 'SUBSCRPT_AREA_CODE_NM',
  'HSSPLY_ZIP', 'HSSPLY_ADRES', 'TOT_SUPLY_HSHLDCO',
  'RCRIT_PBLANC_DE', 'NSPRC_NM',
  'RCEPT_BGNDE', 'RCEPT_ENDDE',
  'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE',
  'GNRL_RNK1_CRSPAREA_RCPTDE', 'GNRL_RNK1_CRSPAREA_ENDDE',
  'GNRL_RNK1_ETC_GG_RCPTDE', 'GNRL_RNK1_ETC_GG_ENDDE',
  'GNRL_RNK1_ETC_AREA_RCPTDE', 'GNRL_RNK1_ETC_AREA_ENDDE',
  'GNRL_RNK2_CRSPAREA_RCPTDE', 'GNRL_RNK2_CRSPAREA_ENDDE',
  'GNRL_RNK2_ETC_GG_RCPTDE', 'GNRL_RNK2_ETC_GG_ENDDE',
  'GNRL_RNK2_ETC_AREA_RCPTDE', 'GNRL_RNK2_ETC_AREA_ENDDE',
  'PRZWNER_PRESNATN_DE', 'CNTRCT_CNCLS_BGNDE', 'CNTRCT_CNCLS_ENDDE',
  'HMPG_ADRES', 'CNSTRCT_ENTRPS_NM', 'MDHS_TELNO', 'BSNS_MBY_NM',
  'MVN_PREARNGE_YM',
  'SPECLT_RDN_EARTH_AT', 'MDAT_TRGET_AREA_SECD', 'PARCPRC_ULS_AT',
  'IMPRMN_BSNS_AT', 'PUBLIC_HOUSE_EARTH_AT', 'LRSCL_BLDLND_AT',
  'NPLN_PRVOPR_PUBLIC_HOUSE_AT', 'PUBLIC_HOUSE_SPCLW_APPLC_AT',
  'PBLANC_URL'
]);

var PDE_SUPPLY_MODEL_FIELDS = Object.freeze([
  'HOUSE_MANAGE_NO', 'PBLANC_NO', 'MODEL_NO',
  'HOUSE_TY', 'SUPLY_AR', 'SUPLY_HSHLDCO', 'SPSPLY_HSHLDCO',
  'MNYCH_HSHLDCO', 'NWWDS_HSHLDCO', 'LFE_FRST_HSHLDCO',
  'OLD_PARNTS_SUPORT_HSHLDCO', 'INSTT_RECOMEND_HSHLDCO',
  'ETC_HSHLDCO', 'TRANSR_INSTT_ENFSN_HSHLDCO',
  'YGMN_HSHLDCO', 'NWBB_HSHLDCO',
  'LTTOT_TOP_AMOUNT'
]);

var PDE_SUPPLY_DETAIL_LABELS = Object.freeze({
  HOUSE_MANAGE_NO: '주택관리번호', PBLANC_NO: '공고번호',
  HOUSE_NM: '주택명', HOUSE_SECD: '주택구분코드', HOUSE_SECD_NM: '주택구분명',
  HOUSE_DTL_SECD: '주택상세구분코드', HOUSE_DTL_SECD_NM: '주택상세구분명',
  RENT_SECD: '분양구분코드', RENT_SECD_NM: '분양구분명',
  SUBSCRPT_AREA_CODE: '공급지역코드', SUBSCRPT_AREA_CODE_NM: '공급지역명',
  HSSPLY_ZIP: '공급위치우편번호', HSSPLY_ADRES: '공급위치',
  TOT_SUPLY_HSHLDCO: '공급규모',
  RCRIT_PBLANC_DE: '모집공고일', NSPRC_NM: '신문사',
  RCEPT_BGNDE: '청약접수시작일', RCEPT_ENDDE: '청약접수종료일',
  SPSPLY_RCEPT_BGNDE: '특별공급접수시작일', SPSPLY_RCEPT_ENDDE: '특별공급접수종료일',
  GNRL_RNK1_CRSPAREA_RCPTDE: '1순위해당지역접수시작일',
  GNRL_RNK1_CRSPAREA_ENDDE: '1순위해당지역접수종료일',
  GNRL_RNK1_ETC_GG_RCPTDE: '1순위경기지역접수시작일',
  GNRL_RNK1_ETC_GG_ENDDE: '1순위경기지역접수종료일',
  GNRL_RNK1_ETC_AREA_RCPTDE: '1순위기타지역접수시작일',
  GNRL_RNK1_ETC_AREA_ENDDE: '1순위기타지역접수종료일',
  GNRL_RNK2_CRSPAREA_RCPTDE: '2순위해당지역접수시작일',
  GNRL_RNK2_CRSPAREA_ENDDE: '2순위해당지역접수종료일',
  GNRL_RNK2_ETC_GG_RCPTDE: '2순위경기지역접수시작일',
  GNRL_RNK2_ETC_GG_ENDDE: '2순위경기지역접수종료일',
  GNRL_RNK2_ETC_AREA_RCPTDE: '2순위기타지역접수시작일',
  GNRL_RNK2_ETC_AREA_ENDDE: '2순위기타지역접수종료일',
  PRZWNER_PRESNATN_DE: '당첨자발표일',
  CNTRCT_CNCLS_BGNDE: '계약시작일', CNTRCT_CNCLS_ENDDE: '계약종료일',
  HMPG_ADRES: '홈페이지주소', CNSTRCT_ENTRPS_NM: '시공사명',
  MDHS_TELNO: '문의전화', BSNS_MBY_NM: '사업주체명',
  MVN_PREARNGE_YM: '입주예정월',
  SPECLT_RDN_EARTH_AT: '투기과열지구여부', MDAT_TRGET_AREA_SECD: '조정대상지역여부',
  PARCPRC_ULS_AT: '분양가상한제여부', IMPRMN_BSNS_AT: '정비사업여부',
  PUBLIC_HOUSE_EARTH_AT: '공공주택지구여부', LRSCL_BLDLND_AT: '대규모택지개발지구여부',
  NPLN_PRVOPR_PUBLIC_HOUSE_AT: '수도권민영공공주택지구여부',
  PUBLIC_HOUSE_SPCLW_APPLC_AT: '공공주택특별법적용여부',
  PBLANC_URL: '분양공고URL'
});

var PDE_SUPPLY_MODEL_LABELS = Object.freeze({
  HOUSE_MANAGE_NO: '주택관리번호', PBLANC_NO: '공고번호', MODEL_NO: '모델번호',
  HOUSE_TY: '주택형', SUPLY_AR: '공급면적',
  SUPLY_HSHLDCO: '일반공급세대수', SPSPLY_HSHLDCO: '특별공급세대수',
  MNYCH_HSHLDCO: '다자녀세대수', NWWDS_HSHLDCO: '신혼부부세대수',
  LFE_FRST_HSHLDCO: '생애최초세대수', OLD_PARNTS_SUPORT_HSHLDCO: '노부모부양세대수',
  INSTT_RECOMEND_HSHLDCO: '기관추천세대수', ETC_HSHLDCO: '기타세대수',
  TRANSR_INSTT_ENFSN_HSHLDCO: '이전기관세대수',
  YGMN_HSHLDCO: '청년세대수', NWBB_HSHLDCO: '신생아세대수',
  LTTOT_TOP_AMOUNT: '분양최고금액'
});

var PDE_SUPPLY_DETAIL_HEADERS = Object.freeze(
  PDE_SUPPLY_DETAIL_FIELDS.map(function(f) { return PDE_SUPPLY_DETAIL_LABELS[f] || f; })
);

var PDE_SUPPLY_MODEL_HEADERS = Object.freeze(
  PDE_SUPPLY_MODEL_FIELDS.map(function(f) { return PDE_SUPPLY_MODEL_LABELS[f] || f; })
);

/**
 * 분양정보 검색 조건 생성.
 */
function pde_buildSupplySearchCond_(formValues) {
  var cond = {};

  if (formValues.houseName) {
    cond['cond[HOUSE_NM::LIKE]'] = formValues.houseName;
  }
  if (formValues.supplyStartDate) {
    cond['cond[RCRIT_PBLANC_DE::GTE]'] = formValues.supplyStartDate;
  }
  if (formValues.supplyEndDate) {
    cond['cond[RCRIT_PBLANC_DE::LTE]'] = formValues.supplyEndDate;
  }
  return cond;
}

/**
 * 분양정보 2종 조회 실행 (아파트 전용).
 * @param {Object} formValues { houseName, supplyStartDate, supplyEndDate }
 * @return {{ detail: Object[], model: Object[] }}
 */
function pde_fetchHousingSupply_(formValues) {
  var serviceKey = pde_getConfig_(PDE.CONFIG_KEYS.DATA_GO_KR, true);
  var cond = pde_buildSupplySearchCond_(formValues);

  // 1) 분양상세
  var detailResp = pde_fetchApplyhomePaged_(serviceKey, 'getAPTLttotPblancDetail', cond, 200, 30);
  var detailRows = detailResp.data || [];

  // 2) 주택형 (분양상세 결과에서 주택관리번호/공고번호로 조회)
  var modelRows = [];
  if (detailRows.length) {
    var visited = {};
    detailRows.forEach(function(item) {
      var hmNo = pde_trim_(item.HOUSE_MANAGE_NO);
      var pbNo = pde_trim_(item.PBLANC_NO);
      var uniq = hmNo + '|' + pbNo;
      if (!hmNo || !pbNo || visited[uniq]) return;
      visited[uniq] = true;

      var mdlResp = pde_fetchApplyhomePaged_(serviceKey, 'getAPTLttotPblancMdl', {
        'cond[HOUSE_MANAGE_NO::EQ]': hmNo,
        'cond[PBLANC_NO::EQ]': pbNo
      }, 200, 5);

      modelRows = modelRows.concat(mdlResp.data || []);
    });
  }

  return { detail: detailRows, model: modelRows };
}

/**
 * 분양정보 조회 결과를 임시 시트에 저장.
 */
function pde_saveSupplyResultToSheet_(result) {
  var detailSheet = pde_getOrCreateSheet_(
    PDE.SHEETS.SUPPLY_RESULT + '_상세', PDE_SUPPLY_DETAIL_HEADERS, { trimExtraColumns: true }
  );
  var modelSheet = pde_getOrCreateSheet_(
    PDE.SHEETS.SUPPLY_RESULT + '_주택형', PDE_SUPPLY_MODEL_HEADERS, { trimExtraColumns: true }
  );

  pde_clearSheetBody_(detailSheet, PDE_SUPPLY_DETAIL_HEADERS.length);
  pde_clearSheetBody_(modelSheet, PDE_SUPPLY_MODEL_HEADERS.length);

  if (result.detail.length) {
    var detailData = result.detail.map(function(item) {
      return pde_rawFieldValues_(item, PDE_SUPPLY_DETAIL_FIELDS);
    });
    pde_appendRows_(detailSheet, detailData);
  }

  if (result.model.length) {
    var modelData = result.model.map(function(item) {
      return pde_rawFieldValues_(item, PDE_SUPPLY_MODEL_FIELDS);
    });
    pde_appendRows_(modelSheet, modelData);
  }

  detailSheet.hideSheet();
  modelSheet.hideSheet();

  return {
    detailCount: result.detail.length,
    modelCount: result.model.length
  };
}
