"""Render reviewed copy from the actual trace; never infer a different scope."""

from decimal import Decimal

from app.analysis.resources import AnalysisResources
from app.contract.models import ScientificReason, TraceStep


def decimal_text(value: Decimal) -> str:
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def render_reason(
    resources: AnalysisResources,
    template_id: str,
    step: TraceStep,
    *,
    value: str = "",
    unit: str = "",
) -> ScientificReason:
    template = resources.templates[template_id]
    if (
        template["component"] != step.component
        or not step.citationIds
        or step.citationIds[0] not in template["citationIds"]
        or not set(step.citationIds) <= {c.id for c in resources.citations}
    ):
        raise ValueError("unsupported_reason_scope")
    text = template["format"].format(value=value, unit=unit, points=step.points)
    return ScientificReason(
        id="reason-" + step.component,
        templateId=template_id,
        text=text,
        citationIds=step.citationIds,
        inputFields=step.inputFields,
        step=step.component + "-points",
    )
