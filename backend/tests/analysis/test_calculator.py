"""Canonical outputs, all table boundaries, refusal and adversarial cases."""

import copy
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.analysis import CalculationInput, calculate, load_resources
from app.analysis.calculator import component_points, letter_for
from app.analysis.resources import AnalysisResources

ROOT = Path(__file__).resolve().parents[3] / "resources"
VECTORS = json.loads(
    (ROOT / "vectors/nutriscore-vectors.json").read_text(encoding="utf-8")
)["vectors"]


@pytest.fixture(scope="session")
def resources() -> AnalysisResources:
    return load_resources()


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["id"])
def test_canonical_vector(vector: dict[str, Any], resources: AnalysisResources) -> None:
    expected = vector["expectedAssessment"]
    actual = calculate(
        CalculationInput.model_validate(vector["inputs"]),
        resources,
        snapshot_id=expected["inputSnapshotId"],
    )
    assert actual.state == expected["state"]
    assert actual.inputSnapshotId == expected["inputSnapshotId"]
    if actual.state != "graded":
        assert actual.model_dump(mode="json", exclude_unset=True) == expected
        return
    assert (actual.grade, actual.score, actual.route) == (
        expected["grade"],
        expected["score"],
        expected["route"],
    )
    assert actual.method.model_dump() == expected["method"]
    # Canonical examples contain differing subsets of a calculation's reasons
    # and traces. Compare every specified component/text, not fixture-local ids.
    trace = {t.component: t.points for t in actual.trace}
    for step in expected["trace"]:
        assert trace[step["component"]] == step["points"]
    for reason in expected["reasons"]:
        assert any(
            r.templateId == reason["templateId"] and r.text == reason["text"]
            for r in actual.reasons
        )
    citations = {c.id for c in resources.citations}
    assert all(set(r.citationIds) <= citations for r in actual.reasons)
    assert all(r.templateId in resources.templates for r in actual.reasons)
    assert all(set(t.citationIds) <= citations for t in actual.trace)
    assert actual.issues == []


METHOD = json.loads(
    (ROOT / "method/nutriscore-updated-2023.json").read_text(encoding="utf-8")
)
BOUNDARIES = [
    (route, group, name, rule, i, threshold)
    for route, spec in METHOD["routes"].items()
    for group in ("adverseComponents", "favourableComponents")
    for name, rule in spec[group].items()
    for i, threshold in enumerate(rule.get("thresholds", []))
]


@pytest.mark.parametrize("route,group,name,rule,index,threshold", BOUNDARIES)
def test_every_component_boundary(
    route: str,
    group: str,
    name: str,
    rule: dict[str, Any],
    index: int,
    threshold: float,
) -> None:
    value = Decimal(str(threshold))
    assert component_points(value - Decimal("0.000001"), rule) == rule["points"][index]
    assert (
        component_points(value, rule)
        == rule["points"][index + (rule["operator"] == ">=")]
    )
    assert (
        component_points(value + Decimal("0.000001"), rule) == rule["points"][index + 1]
    )


@pytest.mark.parametrize("route", METHOD["routes"])
def test_all_integer_letter_boundaries(route: str) -> None:
    scoring = METHOD["routes"][route]["scoring"]
    for band in scoring["letterMapping"]:
        if "special" in band:
            continue
        for score in (
            band.get("minScore", scoring["scoreBounds"]["min"]),
            band.get("maxScore", scoring["scoreBounds"]["max"]),
        ):
            assert letter_for(score, scoring) == band["letter"]


@pytest.mark.parametrize(
    "vector",
    [
        v
        for v in VECTORS
        if v["expectedAssessment"]["state"] == "graded" and v["inputs"]["observations"]
    ],
    ids=lambda v: v["id"],
)
def test_each_required_field_missing_refuses(
    vector: dict[str, Any], resources: AnalysisResources
) -> None:
    original = vector["inputs"]
    for observation in original["observations"]:
        modified = copy.deepcopy(original)
        modified["observations"].remove(observation)
        actual = calculate(
            CalculationInput.model_validate(modified), resources, snapshot_id="test"
        )
        assert actual.state == "insufficient_data"
        assert any(i.field == observation["field"] for i in actual.issues)


@pytest.mark.parametrize("value", [True, False, -1, float("inf"), float("nan"), "1"])
def test_invalid_numbers_rejected(value: object) -> None:
    data = copy.deepcopy(VECTORS[0]["inputs"])
    data["observations"][0]["value"] = value
    with pytest.raises(ValidationError):
        CalculationInput.model_validate(data)


@pytest.mark.parametrize(
    "change",
    ["basis", "unit", "duplicate", "fvl_overflow", "flags_missing", "contradiction"],
)
def test_adversarial_facts_refuse(change: str, resources: AnalysisResources) -> None:
    data = copy.deepcopy(VECTORS[0]["inputs"])
    if change == "basis":
        data["observations"][0]["basis"] = "per_serving"
    elif change == "unit":
        data["observations"][0]["unit"] = "kcal"
    elif change == "duplicate":
        data["observations"].append(copy.deepcopy(data["observations"][0]))
    elif change == "fvl_overflow":
        data["observations"][-1]["value"] = 101
    elif change == "flags_missing":
        del data["flags"]
    else:
        data["flags"].update(cheese=True, redMeat=True)
    result = calculate(
        CalculationInput.model_validate(data), resources, snapshot_id="test"
    )
    assert result.state == "insufficient_data"
    assert result.issues
    assert "grade" not in result.model_dump()


