/**
 * 공공데이터 매물 자동입력 - 필드 매핑 및 upsert.
 *
 * 건축물대장/분양정보 조회결과를 각 매물유형 시트에 매핑하여 반영.
 */

/**
 * 건축물대장 → 아파트단지 시트 매핑.
 */
function pde_mapBuildingToApartmentComplex_(titleItems, recapItems) {
  if (!titleItems.length) return [];

  // 주건축물(mainAtchGbCd === '0') 중 첫 번째를 대표로 사용
  var main = titleItems.filter(function(item) {
    return pde_trim_(item.mainAtchGbCd) === '0';
  });
  var representative = main.length ? main[0] : titleItems[0];

  // 동별표제부에서 동 수, 최고/최저층, 주차대수 집계
  var dongCount = 0;
  var maxFloor = 0;
  var minFloor = 999;
  var totalParking = 0;
  var dongNames = {};

  if (recapItems && recapItems.length) {
    recapItems.forEach(function(item) {
      var dongNm = pde_trim_(item.dongNm);
      if (dongNm && !dongNames[dongNm]) {
        dongNames[dongNm] = true;
        dongCount++;
      }
      var grnd = pde_num_(item.grndFlrCnt);
      if (grnd > maxFloor) maxFloor = grnd;
      if (grnd > 0 && grnd < minFloor) minFloor = grnd;

      totalParking += pde_num_(item.indrAutoUtcnt) + pde_num_(item.oudrAutoUtcnt) +
                      pde_num_(item.indrMechUtcnt) + pde_num_(item.oudrMechUtcnt);
    });
  }

  // 총괄표제부에서도 층수 확인
  if (!recapItems || !recapItems.length) {
    maxFloor = pde_num_(representative.grndFlrCnt);
    minFloor = maxFloor;
    totalParking = pde_num_(representative.indrAutoUtcnt) + pde_num_(representative.oudrAutoUtcnt) +
                   pde_num_(representative.indrMechUtcnt) + pde_num_(representative.oudrMechUtcnt);
  }

  if (minFloor === 999) minFloor = 0;

  return {
    '단지명': pde_trim_(representative.bldNm),
    '대지면적(㎡)': pde_num_(representative.platArea),
    '연면적(㎡)': pde_num_(representative.totArea),
    '용산 연면적(㎡)': pde_num_(representative.vlRatEstmTotArea),
    '건축면적(㎡)': pde_num_(representative.archArea),
    '용적률': pde_num_(representative.vlRat),
    '건폐율': pde_num_(representative.bcRat),
    '총 세대수': pde_num_(representative.hhldCnt),
    '최고층': maxFloor,
    '최저층': minFloor,
    '지하층': pde_num_(representative.ugrndFlrCnt),
    '동수': dongCount || '',
    '주차대수': totalParking || '',
    '사용승인일': pde_trim_(representative.useAprDay),
    '시군구': pde_trim_(representative.sigunguCd),
    '동읍면': '',
    '통반리': '',
    '지번': pde_trim_(representative.bun) + '-' + pde_trim_(representative.ji)
  };
}

/**
 * 건축물대장 → 건물 시트 매핑 (근생).
 */
function pde_mapBuildingToBuildingSheet_(titleItems) {
  if (!titleItems.length) return null;

  var main = titleItems.filter(function(item) {
    return pde_trim_(item.mainAtchGbCd) === '0';
  });
  var rep = main.length ? main[0] : titleItems[0];

  var parking = pde_num_(rep.indrAutoUtcnt) + pde_num_(rep.oudrAutoUtcnt) +
                pde_num_(rep.indrMechUtcnt) + pde_num_(rep.oudrMechUtcnt);

  return {
    '건물명': pde_trim_(rep.bldNm),
    '신주소': pde_trim_(rep.newPlatPlc),
    '주용도': pde_trim_(rep.mainPurpsCdNm),
    '건축구조': pde_trim_(rep.strctCdNm),
    '대지면적(㎡)': pde_num_(rep.platArea),
    '연면적(㎡)': pde_num_(rep.totArea),
    '용산 연면적(㎡)': pde_num_(rep.vlRatEstmTotArea),
    '건축면적(㎡)': pde_num_(rep.archArea),
    '건폐율': pde_num_(rep.bcRat),
    '용적률': pde_num_(rep.vlRat),
    '지상층': pde_num_(rep.grndFlrCnt),
    '지하층': pde_num_(rep.ugrndFlrCnt),
    '세대 · 호수': pde_num_(rep.hhldCnt),
    '주차대수': parking || '',
    '사용승인': pde_trim_(rep.useAprDay),
    '승강기': pde_num_(rep.rideUseElvtCnt) || ''
  };
}

