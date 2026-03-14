# Apartment Entry Automation

`아파트등록` 입력시트 재구축용 Apps Script 배포 소스다.

현재 이 디렉토리는 가격 정규화 helper 단계의 기초 함수부터 담는다.

## Files

- `appsscript.json`
- `entry-form.js`
- `price-helper.js`

## Functions

- `LOOKUP_APARTMENT_PRICE(complexId, typeName, dong, ho)`
- `initializePriceModelSheets()`
- `rebuildPriceHelper()`
- `showPriceHelperDiagnostics()`
- `lookupPriceFromHelper_(complexId, typeName, dong, ho)`
- `initializeEntryFormLayout()`
- `refreshTypePanel()`
- `recalculateEntryForm()`
- `loadPropertyIntoForm()`
- `savePropertyFromForm()`
- `resetPropertyForm()`
- `showEntryDiagnostics()`

## Deployment

```bash
python3 scripts/gws_push_apps_script_project.py --script-id <SCRIPT_ID> --verify
```

## Notes

- `분양가_source`는 사람이 직접 수정한다.
- `분양가_helper`, `분양가_helper_errors`는 스크립트가 관리한다.
- 시트 셀에서는 `=LOOKUP_APARTMENT_PRICE(단지ID, 타입, 동, 호)`로 helper 기반 분양가 조회가 가능하다.
- 세부 규칙은 `../../docs/apps-script/apartment-entry-price-model.md`를 따른다.
