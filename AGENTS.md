# Building Ledger Automation

## Scope
- 건축물대장 조회 FastAPI
- n8n 연동 워크플로우
- Apps Script와 운영 가이드 보관

## Rules
- 핵심 API는 `src/building_ledger_api/` 아래에서 유지한다.
- 외부 연동 문서는 standalone repo 기준 경로만 사용한다.
- `BldRgstService_v2` 계열 구형 엔드포인트는 다시 도입하지 않는다.
- 캐시와 `.env`는 로컬 상태로 취급하고 커밋하지 않는다.

## Key Files
- `src/building_ledger_api/main.py`
- `src/building_ledger_api/service.py`
- `n8n-workflows/n8n-workflow-building-ledger-api-v2.json`
- `apps-script/BuildingLedger.gs`
