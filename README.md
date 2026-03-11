# Building Ledger Automation

건축물대장 자동조회 전용 standalone 저장소입니다. `n8n`은 트리거와 오케스트레이션만 담당하고, 핵심 조회 로직은 이 저장소의 FastAPI 서비스가 담당합니다.

## Included

- `src/building_ledger_api/`: FastAPI 서비스
- `scripts/lookup_once.py`: 단건 CLI 테스트
- `n8n-workflows/`: n8n 워크플로우와 가이드
- `apps-script/`: 기존 Apps Script 자산
- `notes/`: 시행착오와 운영 메모

## Quick Start

```bash
cd /Users/cao25/Projects/building-ledger-automation
cp .env.example .env
make install
make run
```

기본 서버: `http://localhost:8080`

## Commands

- `make install`
- `make run`
- `make check`
- `make lookup ADDRESS='충청남도 천안시 서북구 불당동 1329'`

## API

### Health Check

```bash
curl http://localhost:8080/health
```

### Lookup

```bash
curl -X POST http://localhost:8080/lookup \
  -H 'Content-Type: application/json' \
  -d '{"address":"충청남도 천안시 서북구 불당동 1329"}'
```

`LEDGER_API_TOKEN`을 설정한 경우 `X-API-Key` 헤더가 필요합니다.

## n8n Integration Pattern

1. Notion Trigger 또는 Webhook Trigger로 조회 요청을 받습니다.
2. HTTP Request 노드에서 `POST /lookup`을 호출합니다.
3. 응답값을 Notion 또는 Google Sheets 업데이트 노드에 매핑합니다.
4. 성공 시 `조회상태=완료`, 실패 시 `조회상태=실패`로 기록합니다.

## Notes

- 이 저장소는 이미 standalone repo이므로 별도 export 스크립트는 신규 워크플로우에 사용하지 않습니다.
- 운영 경로 문서는 `projects/...`를 전제하지 않습니다.

## Critical Rules

1. 엔드포인트는 `BldRgstHubService/getBrTitleInfo`를 사용합니다.
2. 파라미터는 `sigungu_code`, `bdong_code`, `plat_code`, `bun`, `ji`를 사용합니다.
3. PNU는 반드시 19자리로 검증합니다.
4. 구형 `BldRgstService_v2`와 혼용하지 않습니다.
