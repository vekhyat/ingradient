"""The parity tool must detect mismatches and never overstate limited checks."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools/parity"


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
