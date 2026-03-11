# n8n 건축물대장 조회 → Notion 연동 가이드

> ⚠️ 이 문서는 초기 버전입니다.  
> 최신 버전은 `n8n-building-ledger-api-v2-guide.md` 와
> `n8n-workflow-building-ledger-api-v2.json`을 사용하세요.

카테고리: 기획안
요약: 기존 Google Sheets 기반 n8n 워크플로우를 Notion DB로 전환하는 방법. Webhook 버튼 클릭 방식으로 건축물대장 API 조회 후 자동 업데이트.
날짜: 2026년 1월 30일
상태: 완료함
최종 편집 일시: 2026년 1월 30일 오후 9:19

## 📋 개요

기존 **Google Sheets 트리거 방식**을 **Notion 버튼 클릭 방식**으로 전환합니다.

**변경 전**: Sheets 행 추가 → 자동 실행 → Sheets 업데이트

**변경 후**: Notion 버튼 클릭 → Webhook 호출 → API 조회 → Notion 업데이트

---

## 🎯 필요한 정보

### 1. Notion 정보

- **Database ID**: `a0890e16022e49579d0836faf6d4a2d6` (건축물대장 조회 DB)
- **Integration Token**: Notion 설정에서 발급 필요
- **Page ID**: 버튼 클릭 시 Webhook에 전달됨

### 2. API Keys (기존 유지)

- **Vworld API Key**: 주소 → PNU 변환
- **공공데이터 Service Key**: 건축물대장 조회

### 3. Railway n8n

