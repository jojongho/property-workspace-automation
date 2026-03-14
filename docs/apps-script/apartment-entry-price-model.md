# Apartment Entry Price Model

`아파트등록` 입력 자동화에서 가격 조회를 안정적으로 유지하기 위한 정규화 원본과 helper 시트 설계다.

## Goal

- 사람이 관리하는 가격 원본은 작고 읽기 쉽게 유지한다.
- 입력폼 조회는 exact lookup 한 번으로 끝나게 만든다.
- `아파트` 원본 시트와 AppSheet 스키마는 바꾸지 않는다.
- `분양가_동층별`의 자유형 문자열 문제를 helper 빌드 단계에서 흡수한다.

## Non-Goal

- 1차에서 `분양가_source`를 곧바로 운영 조회 원본으로 교체하지 않는다.
- 1차에서 납부일정표, 견적서, PDF 생성을 같이 넣지 않는다.
- 1차에서 옵션 상호배타 규칙까지 모델링하지 않는다.

## Placement

가격 정규화 원본과 helper는 같은 워크북 안에 둔다.

- `분양가_source`: 사람이 수정하는 시트
- `분양가_helper`: Apps Script가 재생성하는 숨김 시트
- `분양가_helper_errors`: helper 생성 실패 원인 기록용 숨김 시트

이 구조를 기본값으로 둔다. 이유는 `IMPORTRANGE`를 제거하고, 입력폼 조회와 운영 스크립트를 같은 파일 안에서 닫기 위해서다.

## Why Type-Only Is Not Enough

`타입`만으로 충분한 항목은 있다.

- 면적
- 발코니
- 옵션
- 타입별 템플릿 성격의 설명 항목

하지만 기본 분양가는 `타입`만으로 부족하다. 같은 타입도 `동`, `라인`, `층`에 따라 가격이 달라질 수 있기 때문이다. 따라서 가격은 아래 수준까지는 남겨야 한다.

- `단지`
- `타입`
- `동 그룹`
- `라인 그룹`
- `층 구간`

## Sheet 1: `분양가_source`

사람이 직접 관리하는 원본 시트다. 헤더 순서는 아래로 고정한다.

```text
A  source_id
B  active
C  priority
D  단지ID
E  단지명
F  타입
G  동_raw
H  라인_raw
I  층_from
J  층_to
K  분양가
L  계약금
M  중도금
N  잔금
O  note
```

### Column Rules

- `source_id`
  - 원본 규칙의 고유 ID
  - 수동 입력 또는 스크립트 생성 허용
  - 중복 불가
- `active`
  - `TRUE`면 helper 생성 대상
  - `FALSE`면 무시
- `priority`
  - 숫자가 클수록 우선하지 않는다
  - 숫자가 작을수록 우선한다
  - 같은 helper key가 중복되면 우선순위로 자동 선택하지 않고 실패 처리한다
- `단지ID`
  - 가능하면 필수
  - 조회 키는 `단지ID` 기준을 우선 사용한다
- `단지명`
  - 사람이 읽고 찾기 위한 값
  - `단지ID`가 비어 있는 기존 데이터 호환을 위해 보조로 유지
- `타입`
  - exact match 기준 문자열
  - 입력폼의 `타입` 값과 동일한 정규형을 사용한다
- `동_raw`
  - 자유형 입력 허용
  - 예시: `101~104동`, `101동 103동`, `101~104동 106~109동`
- `라인_raw`
  - 자유형 입력 허용
  - 예시: `1,3,4호`, `01,02`, `1~3호`
  - 비어 있으면 해당 규칙은 helper로 펼치지 않는다
- `층_from`, `층_to`
  - 정수
  - `층_to`가 비어 있으면 `층_from`과 동일 처리
- `분양가`, `계약금`, `중도금`, `잔금`
  - 숫자
  - 빈 값 허용
- `note`
  - 운영 메모

## Sheet 2: `분양가_helper`

입력폼 조회 전용 시트다. 사람이 직접 수정하지 않는다. 헤더 순서는 아래로 고정한다.

```text
A  helper_key
B  source_id
C  단지ID
D  단지명
E  타입
F  동
G  층
H  라인
I  분양가
J  계약금
K  중도금
L  잔금
M  source_row
N  generated_at
```

### Helper Key

`helper_key`는 아래 포맷으로 고정한다.

```text
단지ID|타입|동|라인|층
```

`단지ID`가 비어 있는 예외 호환이 꼭 필요할 때만 아래 fallback을 허용한다.

```text
단지명|타입|동|라인|층
```

운영 기준은 `단지ID`를 채우는 쪽으로 맞춘다.

## Sheet 3: `분양가_helper_errors`

helper 빌드 실패 원인 기록용 시트다. 헤더 순서는 아래로 고정한다.

```text
A  error_type
B  source_id
C  source_row
D  detail
E  conflicting_key
F  conflicting_source_id
G  logged_at
```

## Parse Rules

`rebuildPriceHelper()`는 `분양가_source`를 읽고 아래 규칙으로 값을 정규화한다.

### `동_raw`

- 공백은 모두 제거한다.
- `동` 접미사는 제거 후 숫자만 추출한다.
- 구분자는 공백과 쉼표를 모두 허용한다.
- `101~104동`은 `101,102,103,104`로 펼친다.
- `101동103동`처럼 붙어 들어오면 허용하지 않는다.
- 숫자 범위를 만들 수 없는 토큰은 오류로 기록하고 해당 row 빌드를 중단한다.

