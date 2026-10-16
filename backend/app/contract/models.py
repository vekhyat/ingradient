"""Pydantic models for the frozen POST /v1/analyses schemas.

Field names are the wire names. ``extra="forbid"`` is the schema's
``additionalProperties: false``. A property that the schema omits from
``required`` and does not list ``null`` as a type may be absent. JSON null
is still invalid. Nullable fields are a union with ``None``.
"""

import math
from datetime import date
from typing import Annotated, Literal, Self
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.functional_validators import BeforeValidator

_SHA256 = r"^[a-f0-9]{64}$"
_SOURCE_ID = r"^src-[0-9]{1,3}$"
_BARCODE = r"^(?:[0-9]{8}|[0-9]{12,14})$"
_EDITION = (
    r"^(?:rev-[0-9]{1,9}|"
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$"
)
_CODE = r"^[a-z][a-z0-9_.]{0,79}$"

ShortText = Annotated[str, Field(min_length=1, max_length=160)]
SourceId = Annotated[str, Field(pattern=_SOURCE_ID)]
Market = Literal["IN", "EU", "unknown"]
IssueStage = Literal[
    "lookup",
    "capture",
    "extraction",
    "matching",
    "completeness",
    "method",
]
IssueAction = Literal[
    "retake",
    "edit",
    "choose_candidate",
    "add_field",
    "retry",
    "read_source",
    "none",
]
NutrientUnit = Literal["g", "kJ", "percent"]
NutrientBasis = Literal["per_100_g", "per_100_ml", "per_serving"]


def _reject_explicit_null(value: object) -> object:
    """Reject JSON null. A missing key uses the default and skips this check.

    Pydantic does not validate defaults unless ``validate_default`` is set.
    The annotation still includes ``None`` so the default type-checks.
    """

    if value is None:
        raise ValueError("null is not allowed")
    return value


def _json_number(value: object) -> int | float:
    """Accept a JSON number. Reject booleans, strings and non-finite values."""

    if type(value) is int:
        return value
    if type(value) is float and math.isfinite(value):
        return value
    raise ValueError("nutrient values must be finite JSON numbers")


NutrientValue = Annotated[int | float, BeforeValidator(_json_number), Field(ge=0)]


def _uri(value: object) -> str:
    """Require an RFC 3986 URI with a scheme. The schema says ``format: uri``."""

    if not isinstance(value, str) or value == "":
        raise ValueError("uri")
    parsed = urlparse(value)
    if parsed.scheme == "" or (parsed.netloc == "" and parsed.path == ""):
        raise ValueError("uri")
    return value


def _iso_date(value: object) -> str:
    """Require a full date, ``YYYY-MM-DD``. The schema says ``format: date``."""

    if (
        not isinstance(value, str)
        or len(value) != 10
        or value[4] != "-"
        or value[7] != "-"
    ):
        raise ValueError("date")
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("date") from error
    return value


class WireModel(BaseModel):
    """One JSON object from the frozen contract. Unknown fields fail."""

    model_config = ConfigDict(extra="forbid")


class Issue(WireModel):
    code: Annotated[str, Field(pattern=_CODE)]
    stage: IssueStage
    field: Annotated[
        str | None,
        Field(max_length=160),
        BeforeValidator(_reject_explicit_null),
    ] = None
    message: Annotated[str, Field(min_length=1, max_length=1000)]
    action: IssueAction


class Citation(WireModel):
    id: ShortText
    title: Annotated[str, Field(min_length=1, max_length=500)]
    issuer: Annotated[str, Field(min_length=1, max_length=200)]
    url: Annotated[str, BeforeValidator(_uri)]
    edition: ShortText
    locator: Annotated[str, Field(min_length=1, max_length=300)]
    claimScope: Annotated[str, Field(min_length=1, max_length=1000)]
    checkedAt: Annotated[str, BeforeValidator(_iso_date)]