/**
 * 건축물대장 → 주택 시트 매핑.
 */
function pde_mapBuildingToHouseSheet_(titleItems) {
  if (!titleItems.length) return null;
  var rep = titleItems[0];

  return {
    '주구조': pde_trim_(rep.strctCdNm),
    '사용승인': pde_trim_(rep.useAprDay),
    '주택유형': pde_mapPurposeToHouseType_(pde_trim_(rep.mainPurpsCdNm))
  };
}

/**
 * 건축물대장 → 공장창고 시트 매핑.
 */
function pde_mapBuildingToFactorySheet_(titleItems) {
  if (!titleItems.length) return null;
  var rep = titleItems[0];

  return {
    '건축물용도': pde_trim_(rep.mainPurpsCdNm),
    '연면적(㎡)': pde_num_(rep.totArea),
    '사용승인일': pde_trim_(rep.useAprDay)
  };
}

/**
 * 건축물대장 전유부 → 상가 시트 행들.
 */
function pde_mapExposToStoreRows_(exposItems) {
  var exclusive = exposItems.filter(function(item) {
    return pde_trim_(item.exposPubuseGbCd) === '1'; // 전유
  });

  return exclusive.map(function(item) {
    var areaSqm = pde_num_(item.area);
    return {
      '호수': pde_trim_(item.hoNm),
      '전용면적(㎡)': areaSqm,
      '전용면적(평)': Math.round(areaSqm * 0.3025 * 100) / 100
    };
  });
}

/**
 * 건축물대장 전유부 → 원투룸 시트 행들.
 */
function pde_mapExposToRoomRows_(exposItems) {
  var exclusive = exposItems.filter(function(item) {
    return pde_trim_(item.exposPubuseGbCd) === '1';
  });

  return exclusive.map(function(item) {
    return {
      '호': pde_trim_(item.hoNm),
      '해당층': pde_trim_(item.flrNo)
    };
  });
}

/**
 * 건축물대장 전유부 → 아파트 매물 시트 행들 (동/호 프리필용).
 */
function pde_mapExposToApartmentRows_(exposItems) {
  var exclusive = exposItems.filter(function(item) {
    return pde_trim_(item.exposPubuseGbCd) === '1';
  });

  return exclusive.map(function(item) {
    return {
      '동': pde_trim_(item.dongNm),
      '호': pde_trim_(item.hoNm)
    };
  });
}

/**
 * 분양정보 상세 → 아파트단지 시트 매핑.
 */
function pde_mapSupplyDetailToComplex_(detailItem) {
  if (!detailItem) return null;

  var regulationFlags = [];
  if (pde_trim_(detailItem.SPECLT_RDN_EARTH_AT) === 'Y') regulationFlags.push('투기과열지구');
  if (pde_trim_(detailItem.MDAT_TRGET_AREA_SECD) === 'Y') regulationFlags.push('조정대상지역');

  return {
    '단지명': pde_trim_(detailItem.HOUSE_NM),
    '공급세대수': pde_num_(detailItem.TOT_SUPLY_HSHLDCO),
    '시행사': pde_trim_(detailItem.CNSTRCT_ENTRPS_NM) || pde_trim_(detailItem.BSNS_MBY_NM),
    '주택유형': pde_trim_(detailItem.HOUSE_DTL_SECD_NM),
    '홈페이지': pde_trim_(detailItem.HMPG_ADRES),
    '규제지역여부': regulationFlags.join(', '),
    '분양가상한제': pde_trim_(detailItem.PARCPRC_ULS_AT) === 'Y' ? 'Y' : 'N',
    '단지코드': pde_trim_(detailItem.HOUSE_MANAGE_NO),
    '해당지역': pde_trim_(detailItem.SUBSCRPT_AREA_CODE_NM)
  };
}

