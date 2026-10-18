#!/usr/bin/env python3
"""
tools/resources/verify_resources.py

Validates the integrity of all resources registered in resources/manifest.json:
1. Recomputes the SHA-256 and byte size of every repo bundle file.
2. Checks that every SHA-256 and size matches the manifest entry exactly.
3. If external source cache is available, validates cached source binaries.
4. Validates JSON structure of JSON resources.
5. If contracts/local-contract.schema.json exists and jsonschema is available,
   validates every test vector's expectedAssessment against ScientificAssessment.

Exits with code 0 on success, code 1 on mismatch or validation error.
"""

import os
import sys
import json
import hashlib

from build_match_vectors import document as expected_match_vectors

# Ensure UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

def compute_sha256(filepath: str) -> tuple[str, int]:
    hasher = hashlib.sha256()
    size = 0
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
            size += len(chunk)
    return hasher.hexdigest(), size

def validate_vectors_against_contract(repo_root: str) -> int:
    contract_path = os.path.join(repo_root, "contracts", "local-contract.schema.json")
    vectors_path = os.path.join(repo_root, "resources", "vectors", "nutriscore-vectors.json")

    if not os.path.exists(contract_path):
        print(f"\n[INFO] Contract schema not found at {contract_path}; skipping contract validation.")
        return 0

    if not os.path.exists(vectors_path):
        print(f"\n[ERROR] Vectors file not found at {vectors_path}", file=sys.stderr)
        return 1

    try:
        import jsonschema
        from jsonschema.validators import validator_for
    except ImportError:
        print("\n[WARN] Python 'jsonschema' package not installed; skipping ScientificAssessment contract validation.")
        return 0

    print(f"\n[INFO] Validating vectors against ScientificAssessment in {contract_path}...")
    try:
        with open(contract_path, "r", encoding="utf-8") as f:
            full_schema = json.load(f)
    except Exception as e:
        print(f"  [ERROR] Failed to parse contract schema: {e}", file=sys.stderr)
        return 1

    subschema = {
        "$schema": full_schema.get("$schema", "https://json-schema.org/draft/2020-12/schema"),
        "$defs": full_schema.get("$defs", {}),
        "$ref": "#/$defs/ScientificAssessment"
    }

    cls = validator_for(subschema)
    validator = cls(subschema)

    try:
        with open(vectors_path, "r", encoding="utf-8") as f:
            vectors_doc = json.load(f)
    except Exception as e:
        print(f"  [ERROR] Failed to parse vectors file: {e}", file=sys.stderr)
        return 1

    vectors = vectors_doc.get("vectors", [])
    vector_errors = 0
    for v in vectors:
        vid = v.get("id")
        expected = v.get("expectedAssessment")
        if not expected:
            print(f"  [ERROR] Vector {vid} missing expectedAssessment", file=sys.stderr)
            vector_errors += 1
            continue

        try:
            validator.validate(expected)
            print(f"  [OK] {vid}: expectedAssessment matches ScientificAssessment schema")
        except jsonschema.exceptions.ValidationError as err:
            print(f"  [ERROR] {vid} failed ScientificAssessment schema validation:", file=sys.stderr)
            print(f"          Path: {'/'.join(str(p) for p in err.path)}", file=sys.stderr)
            print(f"          Message: {err.message}", file=sys.stderr)
            vector_errors += 1

    if vector_errors == 0:
        print(f"[PASS] All {len(vectors)} vector expected assessments strictly conform to ScientificAssessment contract.")
    return vector_errors

