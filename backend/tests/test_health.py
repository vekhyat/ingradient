"""Acceptance checks for GET /health and for what the process is allowed to log."""

import json
import logging
import socket
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from app.health import read_contract_version

_REPO_ROOT = Path(__file__).resolve().parents[2]
_OPENAPI_PATH = _REPO_ROOT / "contracts" / "openapi-hybrid.yaml"


def _health_schema() -> dict[str, Any]:
    loaded: object = yaml.safe_load(_OPENAPI_PATH.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise AssertionError("OpenAPI document must be a mapping")
    components = loaded.get("components")
    if not isinstance(components, dict):
        raise AssertionError("OpenAPI document has no components mapping")
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        raise AssertionError("OpenAPI document has no schemas mapping")
    schema = schemas.get("Health")
    if not isinstance(schema, dict):
        raise AssertionError("OpenAPI document has no Health schema")
    return schema


def test_health_matches_manifest_and_schema(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")

    body = response.json()
    version = read_contract_version()
    assert body == {"status": "ok", "contractVersion": version}

    schema = _health_schema()
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(body)


def test_health_schema_rejects_an_extra_field() -> None:
    schema = _health_schema()
    properties = schema.get("properties")
    assert isinstance(properties, dict)
    version_schema = properties.get("contractVersion")
    assert isinstance(version_schema, dict)
    version = version_schema.get("const")
    assert isinstance(version, str) and version != ""

    with pytest.raises(ValidationError):
        Draft202012Validator(schema).validate(
            {"status": "ok", "contractVersion": version, "detail": "extra"}
        )


def test_health_request_does_not_touch_a_database(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_sqlite(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("GET /health opened sqlite")

    def fail_create_connection(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("GET /health called socket.create_connection")

    reads: list[Path] = []
    original_read_text = Path.read_text

    def spy_read_text(
        self: Path,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> str:
        reads.append(self)
        return original_read_text(
            self, encoding=encoding, errors=errors, newline=newline
        )

    for driver in ("psycopg", "psycopg2", "asyncpg", "sqlalchemy", "databases"):
        assert driver not in sys.modules

    with TestClient(app) as client:
        monkeypatch.setattr(sqlite3, "connect", fail_sqlite)
        monkeypatch.setattr(socket, "create_connection", fail_create_connection)
        monkeypatch.setattr(Path, "read_text", spy_read_text)
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert all(path.name != "MANIFEST.json" for path in reads)
    assert all(path.suffix not in {".db", ".sqlite", ".sqlite3"} for path in reads)


def test_request_body_and_client_address_never_appear_in_logs(app: FastAPI) -> None:
    body_marker = f"request-body-marker-{uuid4().hex}"
    query_marker = f"query-marker-{uuid4().hex}"
    client_host = "198.51.100.23"
    captured: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = Capture()
    handler.setLevel(logging.DEBUG)
    loggers = (
        logging.getLogger(),
        logging.getLogger("ingradient"),
        logging.getLogger("uvicorn"),
        logging.getLogger("uvicorn.access"),
        logging.getLogger("uvicorn.error"),
        logging.getLogger("fastapi"),
    )
    for logger in loggers:
        logger.addHandler(handler)

    try:
        with TestClient(app, client=(client_host, 50000)) as client:
            posted = client.post(
                "/health",
                content=body_marker.encode("utf-8"),
                headers={"content-type": "text/plain"},
            )
            fetched = client.get("/health", params={"q": query_marker})
    finally:
        for logger in loggers:
            logger.removeHandler(handler)

    assert posted.status_code == 405
    assert fetched.status_code == 200

    rendered: list[str] = []
    for record in captured:
        rendered.append(record.getMessage())
        if record.args:
            rendered.append(repr(record.args))
    combined = "\n".join(rendered)

    assert body_marker not in combined
    assert query_marker not in combined
    assert client_host not in combined
    assert fetched.text not in combined
    assert any(
        "request completed" in line and "path=/health" in line and "status=200" in line
        for line in rendered
    )


def test_missing_manifest_is_an_error() -> None:
    with tempfile.TemporaryDirectory() as directory:
        with pytest.raises(RuntimeError, match="missing"):
            read_contract_version(Path(directory) / "MANIFEST.json")


def test_request_paths_do_not_leak_into_application_logs(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    """Unknown URLs and route parameters are untrusted request data too."""
    marker = "private-path-marker-9f3c"

    @app.get("/example/{value}")
    def example(value: str) -> dict[str, str]:
        return {"status": "ok"}

    logger = logging.getLogger("ingradient")
    logger.addHandler(caplog.handler)
    try:
        with TestClient(app) as client:
            assert client.get(f"/unknown/{marker}").status_code == 404
            assert client.get(f"/example/{marker}").status_code == 200
    finally:
        logger.removeHandler(caplog.handler)

    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert marker not in messages
    assert "path=<unmatched> status=404" in messages
    assert "path=/example/{value} status=200" in messages


def test_manifest_version_must_be_a_string() -> None:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "MANIFEST.json"
        path.write_text(json.dumps({"contractVersion": 1}), encoding="utf-8")

        with pytest.raises(RuntimeError, match="contractVersion"):
            read_contract_version(path)
