"""Contract adapter for the pure analysis module. No logging or persistence."""

from typing import Any

from app.analysis.calculator import CalculationInput, calculate, gap, issue
from app.analysis.ingredients import parse_ingredients
from app.analysis.resources import AnalysisResources
from app.contract.models import AnalyzedProduct, AnalyzeRequest, AnalyzeResponse


class ReferenceAnalysisService:
    """Inject startup-loaded pins; None produces a named method gap."""

    def __init__(self, resources: AnalysisResources | None) -> None:
        self.resources = resources

    def assess(self, request: AnalyzeRequest, *, input_digest: str) -> AnalyzeResponse:
        product = request.product
        payload = product.model_dump(mode="json", exclude_unset=True)
        snapshot_id = "analysis-" + input_digest
        resources = self.resources
        compatibility = request.resourceCompatibility
        category = payload.get("category", "unknown")
        facts: dict[str, Any] = payload.get("scoringFacts", {})
        source_ids = {s.id for s in product.sourceRefs}
        supported_category = (
            bool(facts.get("categorySourceIds"))
            and set(facts.get("categorySourceIds", [])) <= source_ids
        )
        missing_category_provenance = (
            category in ("general", "fats_nuts_seeds", "beverage", "excluded")
            and not supported_category
        )
        if not supported_category:
            category = "unknown"
        flags: dict[str, Any] = {}
        for name in ("cheese", "redMeat", "plainWater", "nonNutritiveSweetener"):
            fact = facts.get(name, {"state": "unknown"})
            state = fact["state"]
            if state != "unknown" and (
                not fact.get("sourceIds") or not set(fact["sourceIds"]) <= source_ids
            ):
                state = "unknown"
            flags[name] = (
                state
                if name == "nonNutritiveSweetener"
                else state == "present"
                if state != "unknown"
                else None
            )
        observations = []
        observation_issues = []
        for observation in product.observations:
            if observation.kind in ("read", "corrected") and not observation.issues:
                observations.append(
                    {
                        k: getattr(observation, k)
                        for k in ("field", "value", "unit", "basis")
                    }
                )
            else:
                observation_issues.append(
                    issue(
                        "unusable_observation",
                        observation.field,
                        (
                            "An uncertain, missing or flagged observation cannot "
                            "support this calculation."
                        ),
                    )
                )
        if resources is None or compatibility.model_dump() != resources.compatibility:
            scientific = gap(
                snapshot_id,
                [
                    issue(
                        "incompatible_resources",
                        "resources",
                        "A reviewed compatible resource bundle is unavailable.",
                        method=True,
                    )
                ],
                "method_unavailable",
            )
        elif missing_category_provenance:
            scientific = gap(
                snapshot_id,
                [
                    issue(
                        "missing_category_provenance",
                        "scoringFacts.categorySourceIds",
                        "Source evidence for the stated product category is missing.",
                    )
                ],
            )
        else:
            scientific = calculate(
                CalculationInput.model_validate(
                    dict(category=category, flags=flags, observations=observations)
                ),
                resources,
                snapshot_id=snapshot_id,
            )
            # A duplicate unresolved observation must not be hidden by a read value.
            required = {
                name
                for name, spec in resources.method["inputFields"]["fields"].items()
                if category in spec["routes"]
            }
            blocking = [i for i in observation_issues if i.field in required]
            if blocking:
                scientific = gap(
                    snapshot_id,
                    blocking
                    + (scientific.issues if scientific.state != "graded" else []),
                )
        ingredients, ingredient_issues = (
            ([], [])
            if resources is None
            else parse_ingredients(
                product.ingredientsText,
                product.ingredientsStatus,
                [
                    s.id
                    for s in product.sourceRefs
                    if s.title
                    in (
                        "Ingredient panel",
                        "Combined label photo",
                        "Open Food Facts product",
                        "User correction",
                    )
                ],
                resources,
            )
        )
        analyzed: dict[str, Any] = dict(
            id=snapshot_id,
            barcode=product.barcode,
            name=product.name,
            market=product.market,
            sourceRefs=product.sourceRefs,
            observations=product.observations,
            ingredients=ingredients,
            category=category,
            taxonomyVersion=resources.taxonomy_version
            if resources
            else compatibility.taxonomyVersion,
            evidenceVersion=resources.evidence_version
            if resources
            else compatibility.evidenceVersion,
        )
        if "scoringFacts" in payload:
            analyzed["scoringFacts"] = payload["scoringFacts"]
        issues = [*product.issues, *ingredient_issues, *scientific.issues]
        return AnalyzeResponse(
            contractVersion=request.contractVersion,
            inputDigest=input_digest,
            product=AnalyzedProduct.model_validate(analyzed),
            scientific=scientific,
            citations=list(resources.citations) if resources else [],
            issues=issues,
        )
