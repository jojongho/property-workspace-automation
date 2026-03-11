PYTHON ?= python3
VENV ?= .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn

.PHONY: venv install run check lookup clean

venv:
	@test -d $(VENV) || $(PYTHON) -m venv $(VENV)

install: venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

run: install
	$(UVICORN) building_ledger_api.main:app --app-dir src --host $${HOST:-0.0.0.0} --port $${PORT:-8080} --reload

check: install
	$(PY) -m compileall src scripts

lookup: install
	@test -n "$(ADDRESS)" || (echo "ADDRESS is required. Example: make lookup ADDRESS='충청남도 천안시 서북구 불당동 1329'" && exit 1)
	$(PY) scripts/lookup_once.py --address "$(ADDRESS)"

clean:
	rm -rf $(VENV)
