from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException

from .clients import RequestError
from .config import Settings
from .models import LookupRequest, LookupResponse
from .service import LedgerLookupService

app = FastAPI(title="Building Ledger API", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    settings = Settings.load()
    app.state.settings = settings
    app.state.service = LedgerLookupService(settings)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/lookup", response_model=LookupResponse)
def lookup(
    request: LookupRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> LookupResponse:
    settings: Settings = app.state.settings
    service: LedgerLookupService = app.state.service

    if settings.api_token and x_api_key != settings.api_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        payload = service.lookup(request.address.strip(), force_refresh=request.force_refresh)
    except RequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return LookupResponse(**payload)
