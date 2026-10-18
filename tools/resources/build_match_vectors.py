"""Build engineering match fixtures from explicit pinned OFF source identities.

This deliberately imports no application matcher. Expected identities are
reviewed below against exact English taxonomy entries, not harvested outputs.
Run --check to detect drift without writing any resource or manifest.
"""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "resources/vectors/match-vectors.json"
EDITION = "off-exact-match-2026-10-17.1"

# A source relation is not an alias. Only the English identity/synonym line is
# cited here; parent, origin, derivative and advisory prose must not resolve it.
SOURCES = {
    "salt": ("ingredients", "salt"),
    "water": ("ingredients", "water"),
    "milk": ("ingredients", "milk"),
    "skimmed-milk": ("ingredients", "skimmed milk"),
    "whey": ("ingredients", "whey"),
    "lactose": ("ingredients", "lactose"),
    "turmeric": ("ingredients", "turmeric"),
    "whole-wheat": ("ingredients", "whole wheat flour"),
    "atta": ("ingredients", "atta"),
    "maida": ("ingredients", "maida"),
    "refined-wheat": ("ingredients", "refined wheat flour"),
    "e100": ("additives", "E100"),
    "e503": ("additives", "E503"),
    "e503ii": ("additives", "E503(ii)"),
    "e160ai": ("additives", "E160a(i)"),
    "e150d": ("additives", "E150d"),
}