/**
 * 분양정보 상세 → 단지일정 시트 행 생성.
 * 하나의 분양상세 레코드에서 여러 일정 행을 추출.
 */
function pde_mapSupplyDetailToScheduleRows_(detailItem) {
  if (!detailItem) return [];

  var houseName = pde_trim_(detailItem.HOUSE_NM);
  var schedules = [
    { name: '모집공고', start: 'RCRIT_PBLANC_DE', end: 'RCRIT_PBLANC_DE' },
    { name: '청약접수', start: 'RCEPT_BGNDE', end: 'RCEPT_ENDDE' },
    { name: '특별공급접수', start: 'SPSPLY_RCEPT_BGNDE', end: 'SPSPLY_RCEPT_ENDDE' },
    { name: '1순위(해당지역)', start: 'GNRL_RNK1_CRSPAREA_RCPTDE', end: 'GNRL_RNK1_CRSPAREA_ENDDE' },
    { name: '1순위(기타경기)', start: 'GNRL_RNK1_ETC_GG_RCPTDE', end: 'GNRL_RNK1_ETC_GG_ENDDE' },
    { name: '1순위(기타지역)', start: 'GNRL_RNK1_ETC_AREA_RCPTDE', end: 'GNRL_RNK1_ETC_AREA_ENDDE' },
    { name: '2순위(해당지역)', start: 'GNRL_RNK2_CRSPAREA_RCPTDE', end: 'GNRL_RNK2_CRSPAREA_ENDDE' },
    { name: '2순위(기타경기)', start: 'GNRL_RNK2_ETC_GG_RCPTDE', end: 'GNRL_RNK2_ETC_GG_ENDDE' },
    { name: '2순위(기타지역)', start: 'GNRL_RNK2_ETC_AREA_RCPTDE', end: 'GNRL_RNK2_ETC_AREA_ENDDE' },
    { name: '당첨자발표', start: 'PRZWNER_PRESNATN_DE', end: 'PRZWNER_PRESNATN_DE' },
    { name: '계약', start: 'CNTRCT_CNCLS_BGNDE', end: 'CNTRCT_CNCLS_ENDDE' }
  ];

  var rows = [];
  schedules.forEach(function(sch) {
    var startDate = pde_trim_(detailItem[sch.start]);
    var endDate = pde_trim_(detailItem[sch.end]);
    if (startDate || endDate) {
      rows.push({
        '단지명': houseName,
        '일정명': sch.name,
        '시작일': startDate,
        '종료일': endDate,
        '비고': ''
      });
    }
  });

  // 입주예정월은 비고에 기록
  var mvnDate = pde_trim_(detailItem.MVN_PREARNGE_YM);
  if (mvnDate) {
    rows.push({
      '단지명': houseName,
      '일정명': '입주예정',
      '시작일': mvnDate,
      '종료일': '',
      '비고': '입주예정월'
    });
  }

  return rows;
}

/**
 * 분양정보 주택형 → 타입 시트 행 생성.
 */
