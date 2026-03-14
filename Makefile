PYTHON ?= python3
VENV ?= .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python

.PHONY: venv install check run clean

venv:
	@test -d $(VENV) || $(PYTHON) -m venv $(VENV)

install: venv
	$(PIP) install --upgrade pip
	@if [ -s requirements.txt ]; then $(PIP) install -r requirements.txt; fi

check: install
	$(PY) -m py_compile scripts/*.py
	$(PY) -m unittest discover -s tests
	node --check apps-script/apartment-entry-automation/price-helper.js
	node --check apps-script/property-folder-automation/g-drive-folder-create.js
	node --check apps-script/property-folder-automation/g-drive-folder.js

run:
	@echo "No persistent server in this repo."
	@echo "Use Apps Script deployment helpers or migration scripts directly."

clean:
	rm -rf $(VENV)
