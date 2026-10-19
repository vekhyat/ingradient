"""The service runs through the real boundary without database or body logs."""

import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_settings import SettingsConfigDict
from tests.analysis.test_calculator import ROOT, VECTORS
from tests.contract.support import openapi, request_example

from app.analysis import ReferenceAnalysisService, ResourceUnavailable, load_resources
from app.analysis.ingredients import parse_ingredients
from app.analysis.resources import AnalysisResources
from app.contract.models import AnalyzeRequest, ProductAnalysisInput
from app.settings import Settings


class IsolatedSettings(Settings):
    model_config = SettingsConfigDict(
        env_prefix="INGRADIENT_", env_file=None, extra="ignore"
    )


@pytest.fixture(scope="module")
def resources() -> AnalysisResources:
    return load_resources()


def request_payload(
    resources: AnalysisResources, *, adr013: bool = False
) -> dict[str, Any]:
    payload = request_example(openapi())
    payload["resourceCompatibility"] = resources.compatibility
    payload["product"].pop("category", None)
    payload["product"].pop("scoringFacts", None)
    payload["product"].update(
        ingredientsText="Ingredients: salt, sugar",
        ingredientsStatus="complete",
        issues=[],
        sourceRefs=[dict(id="src-0", kind="label", title="Combined label photo")],
    )
    payload["product"]["observations"] = [
        dict(o, kind="read", sourceIds=["src-0"], issues=[])
        for o in VECTORS[0]["inputs"]["observations"]
    ]
    if adr013:
        payload["product"]["category"] = "general"
        payload["product"]["scoringFacts"] = dict(
            categorySourceIds=["src-0"],
            **{
                k: dict(
                    state="present" if v is True or v == "present" else "absent",
                    sourceIds=["src-0"],
                )
                for k, v in VECTORS[0]["inputs"]["flags"].items()
            },
        )
    return payload


def test_current_contract_request_gets_an_honest_gap(
    resources: AnalysisResources,
) -> None:
    payload = request_payload(resources)
    result = ReferenceAnalysisService(resources).assess(
        AnalyzeRequest.model_validate(payload), input_digest="0" * 64
    )
    assert result.scientific.state == "insufficient_data"
    assert any(i.field == "category" for i in result.scientific.issues)
    assert [m.state for m in result.product.ingredients] == ["matched", "matched"]
    assert result.product.taxonomyVersion == resources.taxonomy_version
    assert result.product.evidenceVersion == resources.evidence_version


@pytest.mark.parametrize("kind", ["read", "corrected"])
def test_flagged_observations_cannot_support_a_grade(
    kind: str, resources: AnalysisResources
) -> None:
    payload = request_payload(resources, adr013=True)
    observation = payload["product"]["observations"][0]
    observation["kind"] = kind
    observation["issues"] = [
        dict(
            code="ocr_confidence_low",
            stage="extraction",
            field=observation["field"],
            message="The printed value needs review.",
            action="edit",
        )
    ]
    if kind == "corrected":
        observation["previousSourceIds"] = ["src-0"]
    result = ReferenceAnalysisService(resources).assess(
        AnalyzeRequest.model_validate(payload), input_digest="0" * 64
    )
    assert result.scientific.state == "insufficient_data"
    assert any(
        i.code == "unusable_observation" and i.field == observation["field"]
        for i in result.scientific.issues
    )


def test_d146_request_when_contract_writer_releases_models(
    resources: AnalysisResources,
) -> None:
    if "category" not in ProductAnalysisInput.model_fields:
        pytest.skip(
            "D146 contract writer has not released ProductAnalysisInput.category yet"
        )
    payload = request_payload(resources, adr013=True)
    model = AnalyzeRequest.model_validate(payload)
    result = ReferenceAnalysisService(resources).assess(model, input_digest="0" * 64)
    assert result.scientific.state == "graded"
    assert result.scientific.score == -1
    assert (
        result.product.model_dump()["scoringFacts"]
        == model.product.model_dump()["scoringFacts"]
    )


