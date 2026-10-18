"""Compare actual engine exports with an explicit full or calculation scope.

Full mode includes every field, including rendered reasons. Limited mode must
be requested explicitly; it checks state, letter, score, method, component
points and refusals against both runtimes and the canonical supplied outputs.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def load(path: Path, scope: str) -> dict[str, Any]:
    from pydantic import TypeAdapter

    from app.contract.models import ScientificAssessment

    records: dict[str, Any] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        record = json.loads(line)
        if record["scope"] != scope:
            raise ValueError("parity scope mismatch")
        if record["id"] in records:
            raise ValueError("duplicate vector id")
        assessment = record["assessment"]
        if scope == "full-assessment":
            TypeAdapter(ScientificAssessment).validate_python(assessment)
        records[record["id"]] = assessment
    return records


def follows_canonical(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    if actual["state"] != expected["state"]:
        return False
    if actual["state"] != "graded":
        return actual == {"state": expected["state"], "issues": expected["issues"]}
    if any(
        actual.get(key) != expected[key]
        for key in ("grade", "score", "route", "method", "issues")
    ):
        return False
    components = {step["component"]: step["points"] for step in actual["components"]}
    return all(
        components.get(step["component"]) == step["points"]
        for step in expected["trace"]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calculation-only", action="store_true")
    parser.add_argument("python_export", type=Path)
    parser.add_argument("typescript_export", type=Path)
    args = parser.parse_args()
    scope = "calculation" if args.calculation_only else "full-assessment"
    try:
        left, right = (
            load(path, scope) for path in (args.python_export, args.typescript_export)
        )
        vectors = json.loads(
            (ROOT / "resources/vectors/nutriscore-vectors.json").read_text(
                encoding="utf-8"
            )
        )["vectors"]
        expected_ids = {vector["id"] for vector in vectors}
        if set(left) != expected_ids or set(right) != expected_ids:
            raise ValueError("missing or extra canonical vector ids")
        different = [key for key in sorted(expected_ids) if left[key] != right[key]]
        if args.calculation_only:
            different = sorted(
                set(different)
                | {
                    vector["id"]
                    for vector in vectors
                    if not follows_canonical(
                        left[vector["id"]], vector["expectedAssessment"]
                    )
                    or not follows_canonical(
                        right[vector["id"]], vector["expectedAssessment"]
                    )
                }
            )
        if different:
            print("parity mismatch: " + ", ".join(different), file=sys.stderr)
            return 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("invalid parity export: " + type(error).__name__, file=sys.stderr)
        return 2
    if args.calculation_only:
        print(
            f"calculation parity: {len(left)} vectors; "
            "rendered reasons and full trace metadata remain unverified"
        )
    else:
        print(f"full assessment parity: {len(left)} vectors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
