# n8n 건축물대장 조회 (Python API v2) 가이드

이 가이드는 standalone `building-ledger-automation` 저장소의 FastAPI(`/lookup`)를 n8n에서 호출해 Notion DB를 업데이트하는 구성입니다.

## 1) Import 파일

- `n8n-workflows/n8n-workflow-building-ledger-api-v2.json`

n8n에서 `Import from JSON`으로 가져오세요.

## 2) n8n 환경변수

n8n 인스턴스 환경변수에 아래 값을 추가하세요.

- `LEDGER_API_URL`: 예) `http://host.docker.internal:8080/lookup`
- `LEDGER_API_TOKEN`: FastAPI의 `LEDGER_API_TOKEN`과 동일값 (옵션)

## 3) Notion 준비

1. Notion Integration을 DB에 연결
2. 대상 DB에 아래 속성 확인
- 필수: `주소`, `조회상태`
- 권장: `조회오류`, `도로명주소`, `대지면적`, `건축면적`, `건폐율`, `연면적`, `용적률`, `구조코드명`, `사용승인일`
3. `조회상태=대기중`으로 바꾸면 트리거

## 4) 워크플로우 동작

1. Notion Trigger: `조회상태=대기중` 페이지 감지
2. Code Node: `LEDGER_API_URL`로 POST `/lookup`
3. 성공/실패 분기
4. 성공: `조회상태=완료` + 건축물대장 필드 업데이트
5. 실패: `조회상태=실패` + `조회오류` 기록

## 5) 주의 사항

- `조회상태` 타입은 Status를 권장합니다.
- `일반건물여부`, `내진설계여부`가 Select 타입이면 옵션값이 DB에 미리 있어야 합니다.
- `사용승인일`은 `YYYYMMDD`를 `YYYY-MM-DD`로 변환해 저장합니다.
- 기존 구형 엔드포인트(`BldRgstService_v2`)는 사용하지 않습니다.
