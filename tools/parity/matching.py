"""Pinned exact-identity fixture and export validation for both runtimes."""

import hashlib
import json
import sys
from pathlib import Path
from typing import Annotated, Any, Literal, Self

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from pydantic import BaseModel, ConfigDict, Field, model_validator  # noqa: E402


class Match(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    state: Literal["matched", "ambiguous", "unresolved"]
    canonicalId: str | None
    candidateIds: list[str]

    @model_validator(mode="after")
    def identity_is_consistent(self) -> Self:
        if len(self.candidateIds) != len(set(self.candidateIds)):
            raise ValueError("duplicate candidate identity")
        if self.state == "matched":
            if self.canonicalId is None or self.candidateIds != [self.canonicalId]:
                raise ValueError("matched identity must name its sole candidate")
        elif self.state == "ambiguous":
            if self.canonicalId is not None or len(self.candidateIds) < 2:
                raise ValueError("ambiguous identity needs multiple candidates")
        elif self.canonicalId is not None or self.candidateIds:
            raise ValueError("exact unresolved identity cannot have candidates")
        return self

    def comparison(self) -> dict[str, Any]:
        return {**self.model_dump(), "candidateIds": sorted(self.candidateIds)}


class MatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str
    additiveContext: bool


class Vector(BaseModel):
    # Source references/rationale are authoring evidence, not matcher inputs.
    model_config = ConfigDict(extra="ignore", strict=True)
    id: Annotated[str, Field(min_length=1)]
    input: MatchInput
    expected: Match


class Export(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: Annotated[str, Field(min_length=1)]
    scope: Literal["exact-matching"]
    match: Match


def pinned_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or Path(relative).is_absolute():
        raise ValueError("resource path escapes resource root")
    return path


def load_fixture(
    resource_root: Path, vectors_path: Path | None = None
) -> tuple[str, list[Vector]]:
    manifest = json.loads((resource_root / "manifest.json").read_text(encoding="utf-8"))
    bundles = manifest["bundles"]
    by_id = {bundle["bundleId"]: bundle for bundle in bundles}
    if len(by_id) != len(bundles):
        raise ValueError("duplicate manifest bundle id")
    bundle = by_id["off-exact-match-vectors"]
    raw = (vectors_path or pinned_path(resource_root, bundle["path"])).read_bytes()
    if (
        hashlib.sha256(raw).hexdigest() != bundle["sha256"]
        or len(raw) != bundle["sizeBytes"]
    ):
        raise ValueError("match fixture hash/size differs from manifest")
    fixture = json.loads(raw)
    if (
        type(fixture["schemaVersion"]) is not int
        or fixture["schemaVersion"] != 1
        or fixture["profile"] != "exact-identity"
    ):
        raise ValueError("unsupported matching fixture profile/version")
    edition = fixture["edition"]
    if not isinstance(edition, str) or not edition:
        raise ValueError("missing matching edition")
    pins = fixture["sourcePins"]
    if {pin["bundleId"] for pin in pins} != {
        "off-taxonomy-ingredients",
        "off-taxonomy-additives",
    } or len(pins) != 2:
        raise ValueError("matching requires both distinct taxonomy pins")
    for pin in pins:
        source = by_id[pin["bundleId"]]
        if any(pin[key] != source[key] for key in ("path", "sha256", "sizeBytes")):
            raise ValueError("matching source pin differs from manifest")
        raw_source = pinned_path(resource_root, source["path"]).read_bytes()
        if (
            hashlib.sha256(raw_source).hexdigest() != source["sha256"]
            or len(raw_source) != source["sizeBytes"]
        ):
            raise ValueError("matching taxonomy hash/size differs from pin")
    vectors = [Vector.model_validate(value) for value in fixture["vectors"]]
    if not vectors or len({vector.id for vector in vectors}) != len(vectors):
        raise ValueError("empty or repeated matching vector set")
    return edition, vectors


def load_export(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        record = Export.model_validate_json(line)
        if record.id in records:
            raise ValueError("duplicate matching vector id")
        records[record.id] = record.match.comparison()
    return records