@pytest.mark.parametrize(
    "key", ["methodEdition", "methodBundleSha256", "taxonomyVersion", "evidenceVersion"]
)
def test_compatibility_refuses_each_mismatched_edition(
    key: str, resources: AnalysisResources
) -> None:
    payload = request_payload(resources)
    payload["resourceCompatibility"][key] = (
        "f" * 64 if key.endswith("Sha256") else "unknown"
    )
    result = ReferenceAnalysisService(resources).assess(
        AnalyzeRequest.model_validate(payload), input_digest="0" * 64
    )
    assert result.scientific.state == "method_unavailable"
    assert "grade" not in result.scientific.model_dump()


def test_no_resource_is_a_named_gap(resources: AnalysisResources) -> None:
    result = ReferenceAnalysisService(None).assess(
        AnalyzeRequest.model_validate(request_payload(resources)), input_digest="0" * 64
    )
    assert result.scientific.state == "method_unavailable"


def test_route_with_reference_service_does_not_log_product(
    resources: AnalysisResources, caplog: pytest.LogCaptureFixture
) -> None:
    from app.main import create_app

    app = create_app(
        IsolatedSettings(env="test"),
        analysis_service=ReferenceAnalysisService(resources),
    )
    payload = request_payload(resources)
    marker = "PRIVATE-INGREDIENT-MARKER"
    payload["product"]["ingredientsText"] = marker
    with caplog.at_level(logging.INFO, logger="ingradient"), TestClient(app) as client:
        response = client.post("/v1/analyses", json=payload)
    assert response.status_code == 200
    assert response.json()["scientific"]["state"] == "insufficient_data"
    assert marker not in caplog.text


@pytest.mark.parametrize("damage", ["missing", "modified", "manifest"])
def test_resource_integrity_refuses(tmp_path: Path, damage: str) -> None:
    root = tmp_path / "resources"
    shutil.copytree(ROOT, root)
    if damage == "missing":
        (root / "method/nutriscore-updated-2023.json").unlink()
    elif damage == "modified":
        with (root / "method/nutriscore-updated-2023.json").open("ab") as stream:
            stream.write(b" ")
    else:
        (root / "manifest.json").write_text("{}")
    with pytest.raises(ResourceUnavailable):
        load_resources(root)


def test_nested_ingredients_preserve_order_and_parents(
    resources: AnalysisResources,
) -> None:
    mentions, _ = parse_ingredients(
        "Ingredients: sauce (salt, sugar), water", "complete", ["src-0"], resources
    )
    assert [m.text for m in mentions] == ["sauce", "salt", "sugar", "water"]
    assert [m.parentId for m in mentions] == [
        None,
        mentions[0].id,
        mentions[0].id,
        None,
    ]
    assert all(m.sourceIds == ["src-0"] for m in mentions)


@pytest.mark.parametrize(
    "text",
    [
        "salt (sugar",
        "salt ]",
        "salt " + "(" * 13 + "water" + ")" * 13,
        ",".join(["salt"] * 301),
        "x" * 2001,
    ],
)
def test_malformed_or_oversized_ingredients_are_unresolved(
    text: str, resources: AnalysisResources
) -> None:
    mentions, issues = parse_ingredients(text, "complete", ["src-0"], resources)
    assert mentions == []
    assert any(i.code == "ingredient_structure_unresolved" for i in issues)


def test_no_bare_number_or_advisory_ingredient_inference(
    resources: AnalysisResources,
) -> None:
    mentions, issues = parse_ingredients(
        "salt, 503(ii). May contain milk", "partial", ["src-0"], resources
    )
    assert [m.text for m in mentions] == ["salt", "503(ii)"]
    assert mentions[1].state == "unresolved"
    assert {i.code for i in issues} >= {
        "allergen_statement_separate",
        "ingredients_incomplete",
    }


def test_alias_collision_stays_ambiguous(resources: AnalysisResources) -> None:
    from dataclasses import replace

    modified = replace(
        resources, ingredient_aliases={"salt": ("en:salt", "en:other-salt")}
    )
    mentions, _ = parse_ingredients("salt", "complete", ["src-0"], modified)
    assert mentions[0].state == "ambiguous"
    assert mentions[0].canonicalId is None