@pytest.mark.parametrize("fat,saturates", [(0, 0), (10, 11)])
def test_invalid_fat_ratio_refuses(
    fat: int, saturates: int, resources: AnalysisResources
) -> None:
    data = copy.deepcopy(
        next(v["inputs"] for v in VECTORS if v["id"] == "vector-fats-olive-oil")
    )
    for o in data["observations"]:
        if o["field"] == "fat":
            o["value"] = fat
        if o["field"] == "saturates":
            o["value"] = saturates
    assert (
        calculate(
            CalculationInput.model_validate(data), resources, snapshot_id="test"
        ).state
        == "insufficient_data"
    )


def test_input_is_not_mutated_and_repeat_is_identical(
    resources: AnalysisResources,
) -> None:
    inputs = CalculationInput.model_validate(VECTORS[0]["inputs"])
    before = inputs.model_dump_json()
    first = calculate(inputs, resources, snapshot_id="same")
    assert calculate(inputs, resources, snapshot_id="same") == first
    assert inputs.model_dump_json() == before


def test_excluded_and_unknown_categories(resources: AnalysisResources) -> None:
    assert (
        calculate(
            CalculationInput(category="excluded"), resources, snapshot_id="test"
        ).state
        == "unsupported"
    )
    assert (
        calculate(CalculationInput(), resources, snapshot_id="test").state
        == "insufficient_data"
    )


def test_unknown_operator_is_not_interpreted_as_a_known_rule() -> None:
    with pytest.raises(ValueError, match="unsupported_method_operator"):
        component_points(
            Decimal(1), {"operator": "approx", "thresholds": [1], "points": [0, 1]}
        )


@pytest.mark.parametrize("threshold", [10, 16, 22, 28, 34, 40, 46, 52, 58, 64])
def test_fat_ratio_calculation_at_every_boundary(
    threshold: int, resources: AnalysisResources
) -> None:
    data = copy.deepcopy(
        next(v["inputs"] for v in VECTORS if v["id"] == "vector-fats-olive-oil")
    )
    for o in data["observations"]:
        if o["field"] == "fat":
            o["value"] = 10
        if o["field"] == "saturates":
            o["value"] = threshold / 10
    result = calculate(
        CalculationInput.model_validate(data), resources, snapshot_id="ratio"
    )
    assert result.state == "graded"
    expected = [10, 16, 22, 28, 34, 40, 46, 52, 58, 64].index(threshold) + 1
    assert (
        next(t.points for t in result.trace if t.component == "saturates_ratio")
        == expected
    )


@pytest.mark.parametrize("category,limit", [("general", 11), ("fats_nuts_seeds", 7)])
def test_conditional_protein_at_limit(
    category: str, limit: int, resources: AnalysisResources
) -> None:
    data = copy.deepcopy(VECTORS[0]["inputs"])
    data["category"] = category
    data["observations"] = [
        dict(field=f, value=v, unit="percent" if f == "fvl" else "g", basis="per_100_g")
        for f, v in [
            ("sugars", 0),
            ("saturates", 0),
            ("salt", 0),
            ("protein", 20),
            ("fibre", 0),
            ("fvl", 0),
        ]
    ]
    data["observations"].append(
        dict(field="energy", value=0, unit="kJ", basis="per_100_g")
    )
    if category == "fats_nuts_seeds":
        data["observations"].append(
            dict(field="fat", value=10, unit="g", basis="per_100_g")
        )
    for points in (limit - 1, limit):
        # Salt alone supplies 10/11 or 6/7 adverse points; all other A inputs are 0.
        next(o for o in data["observations"] if o["field"] == "salt")["value"] = (
            points + 0.5
        ) / 5
        result = calculate(
            CalculationInput.model_validate(data), resources, snapshot_id="conditional"
        )
        assert result.state == "graded"
        assert result.score == points - (7 if points < limit else 0)


def test_changed_rule_refuses_without_a_letter(resources: AnalysisResources) -> None:
    from dataclasses import replace

    method = copy.deepcopy(resources.method)
    method["routes"]["general"]["adverseComponents"]["energy"]["operator"] = "approx"
    result = calculate(
        CalculationInput.model_validate(VECTORS[0]["inputs"]),
        replace(resources, method=method),
        snapshot_id="unknown-rule",
    )
    assert result.state == "method_unavailable"


@pytest.mark.parametrize(
    "change", ["unknown_water", "conflicting_water", "unknown_sweetener"]
)
def test_water_requires_supported_uncontradicted_facts(
    change: str, resources: AnalysisResources
) -> None:
    data = copy.deepcopy(
        next(v["inputs"] for v in VECTORS if v["id"] == "vector-beverage-water")
    )
    if change == "unknown_water":
        del data["flags"]["plainWater"]
    elif change == "unknown_sweetener":
        del data["flags"]["nonNutritiveSweetener"]
    else:
        data["observations"] = [
            dict(field="sugars", value=5, unit="g", basis="per_100_ml")
        ]
    assert (
        calculate(
            CalculationInput.model_validate(data), resources, snapshot_id="water"
        ).state
        == "insufficient_data"
    )
