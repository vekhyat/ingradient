# pyright: reportPrivateUsage=false
# Transaction hooks intentionally exercise the exclusive writer internals.
from copy import deepcopy
from typing import Any
from uuid import uuid4

import pytest

from app.contract.models import ProductAnalysisInput
from app.learning_store.models import (
    KnownFact,
    PresentObservation,
    StorageError,
    Versions,
    validate_payload,
)
from app.learning_store.serialize import SourceReview, project_product
from app.learning_store.store import LearningStore

FORBIDDEN = [
    "account_id",
    "device_id",
    "session_id",
    "client_address",
    "ip",
    "email",
    "inputDigest",
    "request_id",
    "profile",
    "photos",
    "image_path",
    "behaviour",
    "personal_grade",
    "terms_receipt",
    "user_agent",
    "sourceIds",
    "extra",
]


@pytest.mark.parametrize("key", FORBIDDEN)
@pytest.mark.parametrize(
    "level", ["product", "source", "observation", "facts", "versions"]
)
def test_forbidden_keys_reject_before_connection(
    payload: dict[str, Any], key: str, level: str
):
    target = {
        "product": payload,
        "source": payload["source_refs"][0],
        "observation": payload["observations"][0],
        "facts": payload["scoring_facts"],
        "versions": payload["versions"],
    }[level]
    target[key] = "synthetic forbidden"

    def no_connection():
        pytest.fail("invalid payload opened DB")

    store = LearningStore(no_connection, collection_enabled=lambda: True)
    with pytest.raises(StorageError, match="^storage_invalid$"):
        store.ingest(payload, record_id=uuid4(), sent_and_connected=lambda: True)


@pytest.mark.parametrize(
    "key",
    [
        "source_refs",
        "observations",
        "scoring_facts",
        "versions",
        "market",
        "category",
        "declared_category",
        "issue_codes",
    ],
)
def test_missing_required(payload: dict[str, Any], key: str):
    del payload[key]
    with pytest.raises(StorageError):
        validate_payload(payload)


@pytest.mark.parametrize(
    "value", [True, "1", -1, float("nan"), float("inf"), float("-inf")]
)
def test_numeric_rejections(payload: dict[str, Any], value: Any):
    payload["observations"][0]["value"] = value
    with pytest.raises(StorageError):
        validate_payload(payload)


@pytest.mark.parametrize(
    "mutation",
    [
        "dangling",
        "duplicate",
        "unknown_with_sources",
        "partial_facts",
        "unsupported_field",
        "wrong_unit",
        "uncertain_without_issue",
        "corrected_without_previous",
        "unreviewed_off",
        "contradiction",
    ],
)
def test_nested_invariants(payload: dict[str, Any], mutation: str):
    obs = payload["observations"][0]
    if mutation == "dangling":
        obs["source_ids"] = [str(uuid4())]
    elif mutation == "duplicate":
        obs["source_ids"] *= 2
    elif mutation == "unknown_with_sources":
        payload["scoring_facts"]["cheese"]["source_ids"] = obs["source_ids"]
    elif mutation == "partial_facts":
        del payload["scoring_facts"]["cheese"]
    elif mutation == "unsupported_field":
        obs["field"] = "arbitrary_nutrient"
    elif mutation == "wrong_unit":
        obs["unit"] = "kJ"
    elif mutation == "uncertain_without_issue":
        obs["kind"] = "uncertain"
    elif mutation == "corrected_without_previous":
        obs["kind"] = "corrected"
    elif mutation == "unreviewed_off":
        payload["source_refs"][0]["kind"] = "off"
    else:
        payload["scoring_facts"]["plainWater"] = {
            "state": "present",
            "source_ids": obs["source_ids"],
        }
    with pytest.raises(StorageError):
        validate_payload(payload)


def test_missing_not_zero_and_optional_facts(payload: dict[str, Any]):
    payload["category"] = "unknown"
    payload["scoring_facts"] = None
    payload["observations"][0] = {
        "observation_id": str(uuid4()),
        "field": "sugars",
        "kind": "missing",
        "reason": "not_declared",
        "issue_codes": [],
        "derivation_codes": [],
    }
    checked = validate_payload(payload)
    assert "value" not in checked.observations[0].model_dump()
    assert checked.scoring_facts is None
    assert checked.declared_category == "general"


def test_projection_remaps_all_sources_and_drops_free_text(payload: dict[str, Any]):
    wire = ProductAnalysisInput.model_validate(
        {
            "barcode": "12345678",
            "name": "Synthetic",
            "market": "IN",
            "ingredientsText": None,
            "ingredientsStatus": "missing",
            "category": "general",
            "sourceRefs": [
                {"id": "src-1", "kind": "label", "title": "Nutrition panel"},
                {"id": "src-2", "kind": "user_correction", "title": "User correction"},
            ],
            "observations": [
                {
                    "field": "sugars",
                    "kind": "corrected",
                    "value": 0,
                    "unit": "g",
                    "basis": "per_100_g",
                    "sourceIds": ["src-2"],
                    "previousSourceIds": ["src-1"],
                    "issues": [],
                    "derivation": ["private note"],
                }
            ],
            "scoringFacts": {
                "categorySourceIds": ["src-1"],
                "cheese": {"state": "absent", "sourceIds": ["src-1"]},
                "redMeat": {"state": "unknown"},
                "plainWater": {"state": "unknown"},
                "nonNutritiveSweetener": {"state": "unknown"},
            },
            "issues": [],
        }
    )
    checked = project_product(
        wire,
        Versions.model_validate(payload["versions"]),
        lambda _: SourceReview(rights_state="eligible"),
    )
    again = project_product(
        wire,
        Versions.model_validate(payload["versions"]),
        lambda _: SourceReview(rights_state="eligible"),
    )
    assert checked.source_refs[0].source_id != again.source_refs[0].source_id
    assert isinstance(checked.observations[0], PresentObservation)
    assert checked.scoring_facts is not None
    assert isinstance(checked.scoring_facts.cheese, KnownFact)
    assert checked.observations[0].source_ids == [checked.source_refs[1].source_id]
    assert checked.observations[0].previous_source_ids == [
        checked.source_refs[0].source_id
    ]
    assert checked.scoring_facts.cheese.source_ids == [checked.source_refs[0].source_id]
    raw = checked.model_dump_json()
    assert "src-" not in raw and "private note" not in raw
    assert '"unsupported"' in raw
    assert checked.observations[0].value == 0
    bad = deepcopy(payload)
    bad["observations"] *= 101
    with pytest.raises(StorageError):
        validate_payload(bad)
