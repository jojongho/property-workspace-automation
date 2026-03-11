from __future__ import annotations

from typing import Any

from .cache import LedgerCache
from .clients import BuildingHubClient, VworldClient, split_pnu
from .config import Settings


class LedgerLookupService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cache = LedgerCache(settings.cache_db_path)
        self.vworld = VworldClient(settings)
        self.building_hub = BuildingHubClient(settings)

    def lookup(self, address: str, force_refresh: bool = False) -> dict[str, Any]:
        geocoded = self.vworld.geocode_address(address)
        pnu = geocoded["pnu"]
        codes = split_pnu(pnu)

        if not force_refresh:
            cached = self.cache.get(pnu, ttl_days=self.settings.cache_ttl_days)
            if cached:
                cached["from_cache"] = True
                return cached

        fetched = self.building_hub.get_title_info(codes)
        item = fetched["item"]

        result = {
            "success": True,
            "input_address": address,
            "road_address": geocoded["road_address"],
            "pnu": pnu,
            "codes": codes,
            "from_cache": False,
            "data": {
                "regstr_kind_name": item.get("regstrKindCdNm"),
                "road_address": item.get("newPlatPlc") or geocoded["road_address"],
                "plat_area": _to_float(item.get("platArea")),
                "arch_area": _to_float(item.get("archArea")),
                "bc_ratio": _to_float(item.get("bcRat")),
                "tot_area": _to_float(item.get("totArea")),
                "vl_ratio_estm_tot_area": _to_float(item.get("vlRatEstmTotArea")),
                "vl_ratio": _to_float(item.get("vlRat")),
                "structure_name": item.get("strctCdNm"),
                "etc_structure": item.get("etcStrct") or item.get("strctCd"),
                "seismic_design_yn": item.get("rserthqkDsgnApplyYn") or item.get("rgnlLmtSe"),
                "seismic_ability": item.get("rserthqkAblty") or item.get("rgnlLmtSe"),
                "use_approval_day": item.get("useAprDay"),
            },
            "raw_item": item,
        }

        self.cache.set(pnu, result)
        return result


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