def document():
    manifest = json.loads((ROOT / "resources/manifest.json").read_text("utf-8"))
    source_pins = []
    lines_by_kind = {}
    for kind in ("ingredients", "additives"):
        pin = next(b for b in manifest["bundles"] if b["bundleId"] == f"off-taxonomy-{kind}")
        raw = (ROOT / "resources" / pin["path"]).read_bytes()
        if len(raw) != pin["sizeBytes"] or hashlib.sha256(raw).hexdigest() != pin["sha256"]:
            raise ValueError(f"Pinned {kind} taxonomy integrity mismatch")
        source_pins.append({k: pin[k] for k in ("bundleId", "path", "sha256", "sizeBytes", "sourceUrl", "licence", "attribution")})
        lines_by_kind[kind] = raw.decode("utf-8").splitlines()
    citations = {}
    for key, (kind, first_name) in SOURCES.items():
        matches = [(n, line) for n, line in enumerate(lines_by_kind[kind], 1)
                   if line.startswith("en:") and line[3:].strip().split(",")[0] == first_name]
        if len(matches) != 1:
            raise ValueError(f"Expected one canonical English source for {key}: {matches}")
        number, line = matches[0]
        citations[key] = {
            "bundleId": f"off-taxonomy-{kind}", "line": number,
            "englishEntry": line, "canonicalId": "en:" + first_name.lower().replace(" ", "-"),
        }

    vectors = []

    def add(id, text, refs, expected_ids=(), *, additive=False, why):
        identities = sorted(expected_ids)
        vectors.append({
            "id": id, "input": {"text": text, "additiveContext": additive},
            "expected": {"state": "matched" if len(identities) == 1 else "ambiguous" if identities else "unresolved",
                         "canonicalId": identities[0] if len(identities) == 1 else None,
                         "candidateIds": identities},
            "sourceRefs": refs, "rationale": why,
        })

    add("salt-exact", "salt", ["salt"], ["en:salt"], why="English canonical entry.")
    add("salt-synonym", "table salt", ["salt"], ["en:salt"], why="Explicit synonym on the same English line.")
    add("salt-whitespace-case", "  TABLE   Salt  ", ["salt"], ["en:salt"], why="Case/whitespace normalization only.")
    add("water-synonym", "drinking water", ["water"], ["en:water"], why="Explicit English synonym; this is ingredient identity, not a plain-water product assertion.")
    add("milk-identity", "milk", ["milk"], ["en:milk"], why="No inferred derivative or allergen status.")
    add("numeric-leading-alias", "1% fat milk", ["skimmed-milk"], ["en:skimmed-milk"], why="An exact numeric-leading English food alias is not malformed additive syntax.")
    add("lactose-synonym", "milk sugar", ["lactose", "milk"], ["en:lactose"], why="Source synonym resolves lactose, never milk identity.")
    add("whey-synonym", "milk whey", ["whey", "milk"], ["en:whey"], why="Derivative relationship does not replace whey with milk.")
    add("turmeric-identity", "turmeric", ["turmeric", "e100"], ["en:turmeric"], why="Turmeric is distinct from the additive identity E100.")
    add("curcumin-alias", "Curcumin", ["e100", "turmeric"], ["en:e100"], why="Pinned additive English alias, distinct from turmeric root.")
    add("turmeric-extract-alias", "Turmeric extract", ["e100", "turmeric"], ["en:e100"], why="This exact extract alias is listed for E100; the rule does not generalize to turmeric.")
    add("e-code-exact", "E100", ["e100"], ["en:e100"], why="Explicit E prefix establishes additive-code context.")
    add("e-code-spaced", "E 100", ["e100"], ["en:e100"], why="Spacing normalization preserves the source code identity.")
    add("ins-code", "INS 100", ["e100"], ["en:e100"], why="Accepted E/INS code normalization is identity lookup only; no jurisdictional permission inferred.")
    add("bare-number-refused", "100", ["e100"], why="A bare number outside additive context is not an additive assertion.")
    add("bare-number-contextual", "100", ["e100"], ["en:e100"], additive=True, why="Explicit parser-provided additive context permits the code lookup.")
    add("e503-group", "E503", ["e503", "e503ii"], ["en:e503"], why="A group does not auto-resolve to a specific suffix member.")
    add("suffix-roman", "E503(ii)", ["e503ii"], ["en:e503(ii)"], why="Meaningful parentheses remain in the canonical source key.")
    add("suffix-ins", "INS503(ii)", ["e503ii"], ["en:e503(ii)"], why="INS prefix plus meaningful suffix.")
    add("suffix-spaced", "E503 ( ii )", ["e503ii"], ["en:e503(ii)"], why="Internal code spacing changes no suffix meaning.")
    add("suffix-contextual", "503(ii)", ["e503ii"], ["en:e503(ii)"], additive=True, why="Context permits the complete specific code, not its group.")
    add("suffix-without-context", "503(ii)", ["e503ii"], why="No E/INS prefix or explicit additive context.")
    add("letter-roman-suffix", "E160a(i)", ["e160ai"], ["en:e160a(i)"], why="Preserve both the letter and roman suffix.")
    add("letter-suffix", "E150d", ["e150d"], ["en:e150d"], why="Letter suffix is part of the English source code.")
    add("letter-parenthesis-refused", "E150(d)", ["e150d"], why="Source has E150d, not E150(d); never repair unsupported syntax into a different code.")
    add("unsupported-roman-refused", "E503(x)", ["e503", "e503ii"], why="A missing suffix identity must not collapse to the group.")
    add("repeated-suffix-refused", "E503(ii)(ii)", ["e503ii"], why="Malformed repeated suffix is not a valid source alias.")
    add("mixed-repeated-suffix-refused", "E160a(i)(ii)", ["e160ai"], why="Do not truncate a code to its first valid prefix.")
    add("trailing-code-junk-refused", "E503(ii)junk", ["e503ii"], why="Whole text must match; trailing junk is unresolved.")
    add("unknown-code", "E9999", ["e100"], why="No exact English source alias exists for the supplied code.")
    add("atta-collision", "atta", ["whole-wheat", "atta"], ["en:atta", "en:whole-wheat-flour"], why="Two explicit English entries share this alias; retain both, choose neither.")
    add("maida-collision", "maida", ["maida", "refined-wheat"], ["en:maida", "en:refined-wheat-flour"], why="Two exact source identities; no guessed canonical winner.")
    add("fuzzy-not-promoted", "sallt", ["salt"], why="Exact parity profile excludes fuzzy suggestions. Local suggestions may remain candidates, never a matched identity.")
    add("origin-prose-not-synonym", "derived from milk", ["milk"], why="Origin/derivation prose is not an English synonym.")
    add("advisory-not-synonym", "may contain milk", ["milk"], why="The scalar matcher must not turn an advisory declaration into ingredient identity; the parser retains its separate evidence kind.")
    add("wrapper-not-scalar-alias", "Colour(E160a(i))", ["e160ai"], why="This full wrapper is parser input, not an exact alias. Parser+matcher integration separately resolves the inner code and preserves the wrapper.")
    add("empty-input", "", [], why="No text provides no identity.")

    for vector in vectors:
        allowed = {citations[key]["canonicalId"] for key in vector["sourceRefs"]}
        if not set(vector["expected"]["candidateIds"]) <= allowed:
            raise ValueError(f"Uncited expected identity: {vector['id']}")
    return {
        "schemaVersion": 1, "edition": EDITION,
        "profile": "exact-identity", "canonicalConvention": "First English taxonomy name, lowercased with spaces replaced by hyphens; significant code parentheses preserved.",
        "scope": "Project-authored source-derived engineering fixtures. Not official OFF vectors, independent human research gold, food authorisation or health evidence.",
        "licence": "OFF-derived taxonomy expectations: ODbL v1.0 / DbCL v1.0. Project-authored test scaffolding: project licence pending owner/team decision.",
        "attribution": "Open Food Facts contributors (https://world.openfoodfacts.org/terms-of-use)",
        "comparison": "Compare state, canonicalId and lexically sorted candidateIds for every exact-identity vector. Do not mix these counts with nutrition calculation parity. Fuzzy suggestions and parser wrapper handling require separate tests; they cannot upgrade identity.",
        "sourcePins": source_pins, "sources": citations, "vectors": vectors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = (json.dumps(document(), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != data:
            raise SystemExit("Match fixture drift: run python tools/resources/build_match_vectors.py and review the source/manifest changes")
    else:
        TARGET.write_bytes(data)
    print(f"{'Verified' if args.check else 'Wrote'} {len(document()['vectors'])} match vectors; sha256={hashlib.sha256(data).hexdigest()}; bytes={len(data)}")


if __name__ == "__main__":
    main()
