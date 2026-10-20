"""inputDigest matches the frozen vectors, before model defaults."""

import json
from typing import Any

import pytest
from rfc8785 import CanonicalizationError, dumps
from tests.contract.support import VECTORS_PATH, load_json

from app.contract.digest import input_digest
from app.contract.models import ProductAnalysisInput
from app.contract.parsing import MAX_JSON_DEPTH, RequestParseError, parse_json_body


def _cases() -> list[dict[str, Any]]:
    document = load_json(VECTORS_PATH)
    cases = document["cases"]
    if not isinstance(cases, list) or cases == []:
        raise AssertionError("digest vectors are missing")
    return cases


def test_every_digest_vector_matches_rfc8785() -> None:
    cases = _cases()
    kinds = {case["kind"] for case in cases}
    assert "product" in kinds
    assert "canonicalization" in kinds
    absent = next(case for case in cases if case["name"] == "optional name absent")
    present = next(
        case for case in cases if case["name"] == "optional name present as null"
    )
    assert absent["sha256"] != present["sha256"]

    for case in cases:
        assert dumps(case["value"]) == case["canonical"].encode("utf-8")
        assert input_digest(case["value"]) == case["sha256"]


def test_model_default_for_absent_name_would_change_the_digest() -> None:
    cases = _cases()
    absent = next(case for case in cases if case["name"] == "optional name absent")
    null_name = next(
        case for case in cases if case["name"] == "optional name present as null"
    )
    raw: dict[str, Any] = absent["value"]
    assert "name" not in raw
    assert input_digest({**raw, "name": None}) == null_name["sha256"]

    filled = ProductAnalysisInput.model_validate(raw).model_dump(mode="json")
    assert filled["name"] is None
    assert filled["observations"][0]["derivation"] is None
    assert "derivation" not in raw["observations"][0]
    assert input_digest(raw) == absent["sha256"]
    # Defaults insert name and derivation. Neither frozen vector is that object.
    assert input_digest(filled) != absent["sha256"]
    assert input_digest(filled) != null_name["sha256"]


@pytest.mark.parametrize(
    "raw",
    [
        b'{"a": 1, "a": 2}',
        b'{"product": {"name": "a", "name": "b"}}',
        b'{"value": NaN}',
        b'{"value": Infinity}',
        b'{"value": -Infinity}',
    ],
)
def test_parser_rejects_duplicate_keys_and_non_finite_numbers(raw: bytes) -> None:
    with pytest.raises(RequestParseError):
        parse_json_body(raw)


def test_digest_survives_a_json_round_trip_of_special_numbers() -> None:
    """Canonicalization vectors are not products. The route hashes the same function."""

    cases = [case for case in _cases() if case["kind"] == "canonicalization"]
    assert len(cases) == 2
    for case in cases:
        parsed = json.loads(json.dumps(case["value"]))
        assert input_digest(parsed) == case["sha256"]


def test_parser_and_digest_enforce_the_same_explicit_nesting_bound() -> None:
    raw = b"[" * MAX_JSON_DEPTH + b'"{}[]\\""' + b"]" * MAX_JSON_DEPTH
    parsed = parse_json_body(raw)
    assert input_digest(parsed)
    with pytest.raises(RequestParseError):
        parse_json_body(b"[" + raw + b"]")
    with pytest.raises(CanonicalizationError):
        input_digest([parsed])


def test_digest_rejects_deep_programmatic_input_without_recursing() -> None:
    value: object = "private-product-text"
    for _ in range(1100):
        value = {"x": value}
    with pytest.raises(CanonicalizationError):
        input_digest(value)


@pytest.mark.parametrize("boundary", ["parse", "digest"])
def test_runtime_recursion_errors_are_translated(
    boundary: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def recurse(*_args: object, **_kwargs: object) -> object:
        raise RecursionError("private-product-text")

    if boundary == "parse":
        monkeypatch.setattr("app.contract.parsing.json.loads", recurse)
        with pytest.raises(RequestParseError):
            parse_json_body(b"{}")
    else:
        monkeypatch.setattr("app.contract.digest.dumps", recurse)
        with pytest.raises(CanonicalizationError):
            input_digest({})
