"""Exact ingredient identities from the pinned taxonomy, without fuzzy inference."""

import re
from dataclasses import dataclass
from typing import Literal

# Match the TypeScript lower-case/whitespace key exactly. Python casefold() and
# str.split() would additionally conflate names such as ss/ß and C0 separators.
ECMASCRIPT_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005"
    "\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_WHITESPACE = re.compile("[" + ECMASCRIPT_WHITESPACE + "]+")
_CODE = re.compile(
    r"(?:(?:e|ins)\s*)?(\d{3,4})([a-f])?(?:\s*\(\s*([a-f]|[ivxlcdm]+)\s*\))?",
    re.ASCII,
)


def normalize_key(text: str) -> str:
    """Preserve punctuation and diacritics while normalizing case and whitespace."""

    return _WHITESPACE.sub(" ", text.lower()).strip(" ")


def normalize_additive_code(text: str) -> str | None:
    """Numeric lookup code without E; letter suffixes normalize, Roman ones stay."""

    code = _CODE.fullmatch(normalize_key(text))
    if code is None:
        return None
    number, letter, suffix = code.groups()
    letter = letter or ""
    if suffix is None:
        return number + letter
    if len(suffix) == 1 and suffix in "abcdef":
        return None if letter else number + suffix
    return f"{number}{letter}({suffix})"


def build_alias_lookup(
    ingredients: dict[str, tuple[str, ...]], additives: dict[str, tuple[str, ...]]
) -> dict[str, tuple[str, ...]]:
    """Compile exact lookup keys while retaining additive-only code context.

    A code can only be looked up in the additive scope on the phone. All other
    names use the union of both scopes, including legitimate exact conflicts.
    Precompiling that distinction keeps callers' dictionary interface intact.
    """

    aliases = {
        key: ids
        for key, ids in ingredients.items()
        if normalize_additive_code(key) is None
    }
    for key, ids in additives.items():
        aliases[key] = tuple(sorted(set(aliases.get(key, ())) | set(ids)))
    return aliases


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
    key = normalize_key(text)
    code = normalize_additive_code(key)
    if code is not None:
        if not key.startswith(("e", "ins")) and not additive_context:
            return MatchIdentity("unresolved", None, ())
        key = "e" + code
    candidates = aliases.get(key, ())
    if len(candidates) == 1:
        return MatchIdentity("matched", candidates[0], candidates)
    if candidates:
        return MatchIdentity("ambiguous", None, candidates)
    return MatchIdentity("unresolved", None, ())
