"""Execute shared identities and prove the CLI rejects misleading parity evidence."""

import copy
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, TypedDict

import pytest

from app.analysis import load_resources
from app.analysis.matching import match_ingredient
from app.analysis.resources import AnalysisResources

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools/parity"
FIXTURE = json.loads(
    (ROOT / "resources/vectors/match-vectors.json").read_text(encoding="utf-8")
)


class MatchingCase(TypedDict):
    text: str
    additiveContext: bool


@pytest.fixture(scope="module")
def resources() -> AnalysisResources:
    return load_resources()


def test_review_regressions_match_actual_typescript(
    resources: AnalysisResources,
) -> None:
    """Compare the source loaders and code namespaces, not a shared mock index."""
    bun = shutil.which("bun")
    assert bun is not None, "Bun is required for cross-language regression coverage"
    texts = [
        "tomato",
        "lycopene, tomato",
        "lycopene",
        "synthetic",
        "E1200",
        "INS 1200",
        "polydextrose",
        "table salt",
        "\ufeffTABLE\u00a0SALT\ufeff",
        "\x1ctable salt\x1c",
        "E150(d)",
        "150(a)",
        "E160(a)",
        "INS503(ii)",
        "E503 ( ii )",
        "E503(x)",
        "E150a(b)",
        "E160a(i)(ii)",
        "100",
        "503(ii)",
        "1% fat milk",
        "atta",
    ]
    cases: list[MatchingCase] = [
        {"text": text, "additiveContext": contextual}
        for text in texts
        for contextual in (False, True)
    ]
    result = subprocess.run(
        [
            bun,
            "--eval",
            "import {matchIngredient} from './src/domain/matching/match-ingredient.ts';"
            "const cases=JSON.parse(await Bun.stdin.text());"
            "console.log(JSON.stringify(cases.map(c=>"
            "matchIngredient(c.text,{additiveContext:c.additiveContext}))));",
        ],
        cwd=ROOT,
        input=json.dumps(cases),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    actual = json.loads(result.stdout)
    for case, typescript in zip(cases, actual, strict=True):
        python = match_ingredient(
            case["text"],
            resources.ingredient_aliases,
            additive_context=case["additiveContext"],
        )
        assert typescript == {
            "state": python.state,
            "canonicalId": python.canonical_id,
            "candidateIds": list(python.candidate_ids),
        }, case


@pytest.mark.parametrize("vector", FIXTURE["vectors"], ids=lambda v: v["id"])
def test_shared_matching_identity(
    vector: dict[str, Any], resources: AnalysisResources
) -> None:
    result = match_ingredient(
        vector["input"]["text"],
        resources.ingredient_aliases,
        additive_context=vector["input"]["additiveContext"],
    )
    assert {
        "state": result.state,
        "canonicalId": result.canonical_id,
        "candidateIds": sorted(result.candidate_ids),
    } == vector["expected"]


def run(tool: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOLS / tool), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


@pytest.fixture(scope="module")
def exported(tmp_path_factory: pytest.TempPathFactory) -> Path:
    result = run("run_python_matching.py")
    assert result.returncode == 0, result.stderr
    path = tmp_path_factory.mktemp("matching-exports") / "python.jsonl"
    path.write_text(result.stdout, encoding="utf-8")
    return path


def test_export_contains_every_actual_identity(exported: Path) -> None:
    records = [json.loads(line) for line in exported.read_text().splitlines()]
    expected = {v["id"]: v["expected"] for v in FIXTURE["vectors"]}
    assert {record["id"]: record["match"] for record in records} == expected
    assert all(record["scope"] == "exact-matching" for record in records)
    # This proves comparator acceptance only; actual TS is run separately in CI.
    result = run("compare_matching.py", str(exported), str(exported))
    assert result.returncode == 0, result.stderr
    assert "exact matching parity: 37" in result.stdout


@pytest.mark.parametrize(
    "damage", ["wrong_identity", "missing", "extra", "duplicate", "scope", "shape"]
)
def test_bad_or_identically_wrong_exports_fail(
    damage: str, exported: Path, tmp_path: Path
) -> None:
    records = [json.loads(line) for line in exported.read_text().splitlines()]
    expected_exit = 2
    if damage == "wrong_identity":
        records[0]["match"].update(canonicalId="en:wrong", candidateIds=["en:wrong"])
        expected_exit = 1
    elif damage == "missing":
        records.pop()
    elif damage == "extra":
        records.append({**records[0], "id": "not-reviewed"})
    elif damage == "duplicate":
        records.append(records[0])
    elif damage == "scope":
        records[0]["scope"] = "calculation"
    elif damage == "shape":
        records[0]["match"]["candidateIds"].append("en:other")
    path = tmp_path / "changed.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
    result = run("compare_matching.py", str(path), str(path))
    assert result.returncode == expected_exit
    assert "exact matching parity" not in result.stdout


def test_candidate_order_is_not_identity_drift(exported: Path, tmp_path: Path) -> None:
    records = [json.loads(line) for line in exported.read_text().splitlines()]
    for record in records:
        record["match"]["candidateIds"].reverse()
    path = tmp_path / "reordered.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
    assert run("compare_matching.py", str(exported), str(path)).returncode == 0


@pytest.mark.parametrize(
    "damage", ["fixture_bytes", "taxonomy_bytes", "source_pin", "duplicate", "profile"]
)
def test_damaged_fixture_or_sources_publish_no_partial_output(
    damage: str, tmp_path: Path
) -> None:
    resource_root = tmp_path / "resources"
    shutil.copytree(ROOT / "resources", resource_root)
    fixture_path = resource_root / "vectors/match-vectors.json"
    if damage == "fixture_bytes":
        fixture_path.write_bytes(fixture_path.read_bytes() + b" ")
    elif damage == "taxonomy_bytes":
        path = resource_root / "taxonomy/additives.txt"
        path.write_bytes(path.read_bytes() + b" ")
    else:
        fixture = copy.deepcopy(FIXTURE)
        if damage == "source_pin":
            fixture["sourcePins"][0]["sha256"] = "0" * 64
        elif damage == "duplicate":
            fixture["vectors"].append(fixture["vectors"][0])
        else:
            fixture["profile"] = "fuzzy"
        raw = json.dumps(fixture).encode()
        fixture_path.write_bytes(raw)
        manifest_path = resource_root / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        bundle = next(
            b for b in manifest["bundles"] if b["bundleId"] == "off-exact-match-vectors"
        )
        bundle.update(sha256=hashlib.sha256(raw).hexdigest(), sizeBytes=len(raw))
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    result = run("run_python_matching.py", "--resources", str(resource_root))
    assert result.returncode == 2
    assert result.stdout == ""
