"""``GET /health``. Reads the contract version once. Does not open a database."""

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

_MANIFEST_PATH = Path(__file__).resolve().parents[2] / "contracts" / "MANIFEST.json"


class HealthBody(BaseModel):
    """Wire body for ``GET /health``. Field names match the frozen contract."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    contract_version: str = Field(alias="contractVersion")


def read_contract_version(path: Path = _MANIFEST_PATH) -> str:
    """Return ``contractVersion`` from the frozen manifest.

    The manifest is the only copy of that version. A missing or unusable file
    fails startup instead of inventing a version.
    """

    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise RuntimeError(f"Contract manifest is missing: {path}") from error

    try:
        payload: object = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Contract manifest is not JSON: {path}") from error

    if not isinstance(payload, dict):
        raise RuntimeError(f"Contract manifest must be a JSON object: {path}")

    version = payload.get("contractVersion")
    if not isinstance(version, str) or version == "":
        raise RuntimeError(
            "contracts/MANIFEST.json must contain a non-empty string contractVersion"
        )
    return version


def create_health_router(contract_version: str) -> APIRouter:
    """Build the health route with the version already loaded at startup."""

    router = APIRouter()

    @router.get("/health")
    def read_health() -> HealthBody:
        return HealthBody.model_validate(
            {"status": "ok", "contractVersion": contract_version}
        )

    return router
