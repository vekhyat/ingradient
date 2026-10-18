"""Export public canonical fixtures from the actual Python calculator.

Default: complete assessment. --calculation-only: explicitly limited numeric
calculation and refusal parity; never claims rendered explanation parity.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def calculation_view(assessment: dict[str, Any]) -> dict[str, Any]:
    if assessment["state"] != "graded":
        return {"state": assessment["state"], "issues": assessment["issues"]}
    return {
        **{
            key: assessment[key]
            for key in ("state", "grade", "score", "route", "method", "issues")
        },
        "components": sorted(
            (
                {"component": step["component"], "points": step["points"]}
                for step in assessment["trace"]
            ),
            key=lambda step: step["component"],
        ),
    }


def main() -> None:
    from app.analysis import CalculationInput, calculate, load_resources

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calculation-only", action="store_true")
    args = parser.parse_args()
    resources = load_resources()
    vectors = json.loads(
        (ROOT / "resources/vectors/nutriscore-vectors.json").read_text(encoding="utf-8")
    )["vectors"]
    for vector in vectors:
        assessment = calculate(
            CalculationInput.model_validate(vector["inputs"]),
            resources,
            snapshot_id=vector["expectedAssessment"]["inputSnapshotId"],
        ).model_dump(mode="json", exclude_unset=True)
        print(
            json.dumps(
                {
                    "id": vector["id"],
                    "scope": "calculation"
                    if args.calculation_only
                    else "full-assessment",
                    "assessment": calculation_view(assessment)
                    if args.calculation_only
                    else assessment,
                },
                ensure_ascii=True,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
