# Resource integrity and generation

The phone and Python scientific implementations share the byte-pinned inputs in `resources/`. `resources/manifest.json` records bundle paths, sizes, SHA-256 digests, provenance and licensing. Wire and local contracts have their own manifest under `contracts/`.

Run from the repository root after installing the backend's locked development dependencies:

```powershell
backend/.venv/Scripts/python.exe tools/resources/verify_resources.py
backend/.venv/Scripts/python.exe tools/resources/build_match_vectors.py --check
```

On Unix, use `backend/.venv/bin/python`. The verifier checks bundle hashes and sizes, JSON syntax, scientific vectors against the local contract, and exact-match fixtures against the independent source-derived builder. If `~/.cache/ingradient-sources/` exists, it also checks available cached primary-source artifacts. Missing cached artifacts produce warnings; repository bundle failures fail verification.

## Generated consumers

- `node src/domain/contracts/codegen/generate.mjs` generates TypeScript types and validators from frozen contracts.
- `node src/domain/matching/codegen/build-index.mjs` builds the exact-match taxonomy index from pinned sources.
- `node tools/resources/build_additive_names.mjs` builds the additive-name lookup from the pinned additive taxonomy.
- `tools/resources/build_match_vectors.py --check` checks exact-match fixture drift without writing. Omitting `--check` rewrites that pinned fixture and is only appropriate for a reviewed resource update.

Generators emit LF. `.gitattributes` keeps generated source checkouts at LF while exempting `contracts/` and `resources/` from line-ending conversion. Prettier also ignores pinned inputs and the generated additive lookup. Do not format or normalize frozen input files to repair a source-formatting check.

## Exact-match fixtures and parity

`resources/vectors/match-vectors.json` contains project-authored regressions derived from pinned Open Food Facts English entries. Each expectation cites source lines; these are engineering fixtures rather than official OFF vectors or human research gold. Source attribution and ODbL/DbCL labels remain in the fixture and manifest; the project-authored scaffolding licence is pending team agreement.

The builder derives expectations without running either application matcher. Both runtimes compare state, canonical identity and sorted candidate identities for the same edition. Keep these checks separate from nutrition calculation vectors and complete scientific-assessment parity in `tools/parity/` and `.github/workflows/backend.yml`. Fuzzy candidates and wrapper/advisory prose require their own integration coverage.

## Updating pinned inputs

Resource changes need a reviewed scientific or upstream-source reason. Acquire the official source into the external cache and record its exact URL, retrieval date, byte size and SHA-256. Record unavailable sources plainly; never invent their hashes.

Pin taxonomies to an exact upstream revision and preserve licensing and attribution. For a method update, align thresholds and citation locators with official reports and workbooks. Regenerate affected vectors and consumers, update bundle hashes/sizes and embedded bundle references, then run integrity, generated-drift, expected-vector and cross-runtime parity checks. Follow the project's review process before accepting new pins. Ordinary implementation fixes should use synthetic test inputs when possible and leave scientific pins unchanged.
