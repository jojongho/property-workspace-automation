/**
 * 공공데이터 매물 자동입력 - API 클라이언트.
 *
 * 건축물대장 및 분양정보 공공 API에 대한 HTTP 호출, 응답 파싱, 재시도 로직.
 * PublicData_3API.gs의 pd3_fetch* 함수들을 pde_ 프리픽스로 재사용.
 */

/**
 * 건축물대장 API를 호출하고 아이템 배열을 반환.
 * 다수 엔드포인트/파라미터 변형을 순회하며 첫 번째 유효 응답을 반환.
 *
 * @param {string} serviceKey  공공데이터포털 인증키
 * @param {string} endpointUrl API 엔드포인트 URL
 * @param {Object} baseParams  기본 파라미터 (sigunguCd, bjdongCd 등)
 * @param {number} numOfRows   페이지당 건수 (기본 100)
 * @return {Object[]} 아이템 배열
 */
function pde_fetchBuildingApi_(serviceKey, endpointUrl, baseParams, numOfRows) {
  var maxRows = numOfRows || 100;
  var variants = [
    Object.assign({ _type: 'json' }, baseParams),
    baseParams
  ];

  var errors = [];
  for (var i = 0; i < variants.length; i++) {
    var params = Object.assign({
      serviceKey: serviceKey,
      numOfRows: maxRows,
      pageNo: 1
    }, variants[i]);

    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        var url = endpointUrl + '?' + pde_query_(params);
        var res = UrlFetchApp.fetch(url, {
          muteHttpExceptions: true,
          headers: {
            Accept: 'application/xml, application/json;q=0.9, */*;q=0.8',
            'Accept-Encoding': 'identity'
          }
        });

        var statusCode = res.getResponseCode();
        var text = pde_responseText_(res);
        var trimmed = pde_trim_(text);

        if (!trimmed) {
          if (attempt < 2) { Utilities.sleep(250); continue; }
          throw new Error('빈 응답(HTTP ' + statusCode + ')');
        }
        if (/Unauthorized/i.test(trimmed)) {
          throw new Error('인증 실패(HTTP ' + statusCode + ')');
        }
        if (trimmed.indexOf('SERVICE_KEY_IS_NOT_REGISTERED_ERROR') >= 0) {
          throw new Error('서비스키 미등록(HTTP ' + statusCode + ')');
        }

        var parsed = pde_parseOpenApiResponse_(trimmed);
        if (parsed.apiError) throw new Error(parsed.apiError);
        if (parsed.resultCode && !pde_isSuccessResultCode_(parsed.resultCode)) {
          throw new Error('API 오류(' + parsed.resultCode + '): ' + (parsed.resultMsg || ''));
        }

        if (parsed.items && parsed.items.length) {
          return parsed.items;
        }
        return [];
      } catch (err) {
        if (attempt < 2 && err.message && err.message.indexOf('빈 응답') >= 0) {
          Utilities.sleep(250);
          continue;
        }
        if (attempt >= 2) {
          errors.push(pde_trim_(err.message || String(err)));
        }
      }
    }
  }

  if (errors.length) {
    throw new Error('건축물대장 호출 실패: ' + errors.join(' | '));
  }
  return [];
}

/**
 * 분양정보(청약Home) API 페이징 호출.
 *
 * @param {string} serviceKey  인증키
 * @param {string} endpointName  API 함수명 (getAPTLttotPblancDetail 등)
 * @param {Object} cond  검색 조건
 * @param {number} perPage  페이지당 건수
 * @param {number} maxPage  최대 페이지 수
 * @return {{ data: Object[], totalCount: number, truncated: boolean }}
 */
function pde_fetchApplyhomePaged_(serviceKey, endpointName, cond, perPage, maxPage) {
  var endpoint = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/' + endpointName;
  var all = [];
  var page = 1;
  var totalCount = 0;
  var truncated = false;
  var effectivePerPage = perPage || 200;
  var effectiveMaxPage = maxPage || 30;

  while (page <= effectiveMaxPage) {
    var params = Object.assign({
      serviceKey: serviceKey,
      page: page,
      perPage: effectivePerPage,
      returnType: 'JSON'
    }, cond || {});

    var text = UrlFetchApp.fetch(endpoint + '?' + pde_query_(params), {
      muteHttpExceptions: true
    }).getContentText();

    if (/Unauthorized/i.test(text)) {
      throw new Error('분양정보 인증키 또는 활용신청 상태 확인 필요');
    }

    var json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error('분양정보 JSON 파싱 실패: ' + text.substring(0, 160));
    }

    if (json.error) {
      throw new Error('분양정보 API 오류: ' + JSON.stringify(json.error));
    }

    var data = Array.isArray(json.data) ? json.data : [];
    totalCount = pde_num_(json.totalCount || json.matchCount || 0);
    all = all.concat(data);

    if (!data.length) break;
    if (totalCount && page * effectivePerPage >= totalCount) break;
    page++;
    Utilities.sleep(120);
  }

  if (totalCount && all.length < totalCount && page > effectiveMaxPage) {
    truncated = true;
  }
  return { data: all, totalCount: totalCount, truncated: truncated };
}

/**
 * 주소로 지번 코드를 조회하여 입력폼에 채움.
 *
 * @param {string} address  한글 주소
 * @return {Object} { sigunguCd, bjdongCd, platGbCd, bun, ji, roadAddress }
 */
function pde_resolveAddress_(address) {
  var vworldKey = pde_getConfig_(PDE.CONFIG_KEYS.VWORLD, true);
  return pde_geocodeParcelByAddress_(address, vworldKey);
}
