# 이실장(aipartner.com) 매물 등록 자동화 핸드오프

이 문서는 이실장 사이트의 매물 등록 프로세스를 구글 시트 데이터와 연동하여 자동화하는 프로젝트의 현재 상태와 다음 단계를 기록합니다.

## 1. 프로젝트 목표
- **대상 사이트:** [이실장 (aipartner.com)](https://www.aipartner.com)
- **목표:** 구글 시트(`아파트_앱시트DB`) 및 옵시디언 매물 데이터를 이실장 등록 폼에 자동으로 매핑하여 광고 등록.
- **주요 기술:** Node.js, Puppeteer, Google Workspace API (gws), JavaScript Mapper.

## 2. 데이터 소스 (Source Data)
- **구글 드라이브 폴더:** `1yB3Yu_Dhrei-92MidLv31ZcXBjD027HC`
- **매물 DB 시트:** `아파트_앱시트DB` (ID: `1s6i-fFhQgKRSmowMtnmO4dIx-3BpPauMSN1e7hezmEQ`)
- **대상 워크시트:** `아파트`
- **테스트 매물:** `배방우방2-211-1204-61A` (ID: `e51009d7`)
  - 단지명: 아산배방우방아이유쉘2단지
  - 동/호: 211동 1204호
  - 매매가: 26,980만원

## 3. 현재 구현 상태 및 파일 목록
- **`scripts/aipartner_mapper.js`**: 시트의 한 행(Row) 데이터를 이실장 API 전송용 JSON 객체로 변환하는 핵심 로직. (단지코드, 거래유형, 가격 파싱 포함)
- **`scripts/aipartner_auto_reg_test.js`**: Puppeteer 기반 자동 입력 테스트 스크립트. 
  - **로그인 성공:** `cao2563` / `iu4949!@` 계정 사용.
  - **진행 중 이슈:** 단지 선택 후 Livewire가 폼을 동적으로 로드할 때 타임아웃 발생하는 경우가 있음. (Wait 로직 보강 필요)

## 4. 이실장 API 구조 (Key-Value)
- **Endpoint:** `POST https://www.aipartner.com/offerings/ad_regist`
- **핵심 필드:**
  - `_token`: CSRF 토큰 (HTML meta 태그에서 추출)
  - `complexCd`: 단지 고유 ID (예: 51889)
  - `tradeType`: `S`(매매), `R`(전세), `M`(월세)
  - `priceSell`: 만원 단위 숫자
  - `manageItemStr`: 관리비 세부 항목 (JSON string)

## 5. 다음 단계 (Next Steps)
1.  **폼 로딩 안정화:** `aipartner_auto_reg_test.js`에서 단지 클릭 후 상세 폼이 나타날 때까지의 대기 로직 최적화.
2.  **API 직접 전송 테스트:** Puppeteer 대신 `axios/fetch`를 사용하여 매퍼(`aipartner_mapper.js`)에서 생성된 Payload를 직접 전송하는 방식 시도.
3.  **사진 연동:** 구글 드라이브 매물 폴더(`1h-QUa6uhvyyUpPBOf52kOLXDcYaGRsFs`) 내 이미지들을 다운로드하여 자동 업로드하는 로직 추가.
4.  **대량 등록 루프:** 시트에서 `광고` 상태가 '대기'인 항목을 순회하며 등록 프로세스 실행.

---
**마지막 작업 일시:** 2026-03-31
**수행 에이전트:** Gemini CLI
