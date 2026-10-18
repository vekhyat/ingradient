"""Bounded ingredient structure with conservative exact English alias matching.

No ancestry, fuzzy identity or health inference. Ambiguous and malformed spans
remain unresolved. OFF licences and source pins are in resources/manifest.json.
"""

import re

from app.analysis.matching import match_ingredient
from app.analysis.resources import AnalysisResources
from app.contract.models import IngredientMention, Issue

# A lexical code atom may have a supported or unsupported bracket suffix.
# Keep that suffix attached; only the exact matcher may certify its identity.
_CODE_HEAD = re.compile(r"(?:(?:e|ins)\s*)?\d{3,4}[a-z]?(?=$|\s*[\[(])", re.IGNORECASE)


def parse_ingredients(
    text: str | None, status: str, source_ids: list[str], resources: AnalysisResources
) -> tuple[list[IngredientMention], list[Issue]]:
    text = re.sub(r"^\s*ingredients\s*:\s*", "", text or "", flags=re.IGNORECASE)
    # An advisory must start a top-level section or have an explicit colon.
    # A word inside an ingredient span or nested component is not a header.
    advisory_start: int | None = None
    depth = 0
    scanned = 0
    for match in re.finditer(
        r"\b(?:may[ \t]+contain|contains)\b[ \t]*:?[ \t]*",
        text,
        flags=re.IGNORECASE,
    ):
        for char in text[scanned : match.start()]:
            if char in "([":
                depth += 1
            elif char in ")]":
                depth -= 1
        scanned = match.start()
        prefix = text[: match.start()].rstrip(" \t")
        section_start = bool(prefix) and prefix[-1] in ".;\r\n"
        conditional_at_start = not prefix and match[0].casefold().startswith("may")
        if depth == 0 and (section_start or conditional_at_start or ":" in match[0]):
            advisory_start = match.start()
            break
    ingredient_text = text[:advisory_start].strip().rstrip(".;")
    issues: list[Issue] = []
    if advisory_start is not None:
        issues.append(
            Issue(
                code="allergen_statement_separate",
                stage="matching",
                message=(
                    "A Contains or May contain statement is preserved in "
                    "the submitted text and is not an ingredient identity."
                ),
                action="read_source",
            )
        )
    if not ingredient_text.strip(" \t\r\n,;.") or not source_ids:
        return [], [
            *issues,
            Issue(
                code="ingredients_unavailable",
                stage="matching",
                field="ingredientsText",
                message="Ingredient text with source evidence is unavailable.",
                action="add_field",
            ),
        ]
    mentions: list[IngredientMention] = []
    stack: list[tuple[str | None, str]] = []
    parent: str | None = None
    buffer = ""
    malformed = False

    def emit() -> str | None:
        nonlocal buffer
        value = buffer.strip().strip(".")
        buffer = ""
        if not value:
            return None
        if len(mentions) >= 300 or len(value) > 2000:
            raise ValueError("ingredient_limits")
        matched = match_ingredient(value, resources.ingredient_aliases)
        identity = "ingredient-" + str(len(mentions))
        mentions.append(
            IngredientMention(
                id=identity,
                text=value,
                parentId=parent,
                canonicalId=matched.canonical_id,
                state=matched.state,
                candidateIds=list(matched.candidate_ids[:20]),
                sourceIds=source_ids,
                taxonomyVersion=resources.taxonomy_version,
            )
        )
        return identity

    try:
        index = 0
        while index < len(ingredient_text):
            char = ingredient_text[index]
            if char in "([" and _CODE_HEAD.match(buffer.strip()):
                end = index
                brackets: list[str] = []
                while end < len(ingredient_text):
                    suffix_char = ingredient_text[end]
                    if suffix_char in "([":
                        if len(stack) + len(brackets) >= 12:
                            raise ValueError("ingredient_depth")
                        brackets.append(")" if suffix_char == "(" else "]")
                    elif suffix_char in ")]":
                        if not brackets or brackets.pop() != suffix_char:
                            raise ValueError("ingredient_structure")
                        if not brackets:
                            break
                    end += 1
                if brackets or end >= len(ingredient_text):
                    raise ValueError("ingredient_structure")
                buffer += ingredient_text[index : end + 1]
                index = end + 1
                continue
            if char in "([":
                if len(stack) >= 12:
                    raise ValueError("ingredient_depth")
                identity = emit()
                if identity is None:
                    malformed = True
                stack.append((parent, ")" if char == "(" else "]"))
                parent = identity
            elif char in ")]":
                emit()
                if not stack or stack[-1][1] != char:
                    malformed = True
                    break
                parent, _ = stack.pop()
            elif char in ",;":
                emit()
            else:
                buffer += char
            index += 1
        emit()
    except ValueError:
        malformed = True
    if stack or malformed:
        # Do not certify partially parsed identities when structure failed.
        return [], [
            *issues,
            Issue(
                code="ingredient_structure_unresolved",
                stage="matching",
                message=(
                    "Ingredient nesting or limits require correction; "
                    "original text is preserved."
                ),
                action="edit",
            ),
        ]
    if status != "complete":
        issues.append(
            Issue(
                code="ingredients_incomplete",
                stage="matching",
                message="Ingredient text is incomplete; missing text is unknown.",
                action="retake",
            )
        )
    if any(m.state != "matched" for m in mentions):
        issues.append(
            Issue(
                code="ingredient_identity_unresolved",
                stage="matching",
                message="Some ingredient identities require review.",
                action="choose_candidate",
            )
        )
    return mentions, issues
