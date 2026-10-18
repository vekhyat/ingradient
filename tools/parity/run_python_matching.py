"""Execute the real Python exact matcher on reviewed, pinned shared vectors."""

import argparse
import json
import sys
from pathlib import Path

from matching import ROOT, load_fixture


def main() -> int:
    from app.analysis import load_resources
    from app.analysis.matching import match_ingredient

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, default=ROOT / "resources")
    parser.add_argument("--vectors", type=Path)
    args = parser.parse_args()
    try:
        _, vectors = load_fixture(args.resources, args.vectors)
        resources = load_resources(args.resources)
        # Buffer the whole export: a failure must not publish partial evidence.
        records = []
        for vector in vectors:
            result = match_ingredient(
                vector.input.text,
                resources.ingredient_aliases,
                additive_context=vector.input.additiveContext,
            )
            records.append(
                json.dumps(
                    {
                        "id": vector.id,
                        "scope": "exact-matching",
                        "match": {
                            "state": result.state,
                            "canonicalId": result.canonical_id,
                            "candidateIds": sorted(result.candidate_ids),
                        },
                    },
                    ensure_ascii=True,
                    sort_keys=True,
                )
            )
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"invalid matching resources: {type(error).__name__}", file=sys.stderr)
        return 2
    print("\n".join(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
