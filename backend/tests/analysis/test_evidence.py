"""Reasons must describe the actual counted evidence and its reviewed scope."""

import copy
from dataclasses import replace
from typing import Any

import pytest
from tests.analysis.test_calculator import VECTORS

from app.analysis import CalculationInput, calculate, load_resources
from app.analysis.resources import AnalysisResources
from app.contract.models import GradedAssessment


@pytest.fixture(scope="module")
def resources() -> AnalysisResources:
    return load_resources()


def assess(vector_id: str, resources: AnalysisResources) -> GradedAssessment:
    vector = next(v for v in VECTORS if v["id"] == vector_id)
    result = calculate(
        CalculationInput.model_validate(vector["inputs"]), resources, snapshot_id="test"
    )
    assert isinstance(result, GradedAssessment)
    return result


def test_water_has_its_own_template_and_source_locator(
    resources: AnalysisResources,
) -> None:
    result = assess("vector-beverage-water", resources)
    reason = result.reasons[0]
    assert reason.templateId == "nutriscore.water_classification"
    assert reason.inputFields == ["category", "plainWater"]
    assert reason.step == "water_classification-points"
    assert reason.text == resources.templates[reason.templateId]["format"]
    assert (
        result.trace[0].ruleLocator
        == resources.method["routes"]["beverage"]["scoring"]["ruleLocator"]
    )


@pytest.mark.parametrize(
    "vector_id",
    ["vector-general-protein-limit-active", "vector-fats-protein-conditional"],
)
def test_uncounted_protein_does_not_claim_subtracted_points(
    vector_id: str, resources: AnalysisResources
) -> None:
    result = assess(vector_id, resources)
    reason = next(r for r in result.reasons if r.id == "reason-protein")
    points = next(t.points for t in result.trace if t.component == "protein")
    assert reason.templateId == "nutriscore.protein_not_counted"
    assert reason.text == resources.templates[reason.templateId]["format"].format(
        points=points
    )
    total = next(t for t in result.trace if t.component == "points_c")
    assert "protein" not in total.inputFields


def test_fats_energy_reason_names_the_derived_input(
    resources: AnalysisResources,
) -> None:
    result = assess("vector-fats-olive-oil", resources)
    reason = next(r for r in result.reasons if r.id == "reason-energy_from_saturates")
    assert reason.templateId == "nutriscore.energy_from_saturates"
    assert reason.inputFields == ["saturates"]
    assert reason.text.startswith("Energy from saturated fatty acids of 518 kJ")


def test_ratio_display_rounds_half_up_without_rounding_threshold_input(
    resources: AnalysisResources,
) -> None:
    data = copy.deepcopy(
        next(v["inputs"] for v in VECTORS if v["id"] == "vector-fats-olive-oil")
    )
    for observation in data["observations"]:
        if observation["field"] == "fat":
            observation["value"] = 8
        if observation["field"] == "saturates":
            observation["value"] = 1.0636  # 13.295%; display 13.30 -> 13.3.
    result = calculate(
        CalculationInput.model_validate(data), resources, snapshot_id="ratio"
    )
    assert isinstance(result, GradedAssessment)
    reason = next(r for r in result.reasons if r.id == "reason-saturates_ratio")
    assert "(13.3%)" in reason.text
    assert next(t.points for t in result.trace if t.component == "saturates_ratio") == 1


@pytest.mark.parametrize(
    "vector",
    [v for v in VECTORS if v["expectedAssessment"]["state"] == "graded"],
    ids=lambda v: v["id"],
)
def test_every_reason_uses_its_actual_trace_and_applicable_reviewed_template(
    vector: dict[str, Any], resources: AnalysisResources
) -> None:
    result = assess(vector["id"], resources)
    traces = {t.component: t for t in result.trace}
    report = "sc-beverage-2023" if result.route == "beverage" else "sc-food-2022"
    for reason in result.reasons:
        template = resources.templates[reason.templateId]
        step = traces[template["component"]]
        assert reason.step == step.component + "-points"
        assert reason.inputFields == step.inputFields
        assert reason.citationIds == step.citationIds
        assert reason.citationIds == [report, "fps-public-health-tool-2025"]
        assert report in template["citationIds"]


def test_wrong_template_scope_refuses_instead_of_publishing_a_reason(
    resources: AnalysisResources,
) -> None:
    templates = copy.deepcopy(resources.templates)
    templates["nutriscore.energy"]["component"] = "water_classification"
    result = calculate(
        CalculationInput.model_validate(VECTORS[0]["inputs"]),
        replace(resources, templates=templates),
        snapshot_id="bad-template",
    )
    assert result.state == "method_unavailable"
    assert result.reasons == []


@pytest.mark.parametrize("counted", [True, False])
def test_red_meat_cap_is_explained_only_when_it_changes_counted_points(
    counted: bool, resources: AnalysisResources
) -> None:
    data = copy.deepcopy(
        next(v["inputs"] for v in VECTORS if v["id"] == "vector-general-red-meat-cap")
    )
    if not counted:
        next(o for o in data["observations"] if o["field"] == "salt")["value"] = 5
    result = calculate(
        CalculationInput.model_validate(data), resources, snapshot_id="red-meat"
    )
    assert isinstance(result, GradedAssessment)
    protein = next(r for r in result.reasons if r.id == "reason-protein")
    assert protein.templateId == (
        "nutriscore.protein_red_meat" if counted else "nutriscore.protein_not_counted"
    )
    points = next(t.points for t in result.trace if t.component == "protein")
    assert points == (2 if counted else 7)
