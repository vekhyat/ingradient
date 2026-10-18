"""ADR014 format 1. No request/response or contributor metadata is a storage DTO."""

import json
import math
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.functional_validators import BeforeValidator

from app.contract.models import Category, Market

Code = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_.]{0,79}$")]
Token = Annotated[str, Field(min_length=1, max_length=160)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Edition = Annotated[
    str,
    Field(
        pattern=(
            r"^(?:rev-[0-9]{1,9}|[0-9]{4}-[0-9]{2}-[0-9]{2}T"
            r"[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$"
        )
    ),
]
Title = Literal[
    "Ingredient panel",
    "Nutrition panel",
    "Combined label photo",
    "Open Food Facts product",
    "User correction",
]
SourceKind = Literal["label", "off", "user_correction"]
Codes = Annotated[list[Code], Field(max_length=100)]
Ids = Annotated[list[UUID], Field(max_length=100)]
NonemptyIds = Annotated[list[UUID], Field(min_length=1, max_length=100)]
Nutrient = Literal[
    "energy",
    "sugars",
    "added_sugars",
    "saturates",
    "salt",
    "sodium",
    "protein",
    "fibre",
    "fat",
    "fvl",
]
Derivation = Literal[
    "declared",
    "kcal_to_kj",
    "sodium_to_salt",
    "serving_conversion",
    "manual_correction",
    "unsupported",
]


class StorageError(ValueError):
    """Only an allowlisted code escapes the storage boundary."""

    def __init__(self, code: str = "storage_invalid") -> None:
        if code not in {
            "storage_invalid",
            "storage_unsupported_nutrient",
            "storage_unavailable",
            "storage_ancestor_blocked",
            "storage_clock_invalid",
            "storage_inputs_invalid",
            "storage_record_unavailable",
            "storage_retry_conflict",
            "storage_review_due",
            "storage_review_required",
            "storage_rights_ineligible",
            "storage_source_revoked",
            "storage_artifact_ineligible",
            "storage_external_replay_required",
            "storage_backup_ineligible",
            "storage_backup_runner_unavailable",
        }:
            code = "storage_invalid"
        super().__init__(code)
        self.code = code


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True, frozen=True)


