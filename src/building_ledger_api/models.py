from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class LookupRequest(BaseModel):
    address: str = Field(min_length=2)
    force_refresh: bool = False


class CodeParts(BaseModel):
    sigungu_code: str
    bdong_code: str
    plat_code: str
    bun: str
    ji: str


class BuildingLedgerData(BaseModel):
    regstr_kind_name: str | None = None
    road_address: str | None = None
    plat_area: float | None = None
    arch_area: float | None = None
    bc_ratio: float | None = None
    tot_area: float | None = None
    vl_ratio_estm_tot_area: float | None = None
    vl_ratio: float | None = None
    structure_name: str | None = None
    etc_structure: str | None = None
    seismic_design_yn: str | None = None
    seismic_ability: str | None = None
    use_approval_day: str | None = None


class LookupResponse(BaseModel):
    success: bool = True
    input_address: str
    road_address: str
    pnu: str
    codes: CodeParts
    from_cache: bool
    data: BuildingLedgerData
    raw_item: dict[str, Any]
