"""Exact ingredient identities from the pinned taxonomy, without fuzzy inference."""

import re
from dataclasses import dataclass
from typing import Literal

# Parentheses are significant taxonomy suffixes, never discarded.
_CODE = re.compile(
    r"(?:(e|ins)\s*)?(\d{3,4}[a-z]?(?:\s*\(\s*[ivx]+\s*\))?)", re.IGNORECASE
)


@dataclass(frozen=True)
class MatchIdentity:
    state: Literal["matched", "ambiguous", "unresolved"]
    canonical_id: str | None
    candidate_ids: tuple[str, ...]


def match_ingredient(
    text: str,
    aliases: dict[str, tuple[str, ...]],
    *,
    additive_context: bool = False,
) -> MatchIdentity:
    """Resolve exact aliases. A bare numeric code needs explicit additive context.

    E/INS prefixes establish code context. Normalising their spelling changes
    only the lookup key; the returned identity comes from the source index.
    A general code never expands to one of its more specific suffix entries.
    """
    key = " ".join(text.casefold().split())
    code = _CODE.fullmatch(key)
    if code:
        if code[1] is None and not additive_context:
            return MatchIdentity("unresolved", None, ())
        key = "e" + re.sub(r"\s+", "", code[2])
    candidates = aliases.get(key, ())
    if len(candidates) == 1:
        return MatchIdentity("matched", candidates[0], candidates)
    if candidates:
        return MatchIdentity("ambiguous", None, candidates)
    return MatchIdentity("unresolved", None, ())