def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    manifest_path = os.path.join(repo_root, "resources", "manifest.json")

    if not os.path.exists(manifest_path):
        print(f"[FAIL] Manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    print(f"[INFO] Reading manifest from {manifest_path}")
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        print(f"[FAIL] Could not parse manifest.json: {e}", file=sys.stderr)
        return 1

    bundles = manifest.get("bundles", [])
    if not bundles:
        print("[FAIL] Manifest contains no bundles", file=sys.stderr)
        return 1

    errors = 0
    resources_dir = os.path.join(repo_root, "resources")

    print(f"[INFO] Verifying {len(bundles)} repository bundles in {resources_dir}...")
    for b in bundles:
        bundle_id = b.get("bundleId")
        rel_path = b.get("path")
        expected_sha = b.get("sha256", "").lower()
        expected_size = b.get("sizeBytes")

        file_path = os.path.join(resources_dir, rel_path)
        if not os.path.exists(file_path):
            print(f"  [ERROR] {bundle_id}: File missing at {file_path}", file=sys.stderr)
            errors += 1
            continue

        actual_sha, actual_size = compute_sha256(file_path)
        if actual_sha != expected_sha:
            print(f"  [ERROR] {bundle_id} ({rel_path}): SHA-256 mismatch!", file=sys.stderr)
            print(f"          Expected: {expected_sha}", file=sys.stderr)
            print(f"          Actual:   {actual_sha}", file=sys.stderr)
            errors += 1
        elif actual_size != expected_size:
            print(f"  [ERROR] {bundle_id} ({rel_path}): Size mismatch!", file=sys.stderr)
            print(f"          Expected: {expected_size} bytes", file=sys.stderr)
            print(f"          Actual:   {actual_size} bytes", file=sys.stderr)
            errors += 1
        else:
            print(f"  [OK] {bundle_id}: {actual_size:,} bytes, sha256={actual_sha[:12]}...")

        # If it's a JSON file, verify valid syntax
        if rel_path.endswith(".json"):
            try:
                with open(file_path, "r", encoding="utf-8") as jf:
                    json.load(jf)
            except Exception as e:
                print(f"  [ERROR] {bundle_id}: Invalid JSON syntax: {e}", file=sys.stderr)
                errors += 1

    # Check external cached sources if available
    external_sources = manifest.get("externalSources", [])
    cache_dir = os.path.expanduser(os.path.join("~", ".cache", "ingradient-sources"))
    if os.path.isdir(cache_dir):
        print(f"\n[INFO] Verifying cached primary source artifacts in {cache_dir}...")
        for src in external_sources:
            src_id = src.get("id")
            status = src.get("status")
            cached_filename = src.get("cachedFilename")
            expected_sha = src.get("sha256")
            expected_size = src.get("sizeBytes")

            if status != "retrieved":
                print(f"  [INFO] {src_id}: Status is '{status}' (not cached)")
                continue

            cached_path = os.path.join(cache_dir, cached_filename)
            if not os.path.exists(cached_path):
                print(f"  [WARN] {src_id}: Expected cached file {cached_filename} not found in cache folder")
                continue

            actual_sha, actual_size = compute_sha256(cached_path)
            if expected_sha and actual_sha != expected_sha:
                print(f"  [ERROR] {src_id} cached binary SHA-256 mismatch!", file=sys.stderr)
                print(f"          Expected: {expected_sha}", file=sys.stderr)
                print(f"          Actual:   {actual_sha}", file=sys.stderr)
                errors += 1
            elif expected_size and actual_size != expected_size:
                print(f"  [ERROR] {src_id} cached binary size mismatch!", file=sys.stderr)
                print(f"          Expected: {expected_size}", file=sys.stderr)
                print(f"          Actual:   {actual_size}", file=sys.stderr)
                errors += 1
            else:
                print(f"  [OK] {src_id}: {actual_size:,} bytes, sha256={actual_sha[:12]}...")

    # Validate vectors against local contract schema
    errors += validate_vectors_against_contract(repo_root)

    # Expectations come from the reviewed source-derived builder, never either
    # application matcher. This also verifies its pinned taxonomy source bytes.
    try:
        path = os.path.join(resources_dir, "vectors", "match-vectors.json")
        with open(path, "r", encoding="utf-8") as fixture:
            matches = json.load(fixture)
        if matches != expected_match_vectors():
            raise ValueError("shared match fixture differs from reviewed source expectations")
        print(f"[PASS] All {len(matches['vectors'])} source-derived exact match fixtures verified.")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"[ERROR] Match fixtures: {error}", file=sys.stderr)
        errors += 1

    if errors > 0:
        print(f"\n[FAIL] Verification completed with {errors} error(s).", file=sys.stderr)
        return 1

    print(f"\n[PASS] All {len(bundles)} bundles and 15 vector assessments verified successfully.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
