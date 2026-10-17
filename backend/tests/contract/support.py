"""Loaders for the frozen contract. Tests are the only caller."""

import asyncio
import copy
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

REPO_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_PATH = REPO_ROOT / "contracts" / "openapi-hybrid.yaml"
VECTORS_PATH = REPO_ROOT / "contracts" / "vectors" / "input-digest.json"
NEGATIVES_PATH = REPO_ROOT / "contracts" / "negative" / "wire.json"

COMPATIBILITY: dict[str, str] = {
    "taxonomyVersion": "fictional-taxonomy",
    "evidenceVersion": "fictional-evidence",
    "methodEdition": "fictional-method",
    "methodBundleSha256": "0" * 64,
}


def load_yaml(path: Path) -> dict[str, Any]:
    loaded: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise AssertionError(f"{path} must be a mapping")
    return loaded


def load_json(path: Path) -> Any:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def openapi() -> dict[str, Any]:
    return load_yaml(OPENAPI_PATH)


def request_example(spec: Mapping[str, Any]) -> dict[str, Any]:
    example = copy.deepcopy(
        spec["paths"]["/v1/analyses"]["post"]["requestBody"]["content"][
            "application/json"
        ]["example"]
    )
    if not isinstance(example, dict):
        raise AssertionError("request example must be an object")
    return example


def operation_example(spec: Mapping[str, Any], status: str) -> dict[str, Any]:
    example = spec["paths"]["/v1/analyses"]["post"]["responses"][status]["content"][
        "application/json"
    ]["example"]
    if not isinstance(example, dict):
        raise AssertionError(f"{status} example must be an object")
    return example


def schema_validator(spec: Mapping[str, Any], name: str) -> Draft202012Validator:
    """Validate one component schema, resolving its ``$ref`` siblings."""

    schemas = spec["components"]["schemas"]
    if not isinstance(schemas, dict):
        raise AssertionError("components.schemas must be a mapping")
    rewritten = {
        key: _rewrite_refs(copy.deepcopy(value)) for key, value in schemas.items()
    }
    schema = rewritten[name]
    if not isinstance(schema, dict):
        raise AssertionError(name)
    schema = copy.deepcopy(schema)
    schema["$defs"] = rewritten
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError:
        # OpenAPI annotations such as discriminator are not JSON Schema keywords.
        # Instance validation still applies the constraints that are keywords.
        pass
    return Draft202012Validator(schema)


def _rewrite_refs(node: Any) -> Any:
    if isinstance(node, dict):
        rewritten: dict[str, Any] = {}
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                prefix = "#/components/schemas/"
                if value.startswith(prefix):
                    rewritten[key] = "#/$defs/" + value.removeprefix(prefix)
                    continue
            rewritten[key] = _rewrite_refs(value)
        return rewritten
    if isinstance(node, list):
        return [_rewrite_refs(item) for item in node]
    return node


def analysis_body(product: Any) -> dict[str, Any]:
    return {
        "contractVersion": "0.3.0-draft",
        "product": product,
        "resourceCompatibility": dict(COMPATIBILITY),
    }


def invoke_asgi(
    app: Any,
    *,
    method: str,
    path: str,
    headers: list[tuple[bytes, bytes]],
    chunks: list[bytes],
    peer: tuple[str, int] = ("192.0.2.20", 4000),
) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    """One HTTP request against the ASGI app, including a chunked body."""

    messages = [
        {
            "type": "http.request",
            "body": chunk,
            "more_body": index < len(chunks) - 1,
        }
        for index, chunk in enumerate(chunks)
    ]
    cursor = {"index": 0}
    sent: dict[str, Any] = {"status": 0, "headers": [], "body": bytearray()}

    async def receive() -> dict[str, Any]:
        index = cursor["index"]
        cursor["index"] = index + 1
        if index < len(messages):
            return messages[index]
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            sent["status"] = message["status"]
            sent["headers"] = message.get("headers", [])
        elif message["type"] == "http.response.body":
            sent["body"].extend(message.get("body", b""))

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers,
        "client": peer,
        "server": ("testserver", 80),
        "root_path": "",
    }
    asyncio.run(app(scope, receive, send))
    status = sent["status"]
    response_headers = sent["headers"]
    body = bytes(sent["body"])
    if not isinstance(status, int) or not isinstance(response_headers, list):
        raise AssertionError("ASGI response was incomplete")
    return status, response_headers, body
