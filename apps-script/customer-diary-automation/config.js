/**
 * e편한세상 시티 천안아산역 상가 - 고객 상담일지 자동화 설정
 */
var CONFIG = {
  spreadsheetId: '10oFgVx2CFERTQIsmfgEqrlvpWFu99iXzeiKl2ou5yxY',

  sheets: {
    customerDb: '고객DB',
    member: '멤버',
    unitDb: '호실DB'
  },

  // 고객DB 헤더 (3행) 기준 컬럼 매핑 (A=1)
  customerColumns: {
    no: 1,            // A: No
    companyName: 2,   // B: 고객/업체명
    manager: 3,       // C: 담당자
    firstDate: 4,     // D: 최초등록일
    business: 5,      // E: 업종
    unit: 6,          // F: 관심호실
    grade: 7,         // G: 등급
    contact: 8,       // H: 담당자/연락처
    customerName: 9,  // I: 고객성함
    channel: 10,      // J: 유입채널
    lastContact: 11,  // K: 최근접촉일
    nextAction: 12,   // L: 다음액션일
    pipeline: 13,     // M: 파이프라인단계
    memo: 14,         // N: 메모/히스토리
    remark: 15,       // O: 비고
    contractDate: 16, // P: 계약예정일
    balanceDate: 17   // Q: 잔금예정일
  },

  customerHeaderRow: 3,
  customerDataStartRow: 4,

  // 호실 목록 (1F만)
  unitList: [
    '101','102','103','104','105','106','107','108','109',
    '110','111','112','113','114','115','116','117','118'
  ],

  // 폼 드롭다운 옵션
  gradeOptions: ['A', 'B', 'C', 'D'],
  channelOptions: ['현장방문', '전화문의', '지인소개', '온라인문의', '전단지', '기타'],
  pipelineOptions: ['신규등록', '마케팅중', '미팅예정', '의향서접수', '계약진행', '계약완료'],

  emailSubjectPrefix: '[e편한세상시티 천안아산역] 업무일지'
};
