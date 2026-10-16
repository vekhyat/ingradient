"""JSON parsing that refuses shapes RFC 8785 cannot canonicalize."""

import json


class RequestParseError(Exception):
    """The body is not JSON, or it breaks a canonicalization precondition."""


def parse_json_body(raw: bytes) -> object:
    """Parse UTF-8 JSON. Duplicate keys and non-finite numbers are errors.

    RFC 8785 requires both rejections. ``json.loads`` would otherwise keep the
    last duplicate and, by default, accept ``NaN`` and infinities.
    """

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RequestParseError from error

    try:
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
    except RequestParseError:
        raise
    except ValueError as error:
        raise RequestParseError from error


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in pairs:
        if key in parsed:
            raise RequestParseError
        parsed[key] = value
    return parsed


def _reject_non_finite(_token: str) -> object:
    raise RequestParseError
