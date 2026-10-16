"""Analysis and learning interfaces. The defaults do not score and do not store.

BE-12 replaces the analysis service. BE-13 replaces the learning sink, and only
after collection is released. This module does not import a database driver.
"""

from typing import Protocol
from uuid import uuid4

from app.contract.models import (
    AnalyzedProduct,
    AnalyzeRequest,
    AnalyzeResponse,
    GapAssessment,
    Issue,
)

NAMED_GAP_CODE = "candidate_method_not_released"
NAMED_GAP_MESSAGE = "A reviewed compatible method bundle is not available."


class AnalysisService(Protocol):
    """Turn a validated request into a contract response.

    ``input_digest`` is the hash of the parsed product before model defaults.
    The route writes that same digest onto the response after this returns.
    """

    def assess(
        self,
        request: AnalyzeRequest,
        *,
        input_digest: str,
    ) -> AnalyzeResponse:
        """Return a graded result or a named gap. Do not guess a letter."""
        ...


class LearningSink(Protocol):
    """Accept product facts after the response has been sent.

    The arguments are the product request and the analysis response. There is
    no client address parameter. The default implementation stores nothing.
    """

    def record(self, request: AnalyzeRequest, response: AnalyzeResponse) -> None:
        """Record product facts, or do nothing while collection is off."""
        ...


class NamedGapAnalysisService:
    """The boundary's analysis until a reviewed method bundle is wired in."""

    def assess(
        self,
        request: AnalyzeRequest,
        *,
        input_digest: str,
    ) -> AnalyzeResponse:
        snapshot_id = "gap-" + uuid4().hex
        gap = Issue(
            code=NAMED_GAP_CODE,
            stage="method",
            message=NAMED_GAP_MESSAGE,
            action="none",
        )
        product = request.product
        return AnalyzeResponse(
            contractVersion=request.contractVersion,
            inputDigest=input_digest,
            product=AnalyzedProduct(
                id=snapshot_id,
                barcode=product.barcode,
                name=product.name,
                market=product.market,
                sourceRefs=product.sourceRefs,
                observations=product.observations,
                ingredients=[],
                category="unknown",
                taxonomyVersion=request.resourceCompatibility.taxonomyVersion,
                evidenceVersion=request.resourceCompatibility.evidenceVersion,
            ),
            scientific=GapAssessment(
                state="method_unavailable",
                inputSnapshotId=snapshot_id,
                reasons=[],
                issues=[gap],
            ),
            citations=[],
            issues=[gap],
        )


class NullLearningSink:
    """Collection is off. Calling this does not open a database."""

    def record(self, request: AnalyzeRequest, response: AnalyzeResponse) -> None:
        return None
