# Contracts

The frozen interface between the phone app and the backend. Both sides build and test against these files.

| File | What it is |
|---|---|
| `openapi-hybrid.yaml` | The backend API (OpenAPI 3.1). `POST /v1/analyses` takes product text and nutrition only; no photos, profile or identifiers |
| `local-contract.schema.json` | The phone's local result types (JSON Schema 2020-12). Seven scientific types are identical to the API's |
| `negative/wire.json` | Requests and responses the API must reject, one rule broken per case |
| `negative/local.json` | Local result states the phone must reject, such as a personal letter next to a hard allergy conflict |
| `vectors/input-digest.json` | Cases for `inputDigest`: SHA-256 of the RFC 8785 canonical JSON of the request `product` |
| `MANIFEST.json` | Contract version and the SHA-256 of every file above |

## Rules

- Do not edit these files by hand. A change goes through a recorded decision, then a new freeze, which rewrites the files and the manifest together. A test fails if a file no longer matches its pinned hash.
- `inputDigest` is computed over the `product` value exactly as decoded by a JSON parser, before any model defaults, so a missing field and a `null` field hash differently. The phone hashes the `product` of `JSON.parse` of the exact body it sent.
- Prettier does not reformat this folder, because reformatting would change the pinned bytes.

## Why a digest

The phone shows its own result after 2 seconds if the backend is slow. When a late backend result arrives, the phone checks that the backend graded exactly the facts it sent: it compares the returned `inputDigest` with its own. If they differ, the result is not offered.

References: [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785), [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0), [JSON Schema 2020-12](https://json-schema.org/draft/2020-12).