### `라인_raw`

- 공백은 모두 제거한다.
- `호` 접미사는 제거한다.
- `1,3,4호`는 `01,03,04`로 정규화한다.
- `1~3호`는 `01,02,03`으로 펼친다.
- 모든 라인은 두 자리 문자열로 저장한다.
- `라인_raw`를 비워 둔 상태로 helper 생성은 허용하지 않는다.

### `층_from`, `층_to`

- 둘 다 숫자여야 한다.
- `층_to`가 비어 있으면 `층_from`과 동일 처리한다.
- `층_from > 층_to`면 오류 처리한다.
- helper에는 각 층을 개별 row로 펼친다.

### `타입`

- trim 후 exact match 기준으로 사용한다.
- `84A`, `84 A`, `84a`처럼 입력되는 경우를 허용할지 여부는 helper 빌드에서 임의 보정하지 않는다.
- 즉, 타입 정규화는 별도 전처리 정책 없이 원본 값 그대로 맞춘다.

## Build Algorithm

`rebuildPriceHelper()`는 아래 순서로 동작한다.

1. `분양가_source` 시트를 읽는다.
2. 헤더가 명세와 일치하는지 검증한다.
3. `active = TRUE`인 row만 대상에 넣는다.
4. 각 row의 `동_raw`, `라인_raw`, `층_from`, `층_to`를 파싱한다.
5. `동 x 라인 x 층`의 카티전 곱으로 helper row를 메모리에서 생성한다.
6. `helper_key` 중복 여부를 검사한다.
7. 오류가 하나라도 있으면 `분양가_helper`는 덮어쓰지 않고 `분양가_helper_errors`만 갱신한다.
8. 오류가 없을 때만 `분양가_helper` 전체를 일괄 재작성한다.
9. 마지막에 `generated_at`을 같은 시각으로 채운다.

## Duplicate Policy

같은 `helper_key`가 둘 이상 생성되면 자동 우선순위 선택을 하지 않는다. 반드시 실패 처리한다.

이 정책을 고정하는 이유는 다음과 같다.

- 가격 충돌을 조용히 덮어쓰는 순간 운영 오류를 찾기 어렵다.
- `priority`는 향후 진단과 정렬 참고용일 뿐, 현재는 충돌 자동해결에 쓰지 않는다.
- 운영자가 `분양가_source`를 직접 고쳐서 충돌을 없애는 쪽이 안전하다.

## Error Types

`분양가_helper_errors`에는 아래 `error_type`만 기록한다.

- `MISSING_REQUIRED`
- `INVALID_DONG_TOKEN`
- `INVALID_LINE_TOKEN`
- `INVALID_FLOOR_RANGE`
- `DUPLICATE_SOURCE_ID`
- `DUPLICATE_HELPER_KEY`
- `MISSING_KEY_PART`

## Lookup Contract For Entry Form

입력폼은 helper만 조회한다. 조회 입력값은 아래 순서로 정규화한다.

1. `단지ID`
2. `타입`
3. `동`
4. `호`에서 `층`, `라인` 추출

`호` 파싱 규칙은 다음으로 고정한다.

- 마지막 두 자리를 `라인`으로 본다.
- 나머지 앞자리를 `층`으로 본다.
- 예시
  - `1203` -> `층=12`, `라인=03`
  - `2301` -> `층=23`, `라인=01`

즉, 입력폼은 `호`를 그대로 helper에 넣지 않고 `층`과 `라인`으로 분해해서 조회한다.

## Apps Script Functions

가격 helper 전환 단계에서 필요한 함수는 아래로 고정한다.

- `rebuildPriceHelper()`
- `showPriceHelperDiagnostics()`
- `lookupPriceFromHelper_(complexId, typeName, dong, ho)`
- `parseDongTokens_(dongRaw)`
- `parseLineTokens_(lineRaw)`
- `parseFloorRange_(fromValue, toValue)`
- `buildHelperKey_(complexIdOrName, typeName, dong, line, floor)`

## Performance Rules

- helper 생성은 row 단위 `setValue()`를 금지한다.
- 전체 결과를 배열로 만든 뒤 `setValues()` 한 번으로 쓴다.
- 에러가 있으면 helper 본문은 유지하고 errors 시트만 갱신한다.
- helper row 수가 커져도 조회는 exact lookup이므로 입력폼 쪽 비용은 낮다.

## Migration Plan

### Phase 1

- `아파트등록 -> 아파트` 저장 자동화 먼저 완성
- 가격 조회는 기존 `분양가` exact lookup 유지

### Phase 2

- `분양가_source` 시트 생성
- `rebuildPriceHelper()` 구현
- helper와 기존 `분양가` 결과를 샘플 단지 기준으로 비교 검증

### Phase 3

- 입력폼 가격 조회 원본을 `분양가_helper`로 교체
- 기존 `분양가`는 fallback 또는 비교용으로만 유지

## Exit Criteria

아래 조건을 만족하면 helper 전환 준비가 끝난 것으로 본다.

- `분양가_source` 헤더가 고정되어 있다.
- 자유형 `동_raw`, `라인_raw`를 helper로 안정적으로 펼칠 수 있다.
- 중복 key 충돌이 실패로 드러난다.
- `아파트등록` 입력값에서 `호 -> 층/라인` 분해 규칙이 고정돼 있다.
- helper 조회 결과가 기존 `분양가`와 샘플 검증에서 일치한다.