class MethodRef(WireModel):
    id: ShortText
    edition: ShortText
    bundleId: ShortText
    bundleSha256: Annotated[str, Field(pattern=_SHA256)]
    label: Literal["Nutrition grade · European reference"]


class ScientificReason(WireModel):
    id: ShortText
    templateId: Annotated[str, Field(pattern=_CODE)]
    text: Annotated[str, Field(min_length=1, max_length=1000)]
    citationIds: list[ShortText] = Field(min_length=1)
    inputFields: list[ShortText]
    step: ShortText


class TraceStep(WireModel):
    component: ShortText
    inputFields: list[ShortText]
    points: Annotated[int, Field(strict=True)]
    ruleLocator: Annotated[str, Field(min_length=1, max_length=300)]
    citationIds: list[ShortText] = Field(min_length=1)


class GradedAssessment(WireModel):
    state: Literal["graded"]
    grade: Literal["A", "B", "C", "D", "E"]
    score: Annotated[int, Field(strict=True, ge=-18, le=55)]
    route: Literal["general", "fats_nuts_seeds", "beverage"]
    method: MethodRef
    inputSnapshotId: ShortText
    reasons: list[ScientificReason] = Field(min_length=1)
    trace: list[TraceStep] = Field(min_length=1)
    issues: list[Issue]


class GapAssessment(WireModel):
    """A named gap. These states have issues and no grade letter."""

    state: Literal["insufficient_data", "unsupported", "method_unavailable"]
    inputSnapshotId: ShortText
    reasons: list[ScientificReason]
    issues: list[Issue] = Field(min_length=1)


ScientificAssessment = Annotated[
    GradedAssessment | GapAssessment,
    Field(discriminator="state"),
]


class ProductInputSource(WireModel):
    id: SourceId
    kind: Literal["label", "off", "user_correction"]
    title: Literal[
        "Ingredient panel",
        "Nutrition panel",
        "Combined label photo",
        "Open Food Facts product",
        "User correction",
    ]
    edition: Annotated[
        str | None,
        Field(pattern=_EDITION),
        BeforeValidator(_reject_explicit_null),
    ] = None


class _ObservationBase(WireModel):
    field: ShortText


class ReadObservation(_ObservationBase):
    kind: Literal["read"]
    value: NutrientValue
    unit: NutrientUnit
    basis: NutrientBasis
    sourceIds: list[SourceId] = Field(min_length=1)
    issues: list[Issue]
    derivation: Annotated[
        list[Annotated[str, Field(max_length=500)]] | None,
        Field(max_length=12),
        BeforeValidator(_reject_explicit_null),
    ] = None


class UncertainObservation(_ObservationBase):
    kind: Literal["uncertain"]
    value: NutrientValue
    unit: NutrientUnit
    basis: NutrientBasis
    sourceIds: list[SourceId] = Field(min_length=1)
    issues: list[Issue] = Field(min_length=1)
    derivation: Annotated[
        list[Annotated[str, Field(max_length=500)]] | None,
        Field(max_length=12),
        BeforeValidator(_reject_explicit_null),
    ] = None


class CorrectedObservation(_ObservationBase):
    kind: Literal["corrected"]
    value: NutrientValue
    unit: NutrientUnit
    basis: NutrientBasis
    sourceIds: list[SourceId] = Field(min_length=1)
    issues: list[Issue]
    previousSourceIds: list[SourceId] = Field(min_length=1)
    derivation: Annotated[
        list[Annotated[str, Field(max_length=500)]] | None,
        Field(max_length=12),
        BeforeValidator(_reject_explicit_null),
    ] = None


class MissingObservation(_ObservationBase):
    kind: Literal["missing"]
    reason: Literal[
        "not_declared",
        "unreadable",
        "ambiguous",
        "unsupported_basis",
        "conflicting_sources",
        "not_available",
    ]
    issues: list[Issue]


ProductInputObservation = Annotated[
    ReadObservation | UncertainObservation | CorrectedObservation | MissingObservation,
    Field(discriminator="kind"),
]


