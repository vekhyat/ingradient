"""Explicit wire-to-storage projection. The temporary src-N map never leaves here."""

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

from app.contract.models import ProductAnalysisInput, ProductInputSource

from .models import (
    ProductPayload,
    Source,
    StorageError,
    StrictModel,
    Versions,
    validate_payload,
)


class SourceReview(StrictModel):
    rights_state: str
    rights_reference: UUID | None = None


def remap_payload(payload: ProductPayload) -> ProductPayload:
    """Fresh source and observation IDs for each deliberately curated copy/side."""
    raw = payload.model_dump(mode="json", exclude_unset=True)
    mapping = {source["source_id"]: str(uuid4()) for source in raw["source_refs"]}
    for source in raw["source_refs"]:
        source["source_id"] = mapping[source["source_id"]]
    for obs in raw["observations"]:
        obs["observation_id"] = str(uuid4())
        for key in ("source_ids", "previous_source_ids"):
            if key in obs:
                obs[key] = [mapping[s] for s in obs[key]]
    facts = raw["scoring_facts"]
    if facts is not None:
        facts["category_source_ids"] = [
            mapping[s] for s in facts["category_source_ids"]
        ]
        for key in ("cheese", "redMeat", "plainWater", "nonNutritiveSweetener"):
            if "source_ids" in facts[key]:
                facts[key]["source_ids"] = [
                    mapping[s] for s in facts[key]["source_ids"]
                ]
    return validate_payload(raw)


def project_product(
    product: ProductAnalysisInput,
    versions: Versions,
    review_source: Callable[[ProductInputSource], SourceReview],
) -> ProductPayload:
    """Rights review and product classification are trusted server policy inputs."""
    mapping = {source.id: uuid4() for source in product.sourceRefs}
    sources = []
    for source in product.sourceRefs:
        review = review_source(source)
        row: dict[str, Any] = {
            "source_id": mapping[source.id],
            "kind": source.kind,
            "title": source.title,
            "rights_state": review.rights_state,
        }
        if source.edition is not None:
            row["edition"] = source.edition
        if review.rights_reference is not None:
            row["rights_reference"] = review.rights_reference
        sources.append(Source.model_validate(row))
    observations: list[dict[str, Any]] = []
    for obs in product.observations:
        if obs.field not in {
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
        }:
            raise StorageError("storage_unsupported_nutrient")
        row: dict[str, Any] = {
            "observation_id": uuid4(),
            "field": obs.field,
            "kind": obs.kind,
            "issue_codes": [i.code for i in obs.issues],
            "derivation_codes": [],
        }
        if obs.kind == "missing":
            row["reason"] = obs.reason
        else:
            if obs.unit != {"energy": "kJ", "fvl": "percent"}.get(obs.field, "g"):
                raise StorageError("storage_unsupported_nutrient")
            row.update(
                value=obs.value,
                unit=obs.unit,
                basis=obs.basis,
                source_ids=[mapping[s] for s in obs.sourceIds],
            )
            allowed = {
                "declared",
                "kcal_to_kj",
                "sodium_to_salt",
                "serving_conversion",
                "manual_correction",
                "unsupported",
            }
            row["derivation_codes"] = [
                d if d in allowed else "unsupported" for d in obs.derivation or []
            ]
            if obs.kind == "corrected":
                row["previous_source_ids"] = [mapping[s] for s in obs.previousSourceIds]
        observations.append(row)
    facts: dict[str, Any] | None = None
    supported = "unknown"
    if product.scoringFacts is not None:
        wire = product.scoringFacts
        facts = {"category_source_ids": [mapping[s] for s in wire.categorySourceIds]}
        for key in ("cheese", "redMeat", "plainWater", "nonNutritiveSweetener"):
            fact = getattr(wire, key)
            facts[key] = (
                {"state": "unknown"}
                if fact.state == "unknown"
                else {
                    "state": fact.state,
                    "source_ids": [mapping[s] for s in fact.sourceIds],
                }
            )
        if wire.categorySourceIds:
            supported = product.category
    return validate_payload(
        {
            "barcode": product.barcode,
            "product_name": product.name,
            "market": product.market,
            "ingredients_text": product.ingredientsText,
            "ingredients_status": product.ingredientsStatus,
            "declared_category": product.category,
            "category": supported,
            "source_refs": [
                s.model_dump(mode="json", exclude_unset=True) for s in sources
            ],
            "observations": observations,
            "scoring_facts": facts,
            "issue_codes": [i.code for i in product.issues],
            "versions": versions.model_dump(mode="json", exclude_unset=True),
        }
    )
