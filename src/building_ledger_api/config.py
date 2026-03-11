from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    vworld_api_key: str
    data_go_kr_service_key: str
    request_timeout_seconds: float
    retry_count: int
    retry_backoff_seconds: float
    cache_db_path: Path
    cache_ttl_days: int
    api_token: str | None

    @classmethod
    def load(cls) -> "Settings":
        # Load .env from the standalone repository root.
        project_root = Path(__file__).resolve().parents[2]
        env_path = project_root / ".env"
        if env_path.exists():
            load_dotenv(env_path)

        vworld_api_key = os.getenv("VWORLD_API_KEY", "").strip()
        data_go_kr_service_key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()

        if not vworld_api_key:
            raise ValueError("VWORLD_API_KEY is required")
        if not data_go_kr_service_key:
            raise ValueError("DATA_GO_KR_SERVICE_KEY is required")

        cache_db = os.getenv("CACHE_DB_PATH", "data/cache/ledger_cache.sqlite3").strip()

        return cls(
            vworld_api_key=vworld_api_key,
            data_go_kr_service_key=data_go_kr_service_key,
            request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "15")),
            retry_count=int(os.getenv("RETRY_COUNT", "3")),
            retry_backoff_seconds=float(os.getenv("RETRY_BACKOFF_SECONDS", "1.5")),
            cache_db_path=project_root / cache_db,
            cache_ttl_days=int(os.getenv("CACHE_TTL_DAYS", "30")),
            api_token=os.getenv("LEDGER_API_TOKEN", "").strip() or None,
        )
