"""Problem responses from the frozen operation examples.

Messages are fixed. A validation error can contain ingredient text, so the
response never echoes the parser's message and this module does not log it.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.contract.models import Problem

INVALID_REQUEST_MESSAGE = "Invalid product facts or undocumented field."
PAYLOAD_TOO_LARGE_MESSAGE = "Product request exceeds the accepted size bound."
RATE_LIMITED_MESSAGE = "Wait for the retry cooldown."
UNAVAILABLE_MESSAGE = "Backend analysis unavailable; local fallback may run."


def problem_response(
    status_code: int,
    code: str,
    message: str,
    retry_after_seconds: int | None = None,
) -> JSONResponse:
    """Return a Problem body. ``Retry-After`` is set only for a cooldown."""

    body: dict[str, object] = {"code": code, "message": message}
    headers: dict[str, str] | None = None
    if retry_after_seconds is not None:
        body["retryAfterSeconds"] = retry_after_seconds
        headers = {"Retry-After": str(retry_after_seconds)}
    payload = Problem.model_validate(body).model_dump(mode="json", exclude_unset=True)
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


def install_problem_handlers(app: FastAPI) -> None:
    """Turn framework validation into the contract's 400. Do not log the input."""

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        _request: Request,
        _exc: RequestValidationError,
    ) -> JSONResponse:
        return problem_response(400, "invalid_request", INVALID_REQUEST_MESSAGE)