@pytest.mark.parametrize("text", ["   ", "\n\t", "Ingredients:", ", ; ."])
def test_empty_normalized_ingredients_report_unavailable(
    text: str, resources: AnalysisResources
) -> None:
    mentions, issues = parse_ingredients(text, "complete", ["src-0"], resources)
    assert mentions == []
    assert any(i.code == "ingredients_unavailable" for i in issues)


@pytest.mark.parametrize(
    "text,expected",
    [
        (
            "salt, sugar contains naturally, milk",
            ["salt", "sugar contains naturally", "milk"],
        ),
        (
            "sauce (water, contains milk), salt",
            ["sauce", "water", "contains milk", "salt"],
        ),
    ],
)
def test_contains_inside_ingredient_text_does_not_drop_the_suffix(
    text: str, expected: list[str], resources: AnalysisResources
) -> None:
    mentions, issues = parse_ingredients(text, "complete", ["src-0"], resources)
    assert [m.text for m in mentions] == expected
    assert not any(i.code == "allergen_statement_separate" for i in issues)


@pytest.mark.parametrize(
    "text,expected",
    [
        (
            "Contains wheat flour, sugar, salt",
            ["Contains wheat flour", "sugar", "salt"],
        ),
        ("Contains milk", ["Contains milk"]),
    ],
)
def test_leading_contains_without_a_header_colon_preserves_spans(
    text: str, expected: list[str], resources: AnalysisResources
) -> None:
    mentions, issues = parse_ingredients(text, "complete", ["src-0"], resources)
    assert [m.text for m in mentions] == expected
    assert mentions[0].state == "unresolved"
    assert any(i.code == "ingredient_identity_unresolved" for i in issues)


@pytest.mark.parametrize("provenance", ["omitted", "empty"])
def test_stated_category_without_provenance_names_the_missing_evidence(
    provenance: str, resources: AnalysisResources
) -> None:
    payload = request_payload(resources, adr013=True)
    if provenance == "omitted":
        del payload["product"]["scoringFacts"]
    else:
        payload["product"]["scoringFacts"]["categorySourceIds"] = []
    result = ReferenceAnalysisService(resources).assess(
        AnalyzeRequest.model_validate(payload), input_digest="0" * 64
    )
    assert result.scientific.state == "insufficient_data"
    assert result.scientific.issues[0].code == "missing_category_provenance"
    assert result.scientific.issues[0].field == "scoringFacts.categorySourceIds"
    assert "unsupported_category" not in {i.code for i in result.scientific.issues}


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: vector["id"])
def test_every_canonical_vector_through_the_real_analysis_route(
    vector: dict[str, Any], resources: AnalysisResources
) -> None:
    from app.main import create_app

    payload = request_payload(resources, adr013=True)
    inputs = vector["inputs"]
    payload["product"].update(
        category=inputs["category"], ingredientsText=None, ingredientsStatus="missing"
    )
    facts = payload["product"]["scoringFacts"]
    facts["categorySourceIds"] = [] if inputs["category"] == "unknown" else ["src-0"]
    for name, value in inputs["flags"].items():
        state = "present" if value is True else "absent" if value is False else value
        facts[name] = (
            {"state": "unknown"}
            if state == "unknown"
            else {"state": state, "sourceIds": ["src-0"]}
        )
    payload["product"]["observations"] = [
        dict(observation, kind="read", sourceIds=["src-0"], issues=[])
        for observation in inputs["observations"]
    ]
    app = create_app(
        IsolatedSettings(env="test"),
        analysis_service=ReferenceAnalysisService(resources),
    )
    with TestClient(app) as client:
        response = client.post("/v1/analyses", json=payload)
    assert response.status_code == 200
    body = response.json()
    expected = vector["expectedAssessment"]
    actual = body["scientific"]
    assert actual["state"] == expected["state"]
    if actual["state"] == "graded":
        for key in ("grade", "score", "route", "method"):
            assert actual[key] == expected[key]
        citation_ids = {citation["id"] for citation in body["citations"]}
        assert all(
            set(reason["citationIds"]) <= citation_ids for reason in actual["reasons"]
        )
    else:
        assert actual["issues"] == expected["issues"]
    assert body["product"]["scoringFacts"] == facts
    assert body["product"]["id"] == actual["inputSnapshotId"]