function pde_mapSupplyModelToTypeRows_(modelItems, houseName) {
  return modelItems.map(function(item) {
    var generalCount = pde_num_(item.SUPLY_HSHLDCO);
    var specialCount = pde_num_(item.SPSPLY_HSHLDCO);

    return {
      '단지명': houseName,
      '주택 관리번호': pde_trim_(item.HOUSE_MANAGE_NO),
      '모델': pde_trim_(item.MODEL_NO),
      '주택형(전용면적기준)': pde_trim_(item.HOUSE_TY),
      '약식표기': pde_parseShortTypeName_(pde_trim_(item.HOUSE_TY)),
      '주거 전용면적': pde_num_(item.SUPLY_AR),
      '총공급 세대수': generalCount + specialCount,
      '일반공급 세대수': generalCount,
      '계': specialCount,
      '다자녀 가구': pde_num_(item.MNYCH_HSHLDCO),
      '신혼 부부': pde_num_(item.NWWDS_HSHLDCO),
      '생애 최초': pde_num_(item.LFE_FRST_HSHLDCO),
      '노부모 부양': pde_num_(item.OLD_PARNTS_SUPORT_HSHLDCO),
      '기관 추천': pde_num_(item.INSTT_RECOMEND_HSHLDCO)
    };
  });
}

/**
 * 주택형 이름에서 약식표기 추출. "059.9900A" → "59A", "084.9800" → "84"
 */
function pde_parseShortTypeName_(houseType) {
  if (!houseType) return '';
  var match = houseType.match(/^0*(\d+)\.\d+([A-Z]?)$/i);
  if (match) {
    return match[1] + (match[2] || '');
  }
  // 정수 형태: "84" 등
  match = houseType.match(/^0*(\d+)([A-Z]?)$/i);
  if (match) {
    return match[1] + (match[2] || '');
  }
  return houseType;
}

/**
 * 주용도명 → 주택유형 변환.
 */
function pde_mapPurposeToHouseType_(purposeName) {
  if (!purposeName) return '';
  if (purposeName.indexOf('단독') >= 0) return '단독주택';
  if (purposeName.indexOf('다가구') >= 0) return '다가구';
  if (purposeName.indexOf('다세대') >= 0) return '다세대';
  if (purposeName.indexOf('연립') >= 0) return '연립';
  if (purposeName.indexOf('다중') >= 0) return '다중주택';
  return purposeName;
}

/**
 * 매핑된 데이터를 대상 시트에 upsert (키 기준으로 기존 행 업데이트 또는 새 행 추가).
 *
 * @param {string} sheetName  대상 시트 이름
 * @param {Object[]} mappedRows  매핑된 행 배열 (각 행은 { 헤더: 값 } 객체)
 * @param {string[]} keyColumns  중복 판별 키 컬럼 이름 배열
 * @param {string[]} protectedColumns  기존 값이 있으면 덮어쓰지 않는 컬럼 이름 배열
 */
function pde_upsertToSheet_(sheetName, mappedRows, keyColumns, protectedColumns) {
  if (!mappedRows || !mappedRows.length) return { added: 0, updated: 0 };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + sheetName);
    return { added: 0, updated: 0 };
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return pde_trim_(h); });
  var headerIndex = pde_buildHeaderIndex_(headers);
  var dataRange = sheet.getDataRange();
  var allValues = dataRange.getValues();
  var protectedSet = {};
  (protectedColumns || []).forEach(function(col) { protectedSet[col] = true; });

  var added = 0;
  var updated = 0;

  mappedRows.forEach(function(mappedRow) {
    // 키 기반으로 기존 행 검색
    var existingRowIdx = -1;
    if (keyColumns && keyColumns.length) {
      for (var r = 1; r < allValues.length; r++) {
        var match = keyColumns.every(function(key) {
          var colIdx = headerIndex[key];
          if (colIdx === undefined) return false;
          return pde_trim_(allValues[r][colIdx]) === pde_trim_(mappedRow[key] || '');
        });
        if (match) {
          existingRowIdx = r;
          break;
        }
      }
    }

    if (existingRowIdx >= 0) {
      // 기존 행 업데이트
      var row = allValues[existingRowIdx];
      var changed = false;
      Object.keys(mappedRow).forEach(function(header) {
        var colIdx = headerIndex[header];
        if (colIdx === undefined) return;
        if (protectedSet[header] && pde_trim_(row[colIdx])) return;
        var newVal = mappedRow[header];
        if (pde_trim_(newVal) !== '' && pde_trim_(row[colIdx]) !== pde_trim_(newVal)) {
          row[colIdx] = newVal;
          changed = true;
        }
      });
      if (changed) {
        sheet.getRange(existingRowIdx + 1, 1, 1, row.length).setValues([row]);
        allValues[existingRowIdx] = row;
        updated++;
      }
    } else {
      // 새 행 추가
      var newRow = new Array(headers.length).fill('');
      Object.keys(mappedRow).forEach(function(header) {
        var colIdx = headerIndex[header];
        if (colIdx !== undefined) {
          newRow[colIdx] = mappedRow[header];
        }
      });
      sheet.appendRow(newRow);
      allValues.push(newRow);
      added++;
    }
  });

  return { added: added, updated: updated };
}

