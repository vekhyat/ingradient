"""Updated Nutri-Score calculation from explicit supported inputs.

Thresholds, caps, bounds and locators come from the pinned method JSON. See
its Scientific Committee 2022 food / 2023 beverage citations. Missing values
and exception flags are never imputed. No request logging or persistence.
"""

from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.analysis.evidence import decimal_text, render_reason
from app.analysis.resources import AnalysisResources
from app.contract.models import (
    GapAssessment,
    GradedAssessment,
    Issue,
    ScientificReason,
    TraceStep,
)


class Flags(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    cheese: bool | None = None
    redMeat: bool | None = None
    plainWater: bool | None = None
    nonNutritiveSweetener: Literal["present", "absent", "unknown"] = "unknown"


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    field: str
    value: Annotated[int | float, Field(ge=0, allow_inf_nan=False)]
    unit: str
    basis: str


class CalculationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category: str = "unknown"
    flags: Flags = Field(default_factory=Flags)
    observations: list[Observation] = Field(default_factory=list, max_length=100)


def issue(code: str, field: str, message: str, *, method: bool = False) -> Issue:
    return Issue(
        code=code,
        field=field,
        stage="method" if method else "completeness",
        message=message,
        action="read_source" if method else "add_field",
    )


def gap(
    snapshot_id: str,
    issues: list[Issue],
    state: Literal[
        "insufficient_data", "unsupported", "method_unavailable"
    ] = "insufficient_data",
) -> GapAssessment:
    return GapAssessment(
        state=state, inputSnapshotId=snapshot_id, reasons=[], issues=issues
    )


def component_points(value: Decimal, rule: dict[str, Any]) -> int:
    """The beverage <= table specifies upper bins; equality stays below."""
    operator = rule["operator"]
    if operator not in (">", ">=", "<="):
        raise ValueError("unsupported_method_operator")
    index = sum(
        value >= Decimal(str(t)) if operator == ">=" else value > Decimal(str(t))
        for t in rule["thresholds"]
    )
    return rule["points"][index]


def letter_for(score: int, scoring: dict[str, Any]) -> str:
    for band in scoring["letterMapping"]:
        if "special" not in band and band.get("minScore", -100) <= score <= band.get(
            "maxScore", 100
        ):
            return band["letter"]
    raise ValueError("unsupported_letter_mapping")


def _calculate(
    inputs: CalculationInput, resources: AnalysisResources, *, snapshot_id: str
) -> GradedAssessment | GapAssessment:
    """Pure: arguments in, assessment out; no file, network or global state."""
    category = inputs.category
    if category not in resources.method["routes"]:
        return gap(
            snapshot_id,
            [
                issue(
                    "unsupported_category",
                    "category",
                    "Product category is not supported for Nutri-Score calculation.",
                    method=True,
                )
            ],
            "unsupported" if category == "excluded" else "insufficient_data",
        )
    flags = inputs.flags
    contradictions = (
        (flags.cheese is True and flags.redMeat is True)
        or (category != "general" and (flags.cheese is True or flags.redMeat is True))
        or (category != "beverage" and flags.plainWater is True)
        or (flags.plainWater is True and flags.nonNutritiveSweetener == "present")
    )
    if contradictions:
        return gap(
            snapshot_id,
            [
                issue(
                    "conflicting_scoring_facts",
                    "scoringFacts",
                    "Scoring facts contradict the supported category.",
                )
            ],
        )
    missing: list[Issue] = []
    for flag in (
        ("cheese", "redMeat")
        if category == "general"
        else ("plainWater",)
        if category == "beverage"
        else ()
    ):
        if getattr(flags, flag) is None:
            missing.append(
                issue(
                    "missing_" + flag.lower(),
                    flag,
                    f"Supported {flag} presence or absence is required.",
                )
            )
    if category == "beverage" and flags.nonNutritiveSweetener == "unknown":
        missing.append(
            issue(
                "sweetener_presence_unknown",
                "nonNutritiveSweetener",
                (
                    "Sweetener presence is unknown; cannot determine "
                    "beverage adverse points under updated 2023 algorithm."
                ),
            )
        )
    if missing:
        return gap(snapshot_id, missing)
    route = resources.method["routes"][category]
    citation_ids = [
        "sc-beverage-2023" if category == "beverage" else "sc-food-2022",
        "fps-public-health-tool-2025",
    ]
    if category == "beverage" and flags.plainWater is True:
        # An explicit water fact is required. Zero energy never establishes it.
        if any(
            o.value != 0 and o.field in resources.method["inputFields"]["fields"]
            for o in inputs.observations
        ):
            return gap(
                snapshot_id,
                [
                    issue(
                        "conflicting_water_facts",
                        "plainWater",
                        "Plain-water evidence conflicts with nutrient observations.",
                    )
                ],
            )
        water_step = TraceStep(
            component="water_classification",
            inputFields=["category", "plainWater"],
            points=0,
            ruleLocator=route["scoring"]["ruleLocator"],
            citationIds=citation_ids,
        )
        return GradedAssessment.model_validate(
            dict(
                state="graded",
                grade="A",
                score=0,
                route=category,
                method=resources.method_ref,
                inputSnapshotId=snapshot_id,
                reasons=[
                    render_reason(
                        resources, "nutriscore.water_classification", water_step
                    )
                ],
                trace=[water_step],
                issues=[],
            )
        )
    values: dict[str, Decimal] = {}
    displays: dict[str, str] = {}
    fields = resources.method["inputFields"]["fields"]
    required = [name for name, spec in fields.items() if category in spec["routes"]]
    for name in required:
        observations = [o for o in inputs.observations if o.field == name]
        if not observations:
            missing.append(
                issue(
                    "missing_" + name,
                    name,
                    f"{name.capitalize()} is not available for this calculation.",
                )
            )
            continue
        if len(observations) != 1:
            missing.append(
                issue(
                    "conflicting_" + name,
                    name,
                    "Multiple observations require explicit resolution.",
                )
            )
            continue
        o = observations[0]
        if o.unit != fields[name]["unit"] or o.basis != fields[name]["basis"][category]:
            missing.append(
                issue(
                    "unsupported_" + name + "_basis",
                    name,
                    "A supported unit and per-100 basis are required.",
                )
            )
            continue
        value = Decimal(str(o.value))
        # 3800 kJ/100 leaves margin above fat's energy density: Regulation (EU)
        # 1169/2011 Annex XIV and FAO Food and Nutrition Paper 77, chapter 3.
        if (
            (name == "energy" and value > 3800)
            or (name != "energy" and value > 100)
            or (name == "fat" and value == 0)
        ):
            missing.append(
                issue(
                    "invalid_" + name,
                    name,
                    "This nutrient value cannot support the calculation.",
                )
            )
            continue
        values[name] = value
        displays[name] = decimal_text(value)
    if missing:
        return gap(snapshot_id, missing)
    if category == "fats_nuts_seeds" and values["saturates"] > values["fat"]:
        return gap(
            snapshot_id,
            [
                issue(
                    "inconsistent_fat",
                    "saturates",
                    "Saturates exceed total fat on the same basis.",
                )
            ],
        )
    trace: list[TraceStep] = []
    reasons: list[ScientificReason] = []

    def add_trace(
        component: str, points: int, locator: str, input_fields: list[str]
    ) -> None:
        trace.append(
            TraceStep(
                component=component,
                points=points,
                ruleLocator=locator,
                inputFields=input_fields,
                citationIds=citation_ids,
            )
        )

    adverse: dict[str, int] = {}
    for component, rule in route["adverseComponents"].items():
        if component == "sweeteners":
            points = (
                rule["pointsIfPresent"]
                if flags.nonNutritiveSweetener == "present"
                else rule["pointsIfAbsent"]
            )
            adverse[component] = points
            add_trace(component, points, rule["ruleLocator"], ["nonNutritiveSweetener"])
            if points:
                reasons.append(
                    render_reason(resources, "nutriscore.sweetener", trace[-1])
                )
            continue
        name, unit = component, rule["unit"]
        input_fields = [component]
        if category == "fats_nuts_seeds" and component == "energy":
            value = values["saturates"] * 37
            name, display, input_fields = (
                "energy_from_saturates",
                decimal_text(value),
                ["saturates"],
            )
        else:
            value, display = values[component], displays[component]
        if category == "fats_nuts_seeds" and component == "saturates":
            # Cross multiplication avoids rounding a repeating ratio across a boundary.
            points = rule["points"][
                sum(
                    values["saturates"] * 100 >= Decimal(str(t)) * values["fat"]
                    for t in rule["thresholds"]
                )
            ]
            with localcontext() as ctx:
                ctx.prec = 28
                ratio = values["saturates"] * 100 / values["fat"]
            name, display, input_fields = (
                "saturates_ratio",
                decimal_text(ratio.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                ["saturates", "fat"],
            )
        else:
            points = component_points(value, rule)
        adverse[name] = points
        add_trace(name, points, rule["ruleLocator"], input_fields)
        reasons.append(
            render_reason(
                resources, "nutriscore." + name, trace[-1], value=display, unit=unit
            )
        )
    points_a = sum(adverse.values())
    conditional = route["scoring"].get("conditionalProteinRule")
    scoring_locator = (conditional or route["scoring"])["ruleLocator"]
    counts_protein = not (
        conditional
        and points_a >= conditional["thresholdA"]
        and not (category == "general" and flags.cheese is True)
    )
    add_trace("points_a", points_a, scoring_locator, list(adverse))
    favourable: dict[str, int] = {}
    counted: list[str] = []
    for component, rule in route["favourableComponents"].items():
        field = "fibre" if component == "fibres" else component
        points = component_points(values[field], rule)
        template = "nutriscore." + component
        locator = rule["ruleLocator"]
        if component == "protein":
            if not counts_protein:
                template = "nutriscore.protein_not_counted"
            elif category == "general" and flags.redMeat is True:
                cap = rule["exceptions"]["red_meat"]
                if points > cap["maxPoints"]:
                    points = cap["maxPoints"]
                    template = "nutriscore.protein_red_meat"
                    locator = cap["ruleLocator"]
        favourable[component] = points
        if component != "protein" or counts_protein:
            counted.append(component)
        add_trace(component, points, locator, [field])
        reasons.append(
            render_reason(
                resources, template, trace[-1], value=displays[field], unit=rule["unit"]
            )
        )
    points_c = sum(favourable[component] for component in counted)
    add_trace("points_c", points_c, scoring_locator, counted)
    score = points_a - points_c
    bounds = route["scoring"]["scoreBounds"]
    if not bounds["min"] <= score <= bounds["max"]:
        return gap(
            snapshot_id,
            [
                issue(
                    "method_score_out_of_bounds",
                    "method",
                    "Calculation exceeded the pinned route bounds.",
                    method=True,
                )
            ],
            "method_unavailable",
        )
    add_trace("final_score", score, scoring_locator, ["points_a", "points_c"])
    return GradedAssessment.model_validate(
        dict(
            state="graded",
            grade=letter_for(score, route["scoring"]),
            score=score,
            route=category,
            method=resources.method_ref,
            inputSnapshotId=snapshot_id,
            reasons=reasons,
            trace=trace,
            issues=[],
        )
    )


def calculate(
    inputs: CalculationInput, resources: AnalysisResources, *, snapshot_id: str
) -> GradedAssessment | GapAssessment:
    """Refuse an unsupported resource shape rather than interpreting new rules."""
    try:
        return _calculate(inputs, resources, snapshot_id=snapshot_id)
    except KeyError, ValueError, TypeError, ArithmeticError:
        return gap(
            snapshot_id,
            [
                issue(
                    "unsupported_method_resource",
                    "method",
                    "The installed method cannot support this calculation.",
                    method=True,
                )
            ],
            "method_unavailable",
        )
