"""Load and integrity-check the same frozen resources used by the phone.

Loading is explicit startup work. Calculation and request handling do no I/O.
The local manifest is a pin, not a cryptographic release signature.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.contract.models import Citation, MethodRef

RESOURCE_ROOT = Path(__file__).resolve().parents[3] / "resources"


class ResourceUnavailable(ValueError):
    """A pinned resource is absent, changed, or unsupported."""


@dataclass(frozen=True)
class AnalysisResources:
    method: dict[str, Any]
    templates: dict[str, dict[str, Any]]
    method_ref: MethodRef
    citations: tuple[Citation, ...]
    taxonomy_version: str
    evidence_version: str
    ingredient_aliases: dict[str, tuple[str, ...]]

    @property
    def compatibility(self) -> dict[str, str]:
        return {
            "methodEdition": self.method_ref.edition,
            "methodBundleSha256": self.method_ref.bundleSha256,
            "taxonomyVersion": self.taxonomy_version,
            "evidenceVersion": self.evidence_version,
        }


def _aliases(text: str) -> dict[str, tuple[str, ...]]:
    aliases: dict[str, set[str]] = {}
    for block in text.split("\n\n"):
        names: list[str] = []
        for line in block.splitlines():
            if line.startswith("en:"):
                names.extend(
                    name.strip() for name in line[3:].split(",") if name.strip()
                )
        if not names:
            continue
        # OFF's first English entry is the English canonical name. Properties,
        # parent relations and synonym directives are deliberately not aliases.
        canonical = "en:" + names[0].lower().replace(" ", "-")
        for name in names:
            aliases.setdefault(" ".join(name.casefold().split()), set()).add(canonical)
    return {name: tuple(sorted(ids)) for name, ids in aliases.items()}


def load_resources(root: Path = RESOURCE_ROOT) -> AnalysisResources:
    try:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        loaded: dict[str, Any] = {}
        for bundle in manifest["bundles"]:
            path = (root / bundle["path"]).resolve()
            if not path.is_relative_to(root.resolve()):
                raise ResourceUnavailable("resource_path")
            raw = path.read_bytes()
            if (
                len(raw) != bundle["sizeBytes"]
                or hashlib.sha256(raw).hexdigest() != bundle["sha256"]
            ):
                raise ResourceUnavailable("resource_integrity")
            loaded[bundle["bundleId"]] = (bundle, raw)
        pin, raw = loaded["nutriscore-updated-2023"]
        method = json.loads(raw)
        _, raw_templates = loaded["nutriscore-reason-templates"]
        evidence = json.loads(raw_templates)
        if (
            method["schemaVersion"] != 1
            or evidence["schemaVersion"] != 1
            or method["edition"] != "sc-2022-2023-updated"
        ):
            raise ResourceUnavailable("resource_edition")
        if set(method["routes"]) != {"general", "fats_nuts_seeds", "beverage"}:
            raise ResourceUnavailable("resource_routes")
        templates = {t["templateId"]: t for t in evidence["templates"]}
        for route in method["routes"].values():
            for group in ("adverseComponents", "favourableComponents"):
                for component in route[group].values():
                    if "thresholds" in component and component["operator"] not in (
                        ">",
                        ">=",
                        "<=",
                    ):
                        raise ResourceUnavailable("resource_operator")
        ingredient_pin, ingredients = loaded["off-taxonomy-ingredients"]
        _, additives = loaded["off-taxonomy-additives"]
        aliases = _aliases(ingredients.decode("utf-8").replace("\r\n", "\n"))
        for name, ids in _aliases(
            additives.decode("utf-8").replace("\r\n", "\n")
        ).items():
            aliases[name] = tuple(sorted(set(aliases.get(name, ())) | set(ids)))
        return AnalysisResources(
            method=method,
            templates=templates,
            method_ref=MethodRef(
                id=method["id"],
                edition=method["edition"],
                bundleId=pin["bundleId"],
                bundleSha256=pin["sha256"],
                label=method["label"],
            ),
            citations=tuple(Citation.model_validate(c) for c in method["citations"]),
            taxonomy_version=ingredient_pin["bundleId"] + "@" + manifest["revision"],
            evidence_version=evidence["evidenceEdition"],
            ingredient_aliases=aliases,
        )
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ResourceUnavailable("pinned_resources_unavailable") from error
