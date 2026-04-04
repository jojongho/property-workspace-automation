/**
 * 이실장(aipartner.com) 데이터 매퍼
 * 구글 시트 데이터 -> 이실장 API 전송용 객체 변환
 */

const AipartnerMapper = {
  // 1. 단지 코드 매핑 (단지명 기반 또는 시트의 단지ID 사용)
  complexCodes: {
    '아산배방우방아이유쉘2단지': '51889', // 실제 사이트 클릭 시 확인된 코드 필요
    '아산배방1단지우방아이유쉘': '51889',
    // ... 추가 단지 코드 등록
  },

  /**
   * 시트 행 데이터를 이실장 전송 객체로 변환
   * @param {Object} row - 시트의 한 행 데이터 (Key-Value)
   * @param {string} csrfToken - 세션에서 추출한 CSRF 토큰
   */
  mapToAdRegist(row, csrfToken) {
    // 금액 처리: '  26,980 ' -> 26980
    const parsePrice = (val) => {
      if (!val) return '0';
      return val.toString().replace(/[^0-9]/g, '');
    };

    const payload = {
      _token: csrfToken,
      mode: 'adRegist',
      complexCd: this.complexCodes[row['단지명']] || row['단지ID'] || '',
      houseNo: row['호'],
      dongStr: row['동'],
      
      // 거래 정보
      tradeType: this.mapTradeType(row['거래유형']),
      priceSell: parsePrice(row['합계'] || row['매매가']),
      deposit: parsePrice(row['보증금']),
      monthlyRent: parsePrice(row['월세']),
      
      // 상세 정보
      featureStr: row['매물특징'] || `${row['단지명']} ${row['동']}동 급매`,
      offeringsUseCd: '01001', // 아파트 고정 (필요시 시트에서 가져옴)
      directionCd: this.mapDirection(row['방향']),
      
      // 관리비 (신체계 반영 예시)
      manageItemStr: JSON.stringify({
        totalAmount: parsePrice(row['관리비']),
        items: [] // 시트에 세부 항목이 있다면 여기에 매핑
      }),
      
      // 기타 기본값
      offeringsGbn: 'AP', // 아파트
      telDisplayGbn: 'B', // 중개업소 번호만 노출
      availableDateGbn: 'I', // 즉시입주
      availableDate: '',
      isTempAddr: 'N',
      mapOkYn: 'Y'
    };

    return payload;
  },

  // 거래유형 매핑 (시트 -> 이실장 코드)
  mapTradeType(type) {
    const map = {
      '매매': 'S',
      '분양': 'S', // 분양권 전매도 보통 매매(S)로 처리
      '전세': 'R',
      '월세': 'M'
    };
    return map[type] || 'S';
  },

  // 방향 매핑
  mapDirection(dir) {
    const map = {
      '남향': 'S', '동향': 'E', '서향': 'W', '북향': 'N',
      '남동향': 'SE', '남서향': 'SW', '북동향': 'NE', '북서향': 'NW'
    };
    return map[dir] || '';
  }
};

module.exports = AipartnerMapper;
