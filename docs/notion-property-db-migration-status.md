# Notion Property DB Migration Status

Last updated: 2026-03-14

## Completed

- `factory` -> `공장창고_앱시트DB` / `공장창고`
  - Notion view: `migration_공장창고`
  - View URL: `https://www.notion.so/muxmu/1203bf547d538064807df8d341f55da3?v=3223bf547d5381bbb575000c031c14e9`
  - Result: 3 rows upserted, duplicate append 없이 반영 완료

- `land` -> `토지_앱시트DB` / `토지`
  - Notion views:
    - `migration_토지_입력완료`
    - `migration_토지_미입력`
  - View URLs:
    - `https://www.notion.so/muxmu/a32b02cd379d4d8297d2449fd5c3160b?v=3223bf547d5381f28d93000ca079a2e8`
    - `https://www.notion.so/muxmu/a32b02cd379d4d8297d2449fd5c3160b?v=3223bf547d538153a131000c1cb0a450`
  - Result: 34 rows 기준 full sync 완료
  - Note:
    - 기존 레거시 1행과 신규 append가 겹쳐서 중복 1행 삭제 후 재동기화 완료
    - Notion 검색에 없는 시트 레거시 1행(`남관리 229-15`) 삭제 완료

- `house` -> `주택_앱시트DB` / `주택`
  - Result: Notion 최신 115건 기준 upsert 완료
  - Write result: `matched=115`, `appended=0`
  - Note:
    - `접수자`가 비어 있는 경우 `Owner` relation fallback으로 보강
    - 시트 레거시 행 정리는 아직 별도 검토 필요

- `store` -> `빌딩_상가_원투룸_앱시트DB` / `상가`
  - Raw source: 지역/날짜 shard 20개 병합 (`/tmp/store_all.json`, 477 rows)
  - Result: lookup 기반 upsert 완료
  - Write result: `matched=181`, `appended=296`
  - Note:
    - 건물 relation 38개를 별도 lookup으로 보강
    - 기존 시트 `거래유형`이 `월세/임대/빈값`으로 섞여 있어 natural key에 `건물명|호수` fallback 추가
    - stale row 삭제는 아직 미적용

- `room` -> `빌딩_상가_원투룸_앱시트DB` / `원투룸`
  - Raw source: `/tmp/room_sync.json` (27 rows)
  - Result: lookup 기반 upsert 완료
  - Write result: `matched=2`, `appended=25`
  - Note:
    - 배치 내부 중복 natural key가 있어 신규 append row를 재매칭할 수 있게 upsert 버그 수정
    - 현재 확보한 Notion payload가 27건이라 stale row 삭제는 보류

- `apartment_complex` -> `아파트_앱시트DB` / `아파트단지`
  - Raw source:
    - `/tmp/apartment_complex_input_done_sync.json`
    - `/tmp/apartment_complex_not_input_sync.json`
    - merged `/tmp/apartment_complex_all_raw.json` (62 rows)
  - Result: Notion 최신 62건 기준 strict sync 완료
  - Write result: `matched=39`, `appended=23`
  - Note:
    - lookup 정규화 후 stale/중복 레거시 31행 삭제
    - 현재 시트 상태: `rows=62`, `blank_id=0`, `dup_ids=0`, `dup_natural=0`

- `apartment_type` -> `아파트_앱시트DB` / `타입`
  - Raw source: `/tmp/apartment_type_sync.json` (100 rows)
  - Result: lookup 기반 upsert 완료
  - Write result: `matched=56`, `appended=44`
  - Note:
    - 현재 확보한 Notion payload가 `has_more=true` 상태라 partial sync 가능성 있음
    - 시트 자체에 `ID` 컬럼은 없음

- `apartment_schedule` -> `아파트_앱시트DB` / `단지일정`
  - Raw source:
    - `/tmp/apartment_schedule_pre2023.json`
    - `/tmp/apartment_schedule_2023_2024.json`
    - `/tmp/apartment_schedule_2025.json`
    - `/tmp/apartment_schedule_2026p.json`
    - `/tmp/apartment_schedule_not_input.json`
    - merged `/tmp/apartment_schedule_all.json` (254 rows)
  - Result: lookup 기반 upsert 완료
  - Write result: `matched=21`, `appended=233`
  - Note:
    - 현재 merge source 일부가 `has_more=true`라 full sync 보장은 아직 안 됨
    - 현재 시트 상태: `dup_natural=6`
    - 시트 자체에 `ID` 컬럼은 없음

