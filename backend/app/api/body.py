"""Read a POST body without accepting more than the frozen byte cap.

The cap is applied to ``Content-Length`` before the body is read, and again to
the bytes actually received. Either one is enough to refuse the request. The
bytes are returned only when they are within the cap. They are not parsed here.
"""

from fastapi import Request


class PayloadTooLarge(Exception):
    """The declared or received body is larger than the cap."""


class MalformedBody(Exception):
    """``Content-Length`` is not a single non-negative integer."""


async def read_bounded_body(request: Request, limit: int) -> bytes:
    """Return the raw body, or raise before the caller parses it."""

    lengths = request.headers.getlist("content-length")
    if len(lengths) > 1:
        raise MalformedBody
    if len(lengths) == 1:
        declared = lengths[0].strip()
        if not declared.isdigit() or len(declared) > 16:
            raise MalformedBody
        if int(declared) > limit:
            raise PayloadTooLarge

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise PayloadTooLarge
        chunks.append(chunk)
    return b"".join(chunks)


def is_json_content_type(request: Request) -> bool:
    """True when the only media type is ``application/json``.

    A charset parameter is allowed. Any other media type, or more than one
    ``Content-Type`` header, is not the contract's request body.
    """

    values = request.headers.getlist("content-type")
    if len(values) != 1:
        return False
    media_type = values[0].split(";", 1)[0].strip().lower()
    return media_type == "application/json"