/**
 * 건축물대장 조회결과를 매물유형별 시트에 반영.
 */
function pde_applyBuildingResult_() {
  var propertyType = pde_detectPropertyType_();
  if (!propertyType || propertyType === PDE_PROPERTY_TYPES.LAND) {
    return { message: '토지는 건축물대장 대상이 아닙니다.' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 조회결과 시트에서 raw 데이터 읽기
  var titleSheet = ss.getSheetByName(PDE.SHEETS.BLD_RESULT + '_총괄');
  var recapSheet = ss.getSheetByName(PDE.SHEETS.BLD_RESULT + '_동별');
  var exposSheet = ss.getSheetByName(PDE.SHEETS.BLD_RESULT + '_전유부');

  var titleItems = pde_readResultSheetAsObjects_(titleSheet, PDE_BLD_TITLE_FIELDS);
  var recapItems = pde_readResultSheetAsObjects_(recapSheet, PDE_BLD_RECAP_FIELDS);
  var exposItems = pde_readResultSheetAsObjects_(exposSheet, PDE_BLD_EXPOS_FIELDS);

  var messages = [];

  if (propertyType === PDE_PROPERTY_TYPES.APARTMENT) {
    if (titleItems.length) {
      var complexData = pde_mapBuildingToApartmentComplex_(titleItems, recapItems);
      var complexResult = pde_upsertToSheet_('아파트단지', [complexData], ['단지명'], ['단지ID', '단지명축약']);
      messages.push('아파트단지: 추가 ' + complexResult.added + ', 수정 ' + complexResult.updated);
    }
    if (exposItems.length) {
      var aptRows = pde_mapExposToApartmentRows_(exposItems);
      messages.push('아파트 전유부: ' + aptRows.length + '호 조회됨 (참고용)');
    }
  } else if (propertyType === PDE_PROPERTY_TYPES.BUILDING) {
    if (titleItems.length) {
      var bldData = pde_mapBuildingToBuildingSheet_(titleItems);
      if (bldData) {
        var bldResult = pde_upsertToSheet_('건물', [bldData], ['건물명'], ['고객', '임대인 연락처']);
        messages.push('건물: 추가 ' + bldResult.added + ', 수정 ' + bldResult.updated);
      }
    }
    if (exposItems.length) {
      var storeRows = pde_mapExposToStoreRows_(exposItems);
      if (storeRows.length) {
        var storeResult = pde_upsertToSheet_('상가', storeRows, ['호수'], ['고객', '접수자', '접수일']);
        messages.push('상가: 추가 ' + storeResult.added + ', 수정 ' + storeResult.updated);
      }
      var roomRows = pde_mapExposToRoomRows_(exposItems);
      if (roomRows.length) {
        var roomResult = pde_upsertToSheet_('원투룸', roomRows, ['호'], ['고객', '임대인 연락처']);
        messages.push('원투룸: 추가 ' + roomResult.added + ', 수정 ' + roomResult.updated);
      }
    }
  } else if (propertyType === PDE_PROPERTY_TYPES.HOUSE) {
    if (titleItems.length) {
      var houseData = pde_mapBuildingToHouseSheet_(titleItems);
      if (houseData) {
        messages.push('주택: 주구조=' + houseData['주구조'] + ', 사용승인=' + houseData['사용승인'] +
                      ', 주택유형=' + houseData['주택유형'] + ' (수동 반영 필요)');
      }
    }
  } else if (propertyType === PDE_PROPERTY_TYPES.FACTORY) {
    if (titleItems.length) {
      var factoryData = pde_mapBuildingToFactorySheet_(titleItems);
      if (factoryData) {
        var factoryResult = pde_upsertToSheet_('공장창고', [factoryData], ['명칭'], ['고객', '임대인 연락처']);
        messages.push('공장창고: 추가 ' + factoryResult.added + ', 수정 ' + factoryResult.updated);
      }
    }
  }

  return { message: messages.length ? messages.join('\n') : '반영할 데이터가 없습니다.' };
}

/**
 * 분양정보 조회결과를 아파트단지/단지일정/타입 시트에 반영.
 */
function pde_applySupplyResult_() {
  if (!pde_isApartment_()) {
    return { message: '분양정보는 아파트 스프레드시트에서만 사용 가능합니다.' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var detailSheet = ss.getSheetByName(PDE.SHEETS.SUPPLY_RESULT + '_상세');
  var modelSheet = ss.getSheetByName(PDE.SHEETS.SUPPLY_RESULT + '_주택형');

  var detailItems = pde_readResultSheetAsObjects_(detailSheet, PDE_SUPPLY_DETAIL_FIELDS);
  var modelItems = pde_readResultSheetAsObjects_(modelSheet, PDE_SUPPLY_MODEL_FIELDS);

  var messages = [];

  // 분양상세 → 아파트단지 + 단지일정
  detailItems.forEach(function(item) {
    var complexData = pde_mapSupplyDetailToComplex_(item);
    if (complexData) {
      var complexResult = pde_upsertToSheet_('아파트단지', [complexData], ['단지명'], ['단지ID', '단지명축약']);
      messages.push('아파트단지 [' + complexData['단지명'] + ']: 추가 ' + complexResult.added + ', 수정 ' + complexResult.updated);
    }

    var scheduleRows = pde_mapSupplyDetailToScheduleRows_(item);
    if (scheduleRows.length) {
      var schedResult = pde_upsertToSheet_('단지일정', scheduleRows, ['단지명', '일정명'], []);
      messages.push('단지일정: 추가 ' + schedResult.added + ', 수정 ' + schedResult.updated);
    }
  });

  // 주택형 → 타입
  if (modelItems.length && detailItems.length) {
    // 주택관리번호로 주택명 연결
    var houseNameMap = {};
    detailItems.forEach(function(d) {
      houseNameMap[pde_trim_(d.HOUSE_MANAGE_NO)] = pde_trim_(d.HOUSE_NM);
    });

    var typeRows = [];
    modelItems.forEach(function(m) {
      var houseName = houseNameMap[pde_trim_(m.HOUSE_MANAGE_NO)] || '';
      var rows = pde_mapSupplyModelToTypeRows_([m], houseName);
      typeRows = typeRows.concat(rows);
    });

    if (typeRows.length) {
      var typeResult = pde_upsertToSheet_('타입', typeRows, ['단지명', '모델'], []);
      messages.push('타입: 추가 ' + typeResult.added + ', 수정 ' + typeResult.updated);
    }
  }

  return { message: messages.length ? messages.join('\n') : '반영할 분양 데이터가 없습니다.' };
}

/**
 * 조회결과 시트를 오브젝트 배열로 읽기.
 */
function pde_readResultSheetAsObjects_(sheet, fields) {
  if (!sheet) return [];
  var rows = pde_bodyRows_(sheet);
  if (!rows.length) return [];

  return rows.map(function(row) {
    var obj = {};
    fields.forEach(function(field, idx) {
      obj[field] = idx < row.length ? row[idx] : '';
    });
    return obj;
  }).filter(function(obj) {
    // 빈 행 필터
    return fields.some(function(f) { return pde_trim_(obj[f]) !== ''; });
  });
}
