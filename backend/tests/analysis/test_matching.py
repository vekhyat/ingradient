"""Source-derived exact-code regressions; these are not shared-vector parity."""

import re
from dataclasses import replace
from pathlib import Path

import pytest

from app.analysis import load_resources
from app.analysis.ingredients import parse_ingredients
from app.analysis.matching import match_ingredient
from app.analysis.resources import AnalysisResources

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def resources() -> AnalysisResources:
    return load_resources()


@pytest.mark.parametrize(
    "text,canonical,source_prefix",
    [
        ("E100", "en:e100", "en: E100, Curcumin,"),
        ("E 100", "en:e100", "en: E100, Curcumin,"),
        ("INS 100", "en:e100", "en: E100, Curcumin,"),
        ("INS 503(ii)", "en:e503(ii)", "en: E503(ii), Ammonium hydrogen carbonate,"),
        ("INS503(II)", "en:e503(ii)", "en: E503(ii), Ammonium hydrogen carbonate,"),
        ("E 503 ( ii )", "en:e503(ii)", "en: E503(ii), Ammonium hydrogen carbonate,"),
        ("INS 503(i)", "en:e503(i)", "en: E503(i), Ammonium carbonate"),
        ("INS 503", "en:e503", "en: E503, Ammonium carbonates"),
        (
            "sodium bicarbonate",
            "en:e500(ii)",
            "en: E500(ii), Sodium hydrogen carbonate,",
        ),
        (
            "Baker's ammonia",
            "en:e503(ii)",
            "en: E503(ii), Ammonium hydrogen carbonate,",
        ),
    ],
)
def test_exact_code_or_alias_keeps_its_pinned_source_identity(
    text: str, canonical: str, source_prefix: str, resources: AnalysisResources
) -> None:
    # Expected identities come from the named English entry in the pinned
    # additives source, not from querying the matcher for its own answer.
    source = (ROOT / "resources/taxonomy/additives.txt").read_text(encoding="utf-8")
    assert any(line.startswith(source_prefix) for line in source.splitlines())
    actual = match_ingredient(text, resources.ingredient_aliases)
    assert actual.state == "matched"
    assert actual.canonical_id == canonical
    mentions, _ = parse_ingredients(text, "complete", ["src-0"], resources)
    assert mentions[0].canonicalId == canonical


@pytest.mark.parametrize("text", ["100", "503(ii)", "2026", "100 g", "E503(iii)"])
def test_unsupported_or_unscoped_code_never_becomes_a_specific_identity(
    text: str, resources: AnalysisResources
) -> None:
    actual = match_ingredient(text, resources.ingredient_aliases)
    assert actual.state == "unresolved"
    assert actual.canonical_id is None


def test_explicit_internal_additive_context_can_resolve_a_bare_exact_code(
    resources: AnalysisResources,
) -> None:
    actual = match_ingredient(
        "503(ii)", resources.ingredient_aliases, additive_context=True
    )
    assert actual.canonical_id == "en:e503(ii)"
    assert actual.candidate_ids == ("en:e503(ii)",)


def test_code_normalization_preserves_conflicting_source_aliases(
    resources: AnalysisResources,
) -> None:
    aliases = dict(resources.ingredient_aliases)
    aliases["e100"] = ("en:e100", "en:conflicting-fixture-identity")
    result = match_ingredient("E 100", aliases)
    assert result.state == "ambiguous"
    assert result.canonical_id is None
    assert result.candidate_ids == aliases["e100"]
    modified = replace(resources, ingredient_aliases=aliases)
    mentions, _ = parse_ingredients("E 100", "complete", ["src-0"], modified)
    assert mentions[0].state == "ambiguous"


def test_related_names_remain_distinct_exact_identities(
    resources: AnalysisResources,
) -> None:
    assert (
        match_ingredient("turmeric", resources.ingredient_aliases).canonical_id
        == "en:turmeric"
    )
    assert (
        match_ingredient("curcumin", resources.ingredient_aliases).canonical_id
        == "en:e100"
    )


