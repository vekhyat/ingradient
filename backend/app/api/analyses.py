"""POST /v1/analyses. Validates the frozen boundary and does not score or store.

Order of work: rate limit, byte cap, media type, JSON parse, digest of the
parsed product, then Pydantic. Model defaults run after the digest, so a
missing ``name`` and ``"name": null`` keep different hashes. The learning sink
is scheduled only after that response exists, and the default sink stores
nothing.
"""

from typing import get_args

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from rfc8785 import CanonicalizationError

from app.api.body import (
    MalformedBody,
    PayloadTooLarge,
    is_json_content_type,
    read_bounded_body,
)
from app.api.problems import (
    INVALID_REQUEST_MESSAGE,
    PAYLOAD_TOO_LARGE_MESSAGE,
    RATE_LIMITED_MESSAGE,
    UNAVAILABLE_MESSAGE,
    problem_response,
)
from app.contract.digest import input_digest
from app.contract.limits import MAX_REQUEST_BYTES, client_rate_key
from app.contract.models import AnalyzeRequest, AnalyzeResponse
from app.contract.parsing import RequestParseError, parse_json_body
from app.contract.services import LearningSink


class ResponseContractError(Exception):
    """The analysis result is not a response this route can send."""


def contract_version_literal() -> str:
    """The single ``contractVersion`` literal on the request model."""

    annotation = AnalyzeRequest.model_fields["contractVersion"].annotation
    literals = get_args(annotation)
    if len(literals) != 1 or not isinstance(literals[0], str) or literals[0] == "":
        raise RuntimeError("AnalyzeRequest.contractVersion must be one literal")
    return literals[0]


def create_analyses_router(contract_version: str) -> APIRouter:
    """Build POST /v1/analyses for the manifest version already loaded."""

    if contract_version != contract_version_literal():
        raise RuntimeError(
            "contracts/MANIFEST.json contractVersion does not match the analysis schema"
        )

    router = APIRouter()

    @router.post("/v1/analyses")
    async def analyze_product(
        request: Request,
        background: BackgroundTasks,
    ) -> JSONResponse:
        limiter = request.app.state.rate_limiter
        peer = request.client.host if request.client is not None else None
        key = client_rate_key(request.headers.getlist("x-forwarded-for"), peer)
        decision = limiter.allow(key)
        if not decision.allowed:
            return problem_response(
                429,
                "rate_limited",
                RATE_LIMITED_MESSAGE,
                decision.retry_after_seconds,
            )

        try:
            raw = await read_bounded_body(request, MAX_REQUEST_BYTES)
        except PayloadTooLarge:
            return problem_response(
                413,
                "payload_too_large",
                PAYLOAD_TOO_LARGE_MESSAGE,
            )
        except MalformedBody:
            return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)

        if not is_json_content_type(request):
            return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)

        try:
            parsed = parse_json_body(raw)
        except RequestParseError:
            return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)

        digest: str | None = None
        if isinstance(parsed, dict) and "product" in parsed:
            try:
                # Hash the parser's product, not the model. Defaults such as a
                # missing name becoming null would change the digest.
                digest = input_digest(parsed["product"])
            except CanonicalizationError:
                return problem_response(
                    400,
                    "invalid_request",
                    INVALID_REQUEST_MESSAGE,
                )

        try:
            model = AnalyzeRequest.model_validate(parsed)
        except ValidationError:
            return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)
        if digest is None:
            return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)

        try:
            assessed = request.app.state.analysis_service.assess(
                model,
                input_digest=digest,
            )
        except Exception:
            return problem_response(503, "unavailable", UNAVAILABLE_MESSAGE)

        try:
            response_model = _finalize_response(assessed, digest, contract_version)
        except ValidationError, ResponseContractError, AttributeError:
            return problem_response(503, "unavailable", UNAVAILABLE_MESSAGE)

        background.add_task(
            _record_quietly,
            request.app.state.learning_sink,
            model,
            response_model,
        )
        return JSONResponse(
            status_code=200,
            content=response_model.model_dump(mode="json", exclude_unset=True),
        )

    return router


def _finalize_response(
    assessed: AnalyzeResponse,
    digest: str,
    contract_version: str,
) -> AnalyzeResponse:
    payload = assessed.model_dump(mode="json", exclude_unset=True)
    payload["inputDigest"] = digest
    payload["contractVersion"] = contract_version
    validated = AnalyzeResponse.model_validate(payload)
    scientific_id = validated.scientific.inputSnapshotId
    if validated.product.id != scientific_id or validated.inputDigest != digest:
        raise ResponseContractError
    return validated


def _record_quietly(
    sink: LearningSink,
    request_model: AnalyzeRequest,
    response_model: AnalyzeResponse,
) -> None:
    """Run the sink after the response. Discard failures without logging them.

    An exception here can quote product text. There is no reviewed log for
    that, and collection is off, so the failure is not recorded.
    """

    try:
        sink.record(request_model, response_model)
    except Exception:
        return
