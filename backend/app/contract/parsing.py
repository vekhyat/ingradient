"""JSON parsing that refuses shapes RFC 8785 cannot canonicalize."""

import json

# The frozen request schema has at most six nested containers (an observation
# issue). Leave ample headroom without relying on Python's recursion limit.
MAX_JSON_DEPTH = 32


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
        parsed: object = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
        validate_json_depth(parsed)
        return parsed
    except RequestParseError:
        raise
    except (ValueError, RecursionError) as error:
        raise RequestParseError from error


def validate_json_depth(value: object) -> None:
    """Bound container nesting iteratively, including at the digest boundary."""

    pending = [(value, 0)]
    while pending:
        current, depth = pending.pop()
        if isinstance(current, (dict, list)):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise RequestParseError
            children = current.values() if isinstance(current, dict) else current
            pending.extend((child, depth) for child in children)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in pairs:
        if key in parsed:
            raise RequestParseError
        parsed[key] = value
    return parsed


def _reject_non_finite(_token: str) -> object:
    raise RequestParseError
