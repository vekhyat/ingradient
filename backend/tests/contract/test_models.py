"""Positive examples fit the models. Frozen wire negatives do not."""

from typing import Any

import pytest
from jsonschema.exceptions import ValidationError as SchemaError
from pydantic import TypeAdapter, ValidationError
from tests.contract.support import (
    NEGATIVES_PATH,
    load_json,
    openapi,
    operation_example,
    request_example,
    schema_validator,
)

from app.contract.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    Citation,
    Issue,
    Problem,
    ProductInputSource,
    ReadObservation,
    ScientificAssessment,
)


def test_positive_request_and_response_examples_fit() -> None:
    spec = openapi()
    request = request_example(spec)
    AnalyzeRequest.model_validate(request)
    schema_validator(spec, "AnalyzeRequest").validate(request)

    response = operation_example(spec, "200")
    AnalyzeResponse.model_validate(response)
    schema_validator(spec, "AnalyzeResponse").validate(response)

    assessments = spec["components"]["schemas"]["ScientificAssessment"]["examples"]
    adapter = TypeAdapter(ScientificAssessment)
    scientific = schema_validator(spec, "ScientificAssessment")
    assert len(assessments) >= 2
    for example in assessments:
        adapter.validate_python(example)
        scientific.validate(example)

    problem_validator = schema_validator(spec, "Problem")
    for status in ("400", "413", "429", "503"):
        example = operation_example(spec, status)
        Problem.model_validate(example)
        problem_validator.validate(example)


def test_citation_requires_a_uri_and_a_real_date() -> None:
    payload = {
        "id": "spf-faq-v11",
        "title": "Nutri-Score FAQ",
        "issuer": "Santé publique France",
        "url": "https://www.santepubliquefrance.fr/",
        "edition": "faq-v11",
        "locator": "FAQ",
        "claimScope": "Shape fixture only.",
        "checkedAt": "2026-10-16",
    }
    Citation.model_validate(payload)
    with pytest.raises(ValidationError):
        Citation.model_validate({**payload, "url": "not a uri"})
    with pytest.raises(ValidationError):
        Citation.model_validate({**payload, "checkedAt": "2026-13-40"})


def test_optional_non_null_fields_reject_json_null() -> None:
    issue = {
        "code": "candidate_method_not_released",
        "stage": "method",
        "message": "A reviewed compatible method bundle is not available.",
        "action": "none",
    }
    assert "field" not in Issue.model_validate(issue).model_dump(exclude_unset=True)
    with pytest.raises(ValidationError):
        Issue.model_validate({**issue, "field": None})

    source = {"id": "src-0", "kind": "label", "title": "Ingredient panel"}
    dumped = ProductInputSource.model_validate(source).model_dump(exclude_unset=True)
    assert "edition" not in dumped
    with pytest.raises(ValidationError):
        ProductInputSource.model_validate({**source, "edition": None})

    observation = {
        "field": "salt",
        "kind": "read",
        "value": 1,
        "unit": "g",
        "basis": "per_100_g",
        "sourceIds": ["src-0"],
        "issues": [],
    }
    read = ReadObservation.model_validate(observation)
    assert "derivation" not in read.model_dump(exclude_unset=True)
    with pytest.raises(ValidationError):
        ReadObservation.model_validate({**observation, "derivation": None})

    problem = {"code": "invalid_request", "message": "Invalid product facts."}
    assert "retryAfterSeconds" not in Problem.model_validate(problem).model_dump(
        exclude_unset=True
    )
    with pytest.raises(ValidationError):
        Problem.model_validate({**problem, "retryAfterSeconds": None})


def _reject_model(model: Any, value: Any) -> None:
    if isinstance(model, TypeAdapter):
        model.validate_python(value)
        return
    model.model_validate(value)


def test_every_wire_negative_fails_validation() -> None:
    spec = openapi()
    negatives = load_json(NEGATIVES_PATH)
    assert len(negatives) >= 1
    models: dict[str, Any] = {
        "AnalyzeRequest": AnalyzeRequest,
        "AnalyzeResponse": AnalyzeResponse,
        "ScientificAssessment": TypeAdapter(ScientificAssessment),
    }
    seen: set[str] = set()
    for case in negatives:
        name = case["schema"]
        seen.add(name)
        value = case["value"]
        validator = schema_validator(spec, name)
        with pytest.raises(SchemaError):
            validator.validate(value)
        with pytest.raises(ValidationError):
            _reject_model(models[name], value)
    assert seen == {"AnalyzeRequest", "AnalyzeResponse", "ScientificAssessment"}


def _with_facts(cheese_sources: list[str]) -> dict[str, Any]:
    request = request_example(openapi())
    request["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Combined label photo"}
    ]
    request["product"]["category"] = "general"
    request["product"]["scoringFacts"] = {
        "categorySourceIds": ["src-0"],
        "cheese": {"state": "present", "sourceIds": cheese_sources},
        "redMeat": {"state": "unknown"},
        "plainWater": {"state": "unknown"},
        "nonNutritiveSweetener": {"state": "unknown"},
    }
    return request


def test_scoring_facts_round_trip_on_the_request() -> None:
    request = _with_facts(["src-0"])
    parsed = AnalyzeRequest.model_validate(request)
    dumped = parsed.model_dump(mode="json", exclude_none=True)
    assert dumped["product"]["scoringFacts"] == request["product"]["scoringFacts"]


def test_scoring_fact_with_an_unknown_source_is_rejected() -> None:
    """ADR013: the schema cannot see that a source id exists; the model must."""

    with pytest.raises(ValidationError, match="unknown source id"):
        AnalyzeRequest.model_validate(_with_facts(["src-99"]))
