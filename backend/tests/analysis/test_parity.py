"""The parity tool must detect mismatches and never overstate limited checks."""

import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from app.analysis import CalculationInput, calculate, load_resources

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools/parity"


def test_synthetic_scoring_facts_and_dual_basis_match_actual_typescript() -> None:
    """Exercise both engines and the strict backend replay gate without repinning."""
    bun = shutil.which("bun")
    assert bun is not None, "Bun is required for cross-language regression coverage"
    vectors = json.loads(
        (ROOT / "resources/vectors/nutriscore-vectors.json").read_text(encoding="utf-8")
    )["vectors"]
    general = vectors[0]["inputs"]
    cases = []

    def add(name: str, inputs: dict[str, Any]) -> None:
        cases.append(dict(name=name, inputs=copy.deepcopy(inputs)))

    for protein, salt in ((0, 0.8), (6, 0.8), (20, 0.8), (0, 3), (20, 3)):
        for cheese, red_meat in (
            (False, True),
            (None, True),
            (None, False),
            (False, None),
            (None, None),
            (True, None),
        ):
            inputs = copy.deepcopy(general)
            inputs["flags"].update(cheese=cheese, redMeat=red_meat)
            for o in inputs["observations"]:
                if o["field"] == "protein":
                    o["value"] = protein
                if o["field"] == "salt":
                    o["value"] = salt
            add(
                f"protein-{protein}-salt-{salt}-cheese-{cheese}-redmeat-{red_meat}",
                inputs,
            )
    for vector_id in (
        "vector-general-mid",
        "vector-fats-olive-oil",
        "vector-beverage-sweetener",
    ):
        inputs = copy.deepcopy(
            next(v["inputs"] for v in vectors if v["id"] == vector_id)
        )
        extra = [dict(o, basis="per_serving", value=99) for o in inputs["observations"]]
        inputs["observations"] = extra + inputs["observations"]
        add(vector_id + "-dual-basis", inputs)
        inputs["observations"].append(copy.deepcopy(inputs["observations"][-1]))
        add(vector_id + "-same-basis-conflict", inputs)
        inputs["observations"] = extra
        add(vector_id + "-serving-only", inputs)
    water = copy.deepcopy(
        next(v["inputs"] for v in vectors if v["id"] == "vector-beverage-water")
    )
    water["flags"]["nonNutritiveSweetener"] = "unknown"
    add("water-unknown-sweetener", water)
    water["observations"] = [
        dict(field="sugars", value=1, unit="g", basis="per_serving")
    ]
    add("water-nonzero-other-basis", water)
    beverage = copy.deepcopy(
        next(v["inputs"] for v in vectors if v["id"] == "vector-beverage-sweetener")
    )
    beverage["flags"]["plainWater"] = None
    add("sweetener-excludes-unknown-water", beverage)
    resources = load_resources()
    for case in cases:
        case["backend"] = calculate(
            CalculationInput.model_validate(case["inputs"]),
            resources,
            snapshot_id=case["name"],
        ).model_dump(mode="json")
    # Bun executes the production TS modules directly. No duplicated scoring
    # logic and no Python self-comparison can satisfy these assertions.
    script = r"""
import { readFileSync } from 'node:fs';
import { replayScientificSnapshot }
  from './src/domain/pipeline/replay-scientific-snapshot.ts';
import { renderReplayedBackendReasons }
  from './src/domain/pipeline/backend-replay-renderer.ts';
import manifest from './resources/manifest.json';
import templates from './resources/evidence/reason-templates.json';
const rows = JSON.parse(readFileSync(0, 'utf8')).map(({ name, inputs, backend }) => {
  const presence = (v) => v === null || v === 'unknown' || v === undefined
    ? { state: 'unknown' }
    : { state: v === true || v === 'present' ? 'present' : 'absent',
        sourceIds: ['source'] };
  const snapshot = {
    id: name, barcode: null, name, market: 'EU', capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [{ id: 'source', kind: 'label', title: 'Synthetic label' }],
    category: inputs.category, ingredients: [], panels: [],
    scoringFacts: { categorySourceIds: ['source'],
      ...Object.fromEntries(Object.entries(inputs.flags)
        .map(([k,v]) => [k, presence(v)])) },
    observations: inputs.observations.map((o) => ({ ...o, kind: 'read',
      sourceIds: ['source'], issues: [] })),
    taxonomyVersion: `off-taxonomy-ingredients@${manifest.revision}`,
    evidenceVersion: templates.evidenceEdition,
  };
  return { name, local: replayScientificSnapshot(snapshot).scientific,
    reviewed: renderReplayedBackendReasons(snapshot, backend) };
});
console.log(JSON.stringify(rows));
"""
    run = subprocess.run(
        [bun, "--eval", script],
        cwd=ROOT,
        input=json.dumps(cases),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    rows = json.loads(run.stdout)
    assert len(rows) == len(cases) == 42
    for case, row in zip(cases, rows, strict=True):
        assert row["local"]["state"] == case["backend"]["state"], case["name"]
        if case["backend"]["state"] == "graded":
            assert row["local"] == case["backend"], case["name"]
            assert row["reviewed"]["issues"] == [], case["name"]
            assert row["reviewed"]["reasons"] == case["backend"]["reasons"], case[
                "name"
            ]


@pytest.fixture(scope="module")
def exports(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    folder = tmp_path_factory.mktemp("parity-exports")
    paths: dict[str, Path] = {}
    for scope, args in (("full", []), ("calculation", ["--calculation-only"])):
        result = subprocess.run(
            [sys.executable, str(TOOLS / "run_python.py"), *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        path = folder / f"{scope}.jsonl"
        path.write_text(result.stdout, encoding="utf-8")
        paths[scope] = path
    return paths


def compare(
    left: Path, right: Path, *, limited: bool = False
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(TOOLS / "compare.py"),
            *(["--calculation-only"] if limited else []),
            str(left),
            str(right),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def test_full_export_self_comparison_checks_the_full_shape(
    exports: dict[str, Path],
) -> None:
    result = compare(exports["full"], exports["full"])
    assert result.returncode == 0
    assert "full assessment parity: 15" in result.stdout


def test_changed_rendered_reason_fails(
    exports: dict[str, Path], tmp_path: Path
) -> None:
    records = [json.loads(line) for line in exports["full"].read_text().splitlines()]
    records[0]["assessment"]["reasons"][0]["text"] += " WRONG"
    changed = tmp_path / "changed-reason.jsonl"
    changed.write_text("\n".join(json.dumps(record) for record in records))
    result = compare(exports["full"], changed)
    assert result.returncode == 1
    assert records[0]["id"] in result.stderr


def test_calculation_export_cannot_pass_as_full_parity(
    exports: dict[str, Path],
) -> None:
    result = compare(exports["calculation"], exports["calculation"])
    assert result.returncode == 2
    assert "full assessment parity" not in result.stdout


def test_limited_comparison_states_its_limit(exports: dict[str, Path]) -> None:
    result = compare(exports["calculation"], exports["calculation"], limited=True)
    assert result.returncode == 0
    assert "calculation parity: 15" in result.stdout
    assert "rendered reasons and full trace metadata remain unverified" in result.stdout


def test_identical_but_wrong_scores_fail_the_canonical_check(
    exports: dict[str, Path], tmp_path: Path
) -> None:
    records = [
        json.loads(line) for line in exports["calculation"].read_text().splitlines()
    ]
    records[0]["assessment"]["score"] += 1
    changed = tmp_path / "wrong-score.jsonl"
    changed.write_text("\n".join(json.dumps(record) for record in records))
    result = compare(changed, changed, limited=True)
    assert result.returncode == 1


@pytest.mark.parametrize("damage", ["missing", "duplicate"])
def test_incomplete_or_duplicate_vector_sets_fail(
    damage: str, exports: dict[str, Path], tmp_path: Path
) -> None:
    lines = exports["full"].read_text().splitlines()
    if damage == "missing":
        lines.pop()
    else:
        lines.append(lines[0])
    changed = tmp_path / "invalid-ids.jsonl"
    changed.write_text("\n".join(lines))
    assert compare(changed, changed).returncode == 2