class Source(StrictModel):
    source_id: UUID
    kind: SourceKind
    title: Title
    edition: Edition | None = None
    rights_state: Literal["unreviewed", "eligible", "restricted", "withdrawn"]
    rights_reference: UUID | None = None

    @model_validator(mode="after")
    def rights(self) -> Self:
        if self.kind == "off" and self.rights_reference is None:
            raise ValueError("OFF requires reviewed rights reference")
        for key in ("edition", "rights_reference"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError("optional source fields must be absent, not null")
        return self


class SourceSelector(StrictModel):
    kind: SourceKind
    rights_reference: UUID
    title: Title | None = None
    edition: Edition | None = None

    @model_validator(mode="after")
    def no_null_selector(self) -> Self:
        for key in ("title", "edition"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError("optional selector fields must be absent")
        return self

    def matches(self, source: Source) -> bool:
        return (
            source.kind == self.kind
            and source.rights_reference == self.rights_reference
            and (self.title is None or source.title == self.title)
            and (
                self.edition is None
                or source.edition is None
                or source.edition == self.edition
            )
        )


def number(value: object) -> int | float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("finite JSON number required")
    return value


class PresentObservation(StrictModel):
    observation_id: UUID
    field: Nutrient
    kind: Literal["read", "uncertain", "corrected"]
    value: Annotated[int | float, BeforeValidator(number), Field(ge=0)]
    unit: Literal["g", "kJ", "percent"]
    basis: Literal["per_100_g", "per_100_ml", "per_serving"]
    source_ids: NonemptyIds
    previous_source_ids: NonemptyIds | None = None
    issue_codes: Codes
    derivation_codes: Annotated[list[Derivation], Field(max_length=12)]

    @model_validator(mode="after")
    def requiredness(self) -> Self:
        expected = {"energy": "kJ", "fvl": "percent"}.get(self.field, "g")
        if self.unit != expected:
            raise ValueError("storage_unsupported_nutrient")
        if (self.kind == "corrected") != (self.previous_source_ids is not None):
            raise ValueError("previous sources only for corrections")
        if self.kind != "corrected" and "previous_source_ids" in self.model_fields_set:
            raise ValueError("previous sources must be absent")
        if self.kind == "uncertain" and not self.issue_codes:
            raise ValueError("uncertain requires issue")
        return self


class MissingObservation(StrictModel):
    observation_id: UUID
    field: Nutrient
    kind: Literal["missing"]
    reason: Literal[
        "not_declared",
        "unreadable",
        "ambiguous",
        "unsupported_basis",
        "conflicting_sources",
        "not_available",
    ]
    issue_codes: Codes
    derivation_codes: Annotated[list[Derivation], Field(max_length=12)]


Observation = Annotated[
    PresentObservation | MissingObservation, Field(discriminator="kind")
]


class UnknownFact(StrictModel):
    state: Literal["unknown"]


class KnownFact(StrictModel):
    state: Literal["present", "absent"]
    source_ids: NonemptyIds


Fact = Annotated[UnknownFact | KnownFact, Field(discriminator="state")]


class Facts(StrictModel):
    category_source_ids: Ids
    cheese: Fact
    redMeat: Fact
    plainWater: Fact
    nonNutritiveSweetener: Fact


class Versions(StrictModel):
    ingestion_policy_version: Token
    contract_version: Literal["0.3.0-draft"]
    server_resource_state: Literal["known", "unavailable"]
    method_id: Token | None = None
    method_edition: Token | None = None
    method_bundle_sha256: Hash | None = None
    taxonomy_version: Token | None = None
    evidence_version: Token | None = None
    client_resource_status: Literal["match", "mismatch", "unavailable"]

    @model_validator(mode="after")
    def resource_identity(self) -> Self:
        keys = (
            "method_id",
            "method_edition",
            "method_bundle_sha256",
            "taxonomy_version",
            "evidence_version",
        )
        if self.server_resource_state == "known":
            if not all(getattr(self, key) is not None for key in keys):
                raise ValueError("complete resource identity required")
        elif any(key in self.model_fields_set for key in keys):
            raise ValueError("unavailable resources have no identities")
        return self


class ProductPayload(StrictModel):
    barcode: Annotated[str, Field(pattern=r"^(?:[0-9]{8}|[0-9]{12,14})$")] | None
    product_name: Annotated[str, Field(max_length=500)] | None
    market: Market
    ingredients_text: Annotated[str, Field(max_length=20000)] | None
    ingredients_status: Literal["complete", "partial", "missing", "unreadable"]
    declared_category: Category | None
    category: Category
    source_refs: Annotated[list[Source], Field(max_length=100)]
    observations: Annotated[list[Observation], Field(max_length=100)]
    scoring_facts: Facts | None
    issue_codes: Codes
    versions: Versions

    @model_validator(mode="after")
    def closure(self) -> Self:
        if self.ingredients_status == "complete" and not (
            self.ingredients_text and self.ingredients_text.strip()
        ):
            raise ValueError("complete ingredients require text")
        defined = {s.source_id for s in self.source_refs}
        if len(defined) != len(self.source_refs):
            raise ValueError("duplicate source")
        obs_ids = [o.observation_id for o in self.observations]
        if len(obs_ids) != len(set(obs_ids)):
            raise ValueError("duplicate observation")
        lists: list[list[UUID]] = []
        for obs in self.observations:
            if isinstance(obs, PresentObservation):
                lists.append(obs.source_ids)
                if obs.previous_source_ids is not None:
                    lists.append(obs.previous_source_ids)
        facts = self.scoring_facts
        if self.category != "unknown" and (
            facts is None or not facts.category_source_ids
        ):
            raise ValueError("supported category requires sources")
        if facts is not None:
            if facts.category_source_ids and self.category == "unknown":
                raise ValueError("category sources require supported category")
            lists.append(facts.category_source_ids)
            present = set()
            for key in ("cheese", "redMeat", "plainWater", "nonNutritiveSweetener"):
                fact = getattr(facts, key)
                if isinstance(fact, KnownFact):
                    lists.append(fact.source_ids)
                    if fact.state == "present":
                        present.add(key)
            if (
                "plainWater" in present
                and present - {"plainWater"}
                or self.category in {"beverage", "fats_nuts_seeds"}
                and present & {"cheese", "redMeat"}
                or self.category in {"general", "fats_nuts_seeds"}
                and "plainWater" in present
            ):
                raise ValueError("contradictory scoring facts")
        for ids in lists:
            if len(ids) != len(set(ids)) or not set(ids) <= defined:
                raise ValueError("source closure")
        raw = self.model_dump(mode="json", exclude_none=True)
        if len(json.dumps(raw, ensure_ascii=False).encode()) > 524288:
            raise ValueError("storage size limit")
        return self


def validate_payload(value: object) -> ProductPayload:
    """Revalidate models too: frozen objects can still contain mutable lists."""
    if isinstance(value, ProductPayload):
        value = value.model_dump(mode="json", exclude_unset=True)
    try:
        return ProductPayload.model_validate(value)
    except ValueError, TypeError, OverflowError:
        raise StorageError() from None