def _source_lists(
    observation: ReadObservation
    | UncertainObservation
    | CorrectedObservation
    | MissingObservation,
) -> list[list[str]]:
    if isinstance(observation, MissingObservation):
        return []
    lists = [observation.sourceIds]
    if isinstance(observation, CorrectedObservation):
        lists.append(observation.previousSourceIds)
    return lists


class ProductAnalysisInput(WireModel):
    barcode: Annotated[str, Field(pattern=_BARCODE)] | None
    name: Annotated[str, Field(max_length=500)] | None = None
    market: Market
    ingredientsText: Annotated[str, Field(max_length=20000)] | None
    ingredientsStatus: Literal["complete", "partial", "missing", "unreadable"]
    observations: list[ProductInputObservation] = Field(max_length=100)
    sourceRefs: list[ProductInputSource] = Field(max_length=100)
    issues: list[Issue] = Field(max_length=100)

    @model_validator(mode="after")
    def enforce_product_rules(self) -> Self:
        """Complete text is required, and source ids are unique labels.

        The same label may be cited by more than one observation. Two
        ``sourceRefs`` with one id, or one id twice in a single list, are
        duplicates. A citation must name a ``sourceRef`` in this request.
        """

        if self.ingredientsStatus == "complete" and (
            self.ingredientsText is None or self.ingredientsText == ""
        ):
            raise ValueError("complete ingredientsText must be a non-empty string")

        defined: set[str] = set()
        for source in self.sourceRefs:
            if source.id in defined:
                raise ValueError("duplicate source id")
            defined.add(source.id)
        for observation in self.observations:
            for source_ids in _source_lists(observation):
                if len(source_ids) != len(set(source_ids)):
                    raise ValueError("duplicate source id")
                for source_id in source_ids:
                    if source_id not in defined:
                        raise ValueError("unknown source id")
        return self


class ResourceCompatibility(WireModel):
    taxonomyVersion: ShortText
    evidenceVersion: ShortText
    methodEdition: ShortText
    methodBundleSha256: Annotated[str, Field(pattern=_SHA256)]


class AnalyzeRequest(WireModel):
    contractVersion: Literal["0.2.0-draft"]
    product: ProductAnalysisInput
    resourceCompatibility: ResourceCompatibility


class IngredientMention(WireModel):
    id: ShortText
    text: Annotated[str, Field(min_length=1, max_length=2000)]
    parentId: ShortText | None
    canonicalId: ShortText | None
    state: Literal["matched", "ambiguous", "unresolved"]
    candidateIds: list[ShortText] = Field(max_length=20)
    sourceIds: list[ShortText] = Field(min_length=1)
    taxonomyVersion: ShortText


class AnalyzedProduct(WireModel):
    id: ShortText
    barcode: Annotated[str, Field(pattern=_BARCODE)] | None
    name: Annotated[str, Field(max_length=500)] | None
    market: Market
    sourceRefs: list[ProductInputSource]
    observations: list[ProductInputObservation] = Field(max_length=100)
    ingredients: list[IngredientMention] = Field(max_length=300)
    category: Literal["general", "fats_nuts_seeds", "beverage", "excluded", "unknown"]
    taxonomyVersion: ShortText
    evidenceVersion: ShortText


class AnalyzeResponse(WireModel):
    contractVersion: Literal["0.2.0-draft"]
    inputDigest: Annotated[str, Field(pattern=_SHA256)]
    product: AnalyzedProduct
    scientific: ScientificAssessment
    citations: list[Citation]
    issues: list[Issue]


class Problem(WireModel):
    code: Literal[
        "invalid_request",
        "payload_too_large",
        "not_found",
        "rate_limited",
        "unavailable",
    ]
    message: Annotated[str, Field(min_length=1, max_length=500)]
    retryAfterSeconds: Annotated[
        int | None,
        Field(ge=0, strict=True),
        BeforeValidator(_reject_explicit_null),
    ] = None