- Webhook URL이 생성됨 (예: [`https://your-n8n.railway.app/webhook/building-registry`](https://your-n8n.railway.app/webhook/building-registry))

---

## 🔧 n8n 워크플로우 수정

### Step 1: 기존 노드 제거

삭제할 노드:

- ❌ Google Sheets Trigger
- ❌ Update row in sheet

### Step 2: 새 노드 추가

#### 노드 1: Webhook (트리거)

```json
{
  "method": "POST",
  "path": "building-registry",
  "responseMode": "responseNode"
}
```

**Expected Payload**:

```json
{
  "page_id": "notion-page-url",
  "address": "충청남도 천안시 서북구 불당동 123-45"
}
```

#### 노드 2: Notion - Get Page (주소 확인)

```json
{
  "resource": "page",
  "operation": "get",
  "pageId": "= $json.page_id "
}
```

#### 노드 3: 조회상태 "조회중"으로 변경

```json
{
  "resource": "databasePage",
  "operation": "update",
  "pageId": "= $json.page_id ",
  "properties": {
    "조회상태": "조회중"
  }
}
```

#### 노드 4~7: 기존 API 노드 유지

- HTTP Request - Vworld (그대로)
- Code in JavaScript (그대로)
- Node 3: 일반건물 표제부 조회1 (그대로)
- Switch (그대로)

#### 노드 8: Notion - Update Database Page (최종 업데이트)

> ⚠️ **주의**: JSON 경로는 실제 API 응답 구조 `response.body.items.item[0]`을 따릅니다.

```json
{
  "resource": "databasePage",
  "operation": "update",
  "pageId": "= $('Webhook').item.json.page_id ",
  "properties": {
    "조회상태": "완료",
    "일반건물여부": "={{ $json.response.body.items.item[0].regstrKindCdNm }}",
    "도로명주소": "={{ $json.response.body.items.item[0].newPlatPlc }}",
    "대지면적": "={{ $json.response.body.items.item[0].platArea }}",
    "건축면적": "={{ $json.response.body.items.item[0].archArea }}",
    "건폐율": "={{ $json.response.body.items.item[0].bcRat }}",
    "연면적": "={{ $json.response.body.items.item[0].totArea }}",
    "용적률산정연면적": "={{ $json.response.body.items.item[0].vlRatEstmTotArea }}",
    "용적률": "={{ $json.response.body.items.item[0].vlRat }}",
    "구조코드명": "={{ $json.response.body.items.item[0].strctCdNm }}",
    "기타구조": "={{ $json.response.body.items.item[0].strctCd }}",
    "내진설계여부": "={{ $json.response.body.items.item[0].rserthqkDsgnApplyYn }}",
    "내진능력": "={{ $json.response.body.items.item[0].rserthqkAblty }}",
    "사용승인일": "={{ $json.response.body.items.item[0].useAprDay }}"
  }
}
```

#### 노드 9: Respond to Webhook

```json
{
  "options": {
    "responseBody": "={{ { success: true, message: '조회 완료' } }}"
  }
}
```

---

## 🔗 Notion Button 설정

### 1. Notion Integration 생성

1. [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) 접속
2. "New integration" 클릭
3. 이름: `n8n Building Registry`
4. **Internal Integration Token** 복사

### 2. Integration 연결

1. 건축물대장 조회 DB 우측 상단 `...` 클릭
2. "Connections" → "Connect to" 선택
3. `n8n Building Registry` 추가

### 3. Button 속성 설정

**현재 상태**: 버튼만 생성됨 (URL 없음)

**수동 설정 필요**:

```
속성 이름: 건축물대장 조회
버튼 URL: https://your-n8n.railway.app/webhook/building-registry
Method: POST
Body: {
  "page_id": "page.id",
  "address": "properties.주소"
}
```

> ⚠️ **참고**: Notion Button은 현재 외부 Webhook 직접 호출을 지원하지 않습니다.
> 

> **대안**: n8n Database Trigger 사용 (조회상태가 "대기중"으로 변경되면 자동 실행)
> 

---

## 🔄 대안: Database Trigger 방식

### 변경된 플로우

1. Notion에 주소 입력
2. 조회상태를 "대기중"으로 설정
3. n8n Database Trigger 감지
4. API 조회 후 자동 업데이트

### n8n 노드 구성

#### 노드 1: Notion Trigger

```json
{
  "resource": "database",
  "event": "pageUpdated",
  "databaseId": "a0890e16022e49579d0836faf6d4a2d6",
  "filters": [
    {
      "property": "조회상태",
      "condition": "equals",
      "value": "대기중"
    }
  ]
}
```

#### 이후 노드는 동일

- Vworld API 호출
- PNU 파싱
- 건축물대장 조회
- Notion 업데이트

---

## ✅ 테스트 절차

### 1. 테스트 주소 입력

```
주소: 충청남도 천안시 서북구 불당동 1329
조회상태: 대기중
```

### 2. n8n 실행 확인

- Railway 로그 확인
- Execution 탭에서 성공 여부 체크

### 3. Notion 결과 확인

- 조회상태: 완료
- 대지면적, 건축면적 등 자동 입력

---

## 📌 체크리스트

- [ ]  Notion Integration 생성 및 Token 복사
- [ ]  건축물대장 조회 DB에 Integration 연결
- [ ]  n8n에 Notion Trigger 또는 Webhook 노드 추가
- [ ]  Notion Update 노드 설정 (Database ID, Token)
- [ ]  API Key 환경변수 설정 (Vworld, 공공데이터)
- [ ]  워크플로우 활성화 (Active)
- [ ]  테스트 주소로 실행 확인

---

## 🚨 트러블슈팅

### 문제 1: "Unauthorized" 에러

**원인**: Notion Token 미설정 또는 Integration 연결 안됨

**해결**: Integration 재연결, Token 재발급

### 문제 2: API 응답 없음

**원인**: Service Key 만료 또는 IP 차단

**해결**: 공공데이터포털에서 Key 상태 확인

### 문제 3: 속성 업데이트 실패

**원인**: 속성 이름 불일치 또는 타입 오류

**해결**: Notion DB 스키마 확인, JSON 매핑 재검토

---

## 📚 참고 링크

- [Notion API 공식 문서](https://developers.notion.com/)
- [n8n Notion 노드 가이드](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.notion/)
- [Vworld API 문서](https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do)
- [건축물대장 API 문서](https://www.data.go.kr/data/15044713/openapi.do)

---

## 💡 다음 개선 사항

1. **실패 처리**: 조회 실패 시 "실패" 상태로 변경
2. **로그 저장**: 별도 테이블에 조회 이력 기록
3. **배치 처리**: 여러 주소 한번에 조회
4. **캐싱**: 동일 주소 중복 조회 방지

---

## 📦 전체 워크플로우 JSON (Import용)

> 아래 JSON을 복사하여 n8n에서 **Import from JSON** 으로 붙여넣기 하세요.
> ⚠️ `serviceKey`, `key` 값은 본인의 API 키로 교체해야 합니다.
> ⚠️ `databaseId`는 본인의 Notion 데이터베이스 ID로 교체해야 합니다.

### 워크플로우 흐름

```
Notion Trigger (조회상태=대기중) → Vworld API → PNU 파싱 → 건축물대장 조회 → Notion 업데이트
```

```json
{
  "name": "건축물대장 조회 (Notion)",
  "nodes": [
    {
      "parameters": {
        "pollTimes": { "item": [{ "mode": "everyMinute" }] },
        "event": "page-updated-in-database",
        "databaseId": "a0890e16022e49579d0836faf6d4a2d6",
        "filters": {
          "singleCondition": {
            "field": "조회상태",
            "condition": "equals",
            "value": "대기중"
          }
        },
        "options": {}
      },
      "type": "n8n-nodes-base.notionTrigger",
      "typeVersion": 1.1,
      "position": [240, 300],
      "id": "d4b5c8a0-1234-4567-89ab-000000000001",
      "name": "Notion Trigger",
      "webhookId": ""
    },
    {
      "parameters": {
        "url": "https://api.vworld.kr/req/address",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            { "name": "service", "value": "address" },
            { "name": "request", "value": "getcoord" },
            { "name": "key", "value": "" },
            { "name": "type", "value": "parcel" },
            { "name": "address", "value": "={{ $json.properties['주소'].rich_text[0].plain_text }}" }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [460, 300],
      "id": "d4b5c8a0-1234-4567-89ab-000000000002",
      "name": "Vworld API"
    },
    {
      "parameters": {
        "jsCode": "const items = $input.all();\nconst results = [];\n\nfor (const item of items) {\n  const pnu = item.json.response?.result?.featureCollection?.features?.[0]?.properties?.full_nm;\n  \n  if (!pnu || pnu.length < 19) {\n    results.push({\n      json: {\n        error: 'PNU 파싱 실패',\n        pageId: item.json.id,\n        시군구: '',\n        읍면동: '',\n        산: 0,\n        본번: '',\n        부번: ''\n      }\n    });\n    continue;\n  }\n  \n  const 시군구 = pnu.substring(0, 5);\n  const 읍면동 = pnu.substring(5, 10);\n  const 산코드 = parseInt(pnu.substring(10, 11));\n  const 산 = 산코드 === 2 ? 1 : 0;\n  const 본번 = pnu.substring(11, 15);\n  const 부번 = pnu.substring(15, 19);\n  \n  results.push({\n    json: {\n      pageId: item.json.id,\n      시군구,\n      읍면동,\n      산,\n      본번,\n      부번\n    }\n  });\n}\n\nreturn results;"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [680, 300],
      "id": "d4b5c8a0-1234-4567-89ab-000000000003",
      "name": "PNU 파싱"
    },
    {
      "parameters": {
        "url": "http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            { "name": "serviceKey", "value": "" },
            { "name": "sigunguCd", "value": "={{ $json.시군구 }}" },
            { "name": "bjdongCd", "value": "={{ $json.읍면동 }}" },
            { "name": "platGbCd", "value": "={{ $json.산 }}" },
            { "name": "bun", "value": "={{ $json.본번 }}" },
            { "name": "ji", "value": "={{ $json.부번 }}" },
            { "name": "_type", "value": "json" }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [900, 300],
      "id": "d4b5c8a0-1234-4567-89ab-000000000004",
      "name": "건축물대장 조회"
    },
    {
      "parameters": {
        "resource": "databasePage",
        "operation": "update",
        "pageId": "={{ $node['PNU 파싱'].json.pageId }}",
        "propertiesUi": {
          "propertyValues": [
            { "key": "조회상태", "statusValue": "완료" },
            { "key": "일반건물여부", "selectValue": "일반" },
            { "key": "도로명주소", "textValue": "={{ $json.response?.body?.items?.item?.[0]?.newPlatPlc || '' }}" },
            { "key": "대지면적", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.platArea) || 0 }}" },
            { "key": "건축면적", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.archArea) || 0 }}" },
            { "key": "건폐율", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.bcRat) / 100 || 0 }}" },
            { "key": "연면적", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.totArea) || 0 }}" },
            { "key": "용적률산정연면적", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.vlRatEstmTotArea) || 0 }}" },
            { "key": "용적률", "numberValue": "={{ parseFloat($json.response?.body?.items?.item?.[0]?.vlRat) / 100 || 0 }}" },
            { "key": "구조코드명", "textValue": "={{ $json.response?.body?.items?.item?.[0]?.strctCdNm || '' }}" },
            { "key": "기타구조", "textValue": "={{ $json.response?.body?.items?.item?.[0]?.etcStrct || '' }}" },
            { "key": "내진설계여부", "selectValue": "={{ $json.response?.body?.items?.item?.[0]?.rserthqkDsgnApplyYn || '미확인' }}" },
            { "key": "내진능력", "textValue": "={{ $json.response?.body?.items?.item?.[0]?.rserthqkAblty || '' }}" },
            { "key": "사용승인일", "dateValue": "={{ $json.response?.body?.items?.item?.[0]?.useAprDay || '' }}" }
          ]
        }
      },
      "type": "n8n-nodes-base.notion",
      "typeVersion": 2.2,
      "position": [1120, 300],
      "id": "d4b5c8a0-1234-4567-89ab-000000000005",
      "name": "Notion 업데이트"
    }
  ],
  "connections": {
    "Notion Trigger": { "main": [[{ "node": "Vworld API", "type": "main", "index": 0 }]] },
    "Vworld API": { "main": [[{ "node": "PNU 파싱", "type": "main", "index": 0 }]] },
    "PNU 파싱": { "main": [[{ "node": "건축물대장 조회", "type": "main", "index": 0 }]] },
    "건축물대장 조회": { "main": [[{ "node": "Notion 업데이트", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" },
  "staticData": null,
  "tags": [],
  "triggerCount": 0,
  "updatedAt": "2026-01-30T12:00:00.000Z",
  "versionId": ""
}
```
