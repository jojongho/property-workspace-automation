from __future__ import annotations

import time
from typing import Any
from urllib.parse import unquote

import requests

from .config import Settings


class RequestError(RuntimeError):
    """Raised when external API request fails after retries."""


class VworldClient:
    BASE_URL = "https://api.vworld.kr/req/address"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def geocode_address(self, address: str) -> dict[str, Any]:
        params = {
            "service": "address",
            "request": "getcoord",
            "version": "2.0",
            "crs": "epsg:4326",
            "address": address,
            "refine": "true",
            "simple": "false",
            "format": "json",
            "type": "parcel",
            "key": self.settings.vworld_api_key,
        }
        payload = _request_json_with_retry(
            url=self.BASE_URL,
            params=params,
            timeout=self.settings.request_timeout_seconds,
            retries=self.settings.retry_count,
            backoff=self.settings.retry_backoff_seconds,
            name="vworld",
        )

        status = payload.get("response", {}).get("status")
        if status != "OK":
            raise RequestError(f"Vworld status not OK: {status}")

        pnu = extract_pnu(payload)
        if len(pnu) < 19:
            raise RequestError(f"Invalid PNU extracted: {pnu}")

        result = payload.get("response", {}).get("result", {})
        refined = payload.get("response", {}).get("refined", {})
        road_address = refined.get("text") or result.get("text") or address

        return {
            "pnu": pnu,
            "road_address": road_address,
            "raw": payload,
        }


class BuildingHubClient:
    BASE_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_title_info(self, codes: dict[str, str]) -> dict[str, Any]:
        service_key = normalize_service_key(self.settings.data_go_kr_service_key)
        params = {
            "serviceKey": service_key,
            "sigungu_code": codes["sigungu_code"],
            "bdong_code": codes["bdong_code"],
            "plat_code": codes["plat_code"],
            "bun": codes["bun"],
            "ji": codes["ji"],
            "numOfRows": "1",
            "pageNo": "1",
            "_type": "json",
        }

        payload = _request_json_with_retry(
            url=self.BASE_URL,
            params=params,
            timeout=self.settings.request_timeout_seconds,
            retries=self.settings.retry_count,
            backoff=self.settings.retry_backoff_seconds,
            name="building_hub",
        )

        body = payload.get("response", {}).get("body", {})
        items = body.get("items", {}).get("item")
        if not items:
            raise RequestError("Building HUB returned no item")

        if isinstance(items, list):
            item = items[0]
        else:
            item = items

        return {
            "item": item,
            "raw": payload,
        }


def normalize_service_key(service_key: str) -> str:
    cleaned = service_key.strip()
    if "%" in cleaned:
        return unquote(cleaned)
    return cleaned


def extract_pnu(payload: dict[str, Any]) -> str:
    response = payload.get("response", {})

    # Preferred path from stable Vworld response
    refined = response.get("refined", {})
    structure = refined.get("structure", {})
    level4_lc = structure.get("level4LC")
    if level4_lc and len(level4_lc) >= 19:
        return str(level4_lc)

    # Secondary path
    result = response.get("result", {})
    structure = result.get("structure", {})
    level0 = str(structure.get("level0", ""))
    if level0.isdigit():
        combined = (
            f"{structure.get('level0', '')}{structure.get('level1', '')}"
            f"{structure.get('level2', '')}{structure.get('level4A', '')}"
            f"{structure.get('level4L', '')}{structure.get('detail', '')}"
        )
        if len(combined) >= 19:
            return combined

    # Fallback path used in some sample workflows
    fallback = (
        response.get("result", {})
        .get("featureCollection", {})
        .get("features", [{}])[0]
        .get("properties", {})
        .get("full_nm")
    )
    if fallback and len(str(fallback)) >= 19:
        return str(fallback)

    raise RequestError("Unable to extract PNU from Vworld response")


def split_pnu(pnu: str) -> dict[str, str]:
    if len(pnu) < 19:
        raise ValueError(f"PNU must be at least 19 characters: {pnu}")

    sigungu_code = pnu[0:5]
    bdong_code = pnu[5:10]
    san_flag = pnu[10:11]  # 1: 일반, 2: 산
    bun = pnu[11:15]
    ji = pnu[15:19]

    plat_code = "1" if san_flag == "2" else "0"

    return {
        "sigungu_code": sigungu_code,
        "bdong_code": bdong_code,
        "plat_code": plat_code,
        "bun": bun,
        "ji": ji,
    }


def _request_json_with_retry(
    *,
    url: str,
    params: dict[str, Any],
    timeout: float,
    retries: int,
    backoff: float,
    name: str,
) -> dict[str, Any]:
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # requests/json errors are all operational failures here
            last_error = exc
            if attempt == retries:
                break
            time.sleep(backoff * attempt)

    raise RequestError(f"{name} request failed after {retries} attempts: {last_error}")