@pytest.mark.parametrize(
    "text,expected",
    [
        ("E160a(i)", "en:e160a(i)"),
        ("E 160a ( i )", "en:e160a(i)"),
        ("INS 160a(ii)", "en:e160a(ii)"),
    ],
)
def test_parser_keeps_letter_bearing_code_suffixes_on_one_span(
    text: str, expected: str, resources: AnalysisResources
) -> None:
    mentions, _ = parse_ingredients(text, "complete", ["src-0"], resources)
    assert len(mentions) == 1
    assert mentions[0].text == text
    assert mentions[0].canonicalId == expected


@pytest.mark.parametrize(
    "text",
    ["E150(d)", "E160(a)", "E503(a)", "E503(iii)", "E503(ii)(x)", "E503[bogus]"],
)
def test_parser_does_not_certify_a_parent_when_a_code_suffix_is_unsupported(
    text: str, resources: AnalysisResources
) -> None:
    mentions, issues = parse_ingredients(text, "complete", ["src-0"], resources)
    assert len(mentions) == 1
    assert mentions[0].text == text
    assert mentions[0].state == "unresolved"
    assert mentions[0].canonicalId is None
    assert any(issue.code == "ingredient_identity_unresolved" for issue in issues)


def test_parser_keeps_specific_code_inside_a_class_wrapper(
    resources: AnalysisResources,
) -> None:
    mentions, _ = parse_ingredients(
        "Colour (E160a(i)), salt", "complete", ["src-0"], resources
    )
    assert [mention.text for mention in mentions] == ["Colour", "E160a(i)", "salt"]
    assert mentions[1].canonicalId == "en:e160a(i)"
    assert mentions[1].parentId == mentions[0].id


PARENTHESIZED_SOURCE_CODES = re.findall(
    r"^en:\s*(E\d{3,4}[a-z]?\([ivx]+\))(?=,|\r?$)",
    (ROOT / "resources/taxonomy/additives.txt").read_text(encoding="utf-8"),
    re.MULTILINE | re.IGNORECASE,
)


@pytest.mark.parametrize("code", PARENTHESIZED_SOURCE_CODES)
def test_every_pinned_parenthesized_additive_name_is_one_parser_atom(
    code: str, resources: AnalysisResources
) -> None:
    mentions, _ = parse_ingredients(code, "complete", ["src-0"], resources)
    assert len(mentions) == 1
    assert mentions[0].text == code
    expected_identity = "en:" + code.lower()
    if mentions[0].state == "matched":
        assert mentions[0].canonicalId == expected_identity
    else:
        assert mentions[0].state == "ambiguous"
        assert expected_identity in mentions[0].candidateIds


@pytest.mark.parametrize(
    "text,expected_id,expected_state",
    [("E160a(i)", "en:e160a(i)", "matched"), ("E150(d)", None, "unresolved")],
)
def test_real_route_preserves_the_whole_code_atom(
    text: str,
    expected_id: str | None,
    expected_state: str,
    resources: AnalysisResources,
) -> None:
    from fastapi.testclient import TestClient
    from tests.analysis.test_service import IsolatedSettings, request_payload

    from app.analysis import ReferenceAnalysisService
    from app.main import create_app

    payload = request_payload(resources, adr013=True)
    payload["product"]["ingredientsText"] = text
    app = create_app(
        IsolatedSettings(env="test"),
        analysis_service=ReferenceAnalysisService(resources),
    )
    with TestClient(app) as client:
        response = client.post("/v1/analyses", json=payload)
    assert response.status_code == 200
    mentions = response.json()["product"]["ingredients"]
    assert len(mentions) == 1
    assert mentions[0]["text"] == text
    assert mentions[0]["canonicalId"] == expected_id
    assert mentions[0]["state"] == expected_state
