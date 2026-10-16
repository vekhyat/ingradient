# Resource Management and Integrity Tooling

This directory contains tooling for validating and managing frozen scientific and data resources under `resources/`.

## Integrity Verification

To verify that all resource files in `resources/` match the hashes and sizes pinned in `resources/manifest.json`, run:

```bash
python tools/resources/verify_resources.py
```

The script will:
1. Recompute SHA-256 and byte sizes of all bundles in `resources/`.
2. Verify matching checksums and sizes against `resources/manifest.json`.
3. Validate JSON syntax for all JSON resources.
4. If the external cache directory (`~/.cache/ingradient-sources/`) is present, check the cached primary source binaries.
5. Exit with code `0` on complete success, or code `1` if any file is missing, altered, corrupted, or has an invalid checksum.

## Freezing or Updating a Resource

In Ingradient, resource files are immutable pinned artifacts. Never edit resource files by hand without updating the manifest and running dual review.

When an official method update or upstream taxonomy refresh is approved:
1. **Acquire Primary Sources**: Download official artifacts into external cache (`~/.cache/ingradient-sources/`) and record the exact URL, retrieval date, size in bytes, and SHA-256 hash. If any source is blocked (e.g. HTTP 403), record that plainly without inventing hashes.
2. **Update Bundle Files**:
   - For taxonomies (`resources/taxonomy/`): Pin to an exact upstream git commit from `openfoodfacts-server` and verify license (ODbL 1.0 / DbCL 1.0).
   - For method rules (`resources/method/`): Update JSON thresholds and citation locators matching the official scientific reports and calculation workbooks.
   - For canonical vectors (`resources/vectors/`): Recompute and verify expected assessments against the updated method bundle.
3. **Regenerate / Update Manifest**:
   - Update `resources/manifest.json` with new SHA-256 digests and file sizes.
   - Update `bundleSha256` in any references (e.g. in `resources/vectors/nutriscore-vectors.json`).
4. **Validate**:
   - Run `python tools/resources/verify_resources.py` and ensure all checks PASS.
