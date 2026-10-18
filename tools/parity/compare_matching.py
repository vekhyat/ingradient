"""Compare both actual exact-match exports with each other AND pinned expected IDs."""

import argparse
import sys
from pathlib import Path

from matching import ROOT, load_export, load_fixture


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, default=ROOT / "resources")
    parser.add_argument("python_export", type=Path)
    parser.add_argument("typescript_export", type=Path)
    args = parser.parse_args()
    try:
        edition, vectors = load_fixture(args.resources)
        expected = {vector.id: vector.expected.comparison() for vector in vectors}
        left, right = (
            load_export(args.python_export),
            load_export(args.typescript_export),
        )
        if set(left) != set(expected) or set(right) != set(expected):
            raise ValueError("missing or extra matching vector ids")
        different = [
            key
            for key in sorted(expected)
            if left[key] != expected[key] or right[key] != expected[key]
        ]
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"invalid matching export: {type(error).__name__}", file=sys.stderr)
        return 2
    if different:
        print("matching mismatch: " + ", ".join(different), file=sys.stderr)
        return 1
    print(f"exact matching parity: {len(expected)} vectors; edition {edition}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