- `building` -> `빌딩_상가_원투룸_앱시트DB` / `건물`
  - Raw source: `/tmp/building_all_raw_for_attachments.json` (131 rows)
  - Result: lookup 기반 upsert 완료
  - Write result: `matched=95`, `appended=36`
  - Note:
    - 이 raw 세트는 attachment sync용 partial export 기반이라 stale row 삭제는 보류
    - 현재 시트 상태: `blank_id=0`, `dup_ids=0`

## Implemented Tooling

- Script: [migrate_notion_property_dbs_to_sheets.py](/Users/cao25/Projects/property-workspace-automation/scripts/migrate_notion_property_dbs_to_sheets.py)
- Attachment sync: [sync_notion_property_attachments_to_drive.py](/Users/cao25/Projects/property-workspace-automation/scripts/sync_notion_property_attachments_to_drive.py)
- Current behavior:
  - Notion row URL 기반 deterministic `ID` 생성
  - 시트별 `D_*_ID` 생성
  - 기존 `관련파일`, `폴더ID` 보존
  - 기존 `고객`, `접수자`, `접수일`, `단지ID`, `폴더ID`, `관련파일` 공란 덮어쓰기 방지
  - grid row/column 자동 확장
  - dataset별 fallback natural key로 레거시 행까지 흡수
  - 첨부파일은 기존 `폴더ID`가 있는 행만 Drive 업로드

## Matching Notes

- `factory`
  - primary: `시군구|동읍면|통반리|지번|명칭|거래유형`
  - fallback:
    - `시군구|동읍면|통반리|지번|건축물용도|거래유형`
    - `시군구|동읍면|통반리|지번|건축물용도`

- `land`
  - primary: `시군구|동읍면|통반리|지번|토지분류|거래유형`
  - fallback:
    - `시군구|동읍면|통반리|지번|토지분류`
    - `시군구|동읍면|통반리|지번|용도지역|지목`

- `store`
  - primary: `건물명|호수|거래유형`
  - fallback:
    - `건물명|호수`

## Pending

- `apartment`

## Attachment Sync

- Completed attempts
  - `land`: 5 rows matched, but all 5 downloads failed on current signed URLs
  - `factory`: 3 rows matched, 2건은 `attachment:` 타입이라 미지원, 1건은 download fail
  - `store`: 16 rows matched, `uploaded=1`, `failed_downloads=4`, `unsupported=1`, `missing_folders=10`
  - `building`: 34 rows with attachments in raw set, `matched_rows=19`, but all 21 direct downloads failed
  - `apartment_complex`: 47 rows with attachments, `matched_rows=29`, `uploaded=0`, `failed_downloads=42`, `unsupported=25`, `missing_sheet_rows=18`

- Additional notes
  - `store`와 `building` 첨부 컬럼 매핑을 스크립트에 추가함
  - `prod-files-secure.s3...` URL은 dry-run 기준으로는 후보 산출이 되지만, 실제 다운로드 시점에는 만료 또는 접근 거부로 실패하는 케이스가 많음
  - `attachment:` 형태 source 는 현재 스크립트로 직접 다운로드 불가

## Known Constraint

- Notion MCP `query-database-view`는 row 수 또는 출력 길이가 커지면 한 번에 다루기 어렵다.
- 남은 DB는 `입력완료`, `행정구역`, 또는 다른 안정적인 속성 기준으로 split view를 만든 뒤 같은 스크립트에 `normalized` 또는 `raw + lookup` 형태로 넣는 방식으로 진행한다.
- `apartment` 본매물은 현재 Notion MCP query 결과가 출력 길이 제한에 걸려 raw payload를 안전하게 저장하기 어렵다.
- `apartment_type`, `apartment_schedule`, `building`은 현재 확보 raw가 partial일 수 있어 stale row 삭제를 아직 적용하지 않았다.
