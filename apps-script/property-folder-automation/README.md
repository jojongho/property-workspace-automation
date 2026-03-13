# Property Folder Automation

중앙 Apps Script 프로젝트 하나로 분리된 AppSheet 매물 스프레드시트들의 Drive 폴더를 관리하는 소스다.

## Files

- `appsscript.json`
- `g-drive-folder-create.js`
- `g-drive-folder.js`

## Deployment

```bash
python3 scripts/gws_push_apps_script_project.py --script-id <SCRIPT_ID> --verify
```

## Export

```bash
python3 scripts/gws_export_apps_script_project.py --script-id <SCRIPT_ID> --output-dir /tmp/exported-apps-script
```
