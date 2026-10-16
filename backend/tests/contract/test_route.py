"""POST /v1/analyses against the real route."""

import json
import logging
import socket
import sqlite3
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_settings import SettingsConfigDict
from tests.contract.support import (
    NEGATIVES_PATH,
    VECTORS_PATH,
    analysis_body,
    invoke_asgi,
    load_json,
    openapi,
    operation_example,
    request_example,
    schema_validator,
)

from app.contract.digest import input_digest
from app.contract.limits import (
    MAX_REQUEST_BYTES,
    PER_CLIENT_BURST,
    AnalysisRateLimiter,
    RateDecision,
)
from app.contract.models import ProductAnalysisInput
from app.contract.parsing import parse_json_body
from app.contract.services import NamedGapAnalysisService, NullLearningSink
from app.main import create_app
from app.settings import Settings


class IsolatedSettings(Settings):
    """Settings that ignore a developer .env file."""

    model_config = SettingsConfigDict(
        env_prefix="INGRADIENT_",
        env_file=None,
        extra="ignore",
    )


def _post(
    client: TestClient,
    payload: Any,
    *,
    forwarded: str | None = None,
    content: bytes | None = None,
    content_type: str | None = "application/json",
) -> Any:
    headers: dict[str, str] = {}
    if content_type is not None:
        headers["content-type"] = content_type
    if forwarded is not None:
        headers["x-forwarded-for"] = forwarded
    body = (
        content
        if content is not None
        else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    )
    return client.post("/v1/analyses", content=body, headers=headers)


def _watch_parser(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    calls = {"count": 0}
    original = parse_json_body

    def wrapped(raw: bytes) -> object:
        calls["count"] += 1
        return original(raw)

    monkeypatch.setattr("app.api.analyses.parse_json_body", wrapped)
    return calls


def _frozen_app(**kwargs: Any) -> FastAPI:
    now = kwargs.pop("now", {"t": 0.0})
    limiter = kwargs.pop("rate_limiter", None)
    if limiter is None:
        limiter = AnalysisRateLimiter(clock=lambda: now["t"])
    return create_app(
        IsolatedSettings(log_level="INFO", env="test"),
        rate_limiter=limiter,
        **kwargs,
    )


def test_openapi_example_returns_a_named_gap(client: TestClient) -> None:
    spec = openapi()
    example = request_example(spec)
    response = _post(client, example)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    schema_validator(spec, "AnalyzeResponse").validate(body)
    parsed = json.loads(json.dumps(example))
    assert body["inputDigest"] == input_digest(parsed["product"])
    assert body["scientific"]["state"] == "method_unavailable"
    assert "grade" not in body["scientific"]
    assert body["scientific"]["issues"][0]["code"] == "candidate_method_not_released"
    assert body["issues"][0]["code"] == "candidate_method_not_released"
    assert body["product"]["id"] == body["scientific"]["inputSnapshotId"]
    assert body["product"]["id"].startswith("gap-")
    assert body["product"]["ingredients"] == []
    assert body["product"]["category"] == "unknown"
    assert body["citations"] == []
    assert body["contractVersion"] == "0.2.0-draft"


def test_product_digest_vectors_round_trip_on_the_route(client: TestClient) -> None:
    spec = openapi()
    validator = schema_validator(spec, "AnalyzeResponse")
    cases = [
        case for case in load_json(VECTORS_PATH)["cases"] if case["kind"] == "product"
    ]
    assert len(cases) >= 4
    digests: dict[str, str] = {}
    for index, case in enumerate(cases):
        response = _post(
            client,
            analysis_body(case["value"]),
            forwarded=f"198.51.100.{index}",
        )
        assert response.status_code == 200, case["name"]
        body = response.json()
        validator.validate(body)
        assert body["inputDigest"] == case["sha256"]
        digests[case["name"]] = body["inputDigest"]
        filled = ProductAnalysisInput.model_validate(case["value"]).model_dump(
            mode="json"
        )
        if input_digest(filled) != case["sha256"]:
            assert body["inputDigest"] != input_digest(filled)
        for observation in body["product"]["observations"]:
            assert "derivation" not in observation
        assert "grade" not in body["scientific"]

    assert digests["optional name absent"] != digests["optional name present as null"]
    assert "name" not in next(
        case["value"] for case in cases if case["name"] == "optional name absent"
    )


def test_request_negatives_are_400_on_the_route(client: TestClient) -> None:
    spec = openapi()
    expected = operation_example(spec, "400")
    posted = 0
    for index, case in enumerate(load_json(NEGATIVES_PATH)):
        if case["schema"] != "AnalyzeRequest":
            continue
        response = _post(
            client,
            case["value"],
            forwarded=f"203.0.113.{index}",
        )
        assert response.status_code == 400, case["name"]
        assert response.json() == expected
        posted += 1
    assert posted >= 8


def test_duplicate_source_ids_are_400_and_reuse_is_allowed(client: TestClient) -> None:
    spec = openapi()
    base = request_example(spec)
    shared = {
        "field": "sugars",
        "kind": "read",
        "value": 1,
        "unit": "g",
        "basis": "per_100_g",
        "sourceIds": ["src-0"],
        "issues": [],
    }
    base["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Nutrition panel"}
    ]
    base["product"]["observations"] = [shared, dict(shared)]
    assert _post(client, base, forwarded="198.51.100.21").status_code == 200

    duplicated_ref = request_example(spec)
    duplicated_ref["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Nutrition panel"},
        {"id": "src-0", "kind": "label", "title": "Ingredient panel"},
    ]
    assert _post(client, duplicated_ref, forwarded="198.51.100.22").status_code == 400

    duplicated_list = request_example(spec)
    duplicated_list["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Nutrition panel"}
    ]
    duplicated_list["product"]["observations"] = [
        {**shared, "sourceIds": ["src-0", "src-0"]}
    ]
    assert _post(client, duplicated_list, forwarded="198.51.100.23").status_code == 400

    unknown = request_example(spec)
    unknown["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Nutrition panel"}
    ]
    unknown["product"]["observations"] = [{**shared, "sourceIds": ["src-1"]}]
    assert _post(client, unknown, forwarded="198.51.100.24").status_code == 400


def test_text_and_list_limits_follow_the_schema(client: TestClient) -> None:
    spec = openapi()
    properties = spec["components"]["schemas"]["ProductAnalysisInput"]["properties"]
    text_max = properties["ingredientsText"]["maxLength"]
    list_max = properties["observations"]["maxItems"]
    assert text_max == 20000
    assert properties["sourceRefs"]["maxItems"] == list_max == 100
    assert properties["issues"]["maxItems"] == list_max

    source = {"id": "src-0", "kind": "label", "title": "Nutrition panel"}
    observation = {
        "field": "sugars",
        "kind": "read",
        "value": 1,
        "unit": "g",
        "basis": "per_100_g",
        "sourceIds": ["src-0"],
        "issues": [],
    }
    issue = {
        "code": "missing_fibre",
        "stage": "completeness",
        "message": "Fibre is not on the label.",
        "action": "none",
    }

    def payload(**product_updates: Any) -> dict[str, Any]:
        body = request_example(spec)
        body["product"]["sourceRefs"] = [source]
        body["product"].update(product_updates)
        return body

    accepted = payload(
        ingredientsStatus="complete",
        ingredientsText="a" * text_max,
        observations=[observation] * list_max,
        issues=[issue] * list_max,
    )
    assert _post(client, accepted, forwarded="198.51.100.30").status_code == 200

    too_long = payload(
        ingredientsStatus="complete", ingredientsText="a" * (text_max + 1)
    )
    assert _post(client, too_long, forwarded="198.51.100.31").status_code == 400

    too_many = payload(observations=[observation] * (list_max + 1))
    assert _post(client, too_many, forwarded="198.51.100.32").status_code == 400

    refs = payload(
        sourceRefs=[
            {"id": f"src-{index}", "kind": "label", "title": "Nutrition panel"}
            for index in range(list_max + 1)
        ],
        observations=[],
    )
    assert _post(client, refs, forwarded="198.51.100.33").status_code == 400

    empty_complete = payload(ingredientsStatus="complete", ingredientsText="")
    assert _post(client, empty_complete, forwarded="198.51.100.34").status_code == 400


def test_byte_cap_is_enforced_before_parsing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _watch_parser(monkeypatch)
    raw = json.dumps(request_example(openapi()), separators=(",", ":")).encode()
    assert len(raw) < MAX_REQUEST_BYTES
    exact = raw + b" " * (MAX_REQUEST_BYTES - len(raw))
    assert len(exact) == MAX_REQUEST_BYTES
    assert _post(
        client, None, content=exact, forwarded="198.51.100.41"
    ).status_code == (200)

    over = exact + b" "
    assert len(over) == MAX_REQUEST_BYTES + 1
    rejected = _post(client, None, content=over, forwarded="198.51.100.42")
    assert rejected.status_code == 413
    assert rejected.json() == operation_example(openapi(), "413")
    assert calls["count"] == 1


def test_declared_and_streamed_oversize_do_not_parse(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _watch_parser(monkeypatch)
    status, _headers, body = invoke_asgi(
        app,
        method="POST",
        path="/v1/analyses",
        headers=[
            (b"content-type", b"application/json"),
            (b"content-length", str(MAX_REQUEST_BYTES + 1).encode("ascii")),
            (b"x-forwarded-for", b"198.51.100.43"),
        ],
        chunks=[b"{}"],
    )
    assert status == 413
    assert json.loads(body)["code"] == "payload_too_large"
    assert calls["count"] == 0

    status, _headers, body = invoke_asgi(
        app,
        method="POST",
        path="/v1/analyses",
        headers=[
            (b"content-type", b"application/json"),
            (b"x-forwarded-for", b"198.51.100.44"),
        ],
        chunks=[b"{" * 200_000, b"x" * 70_000],
    )
    assert status == 413
    assert calls["count"] == 0

    streamed = json.dumps(request_example(openapi())).encode("utf-8")
    status, _headers, body = invoke_asgi(
        app,
        method="POST",
        path="/v1/analyses",
        headers=[
            (b"content-type", b"application/json"),
            (b"x-forwarded-for", b"198.51.100.45"),
        ],
        chunks=[streamed[:20], streamed[20:]],
    )
    assert status == 200
    assert calls["count"] == 1


def test_duplicate_keys_non_finite_and_unsafe_integers_are_400(
    client: TestClient,
) -> None:
    spec = openapi()
    example = json.dumps(request_example(spec), separators=(",", ":")).encode()
    duplicate = example.replace(
        b'"contractVersion":"0.2.0-draft"',
        b'"contractVersion":"0.2.0-draft","contractVersion":"0.2.0-draft"',
        1,
    )
    assert _post(
        client, None, content=duplicate, forwarded="198.51.100.50"
    ).status_code == (400)

    nan = example.replace(b'"barcode":null', b'"barcode":NaN', 1)
    assert (
        _post(client, None, content=nan, forwarded="198.51.100.51").status_code == 400
    )

    unsafe = request_example(spec)
    unsafe["product"]["sourceRefs"] = [
        {"id": "src-0", "kind": "label", "title": "Nutrition panel"}
    ]
    unsafe["product"]["observations"] = [
        {
            "field": "energy",
            "kind": "read",
            "value": 2**53,
            "unit": "kJ",
            "basis": "per_100_g",
            "sourceIds": ["src-0"],
            "issues": [],
        }
    ]
    rejected = _post(client, unsafe, forwarded="198.51.100.52")
    assert rejected.status_code == 400
    assert "9007199254740992" not in rejected.text


def test_media_type_must_be_json(client: TestClient) -> None:
    example = request_example(openapi())
    assert (
        _post(
            client,
            example,
            content_type="text/plain",
            forwarded="198.51.100.60",
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            example,
            content_type="application/json; charset=utf-8",
            forwarded="198.51.100.61",
        ).status_code
        == 200
    )


def test_post_only_token_bucket_leaves_health_open() -> None:
    now = {"t": 0.0}
    app = _frozen_app(now=now)
    example = request_example(openapi())
    with TestClient(app, client=("192.0.2.15", 4000)) as client:
        for _ in range(30):
            assert client.get("/health").status_code == 200
        assert client.get("/v1/analyses").status_code == 405
        for _ in range(PER_CLIENT_BURST):
            assert _post(client, example).status_code == 200
        blocked = _post(client, example)
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"] == "1"
        assert blocked.json()["code"] == "rate_limited"
        assert (
            blocked.json()["message"] == operation_example(openapi(), "429")["message"]
        )
        assert blocked.json()["retryAfterSeconds"] == 1
        assert client.get("/health").status_code == 200

        spoof = _post(client, example, forwarded="1.2.3.4, 192.0.2.15")
        assert spoof.status_code == 429
        fresh = _post(client, example, forwarded="192.0.2.15, 203.0.113.70")
        assert fresh.status_code == 200

        # The peer bucket is empty. Rate limiting runs before the size check.
        huge = _post(
            client,
            None,
            content=b"x" * (MAX_REQUEST_BYTES + 1),
        )
        assert huge.status_code == 429


def test_global_bucket_is_wired_and_health_stays_open() -> None:
    app = _frozen_app(
        rate_limiter=AnalysisRateLimiter(clock=lambda: 0.0, global_per_hour=1)
    )
    example = request_example(openapi())
    with TestClient(app) as client:
        assert _post(client, example, forwarded="198.51.100.80").status_code == 200
        blocked = _post(client, example, forwarded="198.51.100.81")
        assert blocked.status_code == 429
        assert int(blocked.headers["retry-after"]) >= 1
        assert client.get("/health").status_code == 200


def test_only_analysis_posts_spend_a_token() -> None:
    class Counter:
        def __init__(self) -> None:
            self.calls = 0

        def allow(self, key: str) -> RateDecision:
            self.calls += 1
            return RateDecision(allowed=True, retry_after_seconds=0)

    counter = Counter()
    app = create_app(
        IsolatedSettings(log_level="INFO", env="test"), rate_limiter=counter
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/health", content=b"{}").status_code == 405
        assert client.get("/v1/analyses").status_code == 405
        assert _post(client, request_example(openapi())).status_code == 200
    assert counter.calls == 1


def test_injected_service_and_sink_are_used() -> None:
    class Marked:
        def assess(self, request: Any, *, input_digest: str) -> Any:
            self.seen = input_digest
            response = NamedGapAnalysisService().assess(
                request,
                input_digest="0" * 64,
            )
            response.issues[0].code = "fixture_marker"
            response.scientific.issues[0].code = "fixture_marker"
            return response

    class Memory:
        def __init__(self) -> None:
            self.rows: list[tuple[Any, Any]] = []

        def record(self, request: Any, response: Any) -> None:
            self.rows.append((request, response))

    service = Marked()
    sink = Memory()
    app = create_app(
        IsolatedSettings(log_level="INFO", env="test"),
        analysis_service=service,
        learning_sink=sink,
    )
    with TestClient(app) as client:
        response = _post(client, request_example(openapi()))
    body = response.json()
    assert response.status_code == 200
    assert body["issues"][0]["code"] == "fixture_marker"
    assert body["inputDigest"] == service.seen
    assert body["inputDigest"] != "0" * 64
    assert len(sink.rows) == 1
    assert sink.rows[0][1].inputDigest == body["inputDigest"]


def test_invalid_analyzer_output_is_503_without_the_bad_body() -> None:
    class BadScore:
        def assess(self, request: Any, *, input_digest: str) -> Any:
            good = NamedGapAnalysisService().assess(request, input_digest=input_digest)
            payload = good.model_dump(mode="json")
            payload["scientific"]["score"] = -19
            payload["scientific"]["state"] = "graded"
            payload["marker"] = "bad-score-sentinel"

            class Payload:
                def model_dump(self, **_kwargs: Any) -> dict[str, Any]:
                    return payload

            return Payload()

    app = create_app(
        IsolatedSettings(log_level="INFO", env="test"),
        analysis_service=BadScore(),
    )
    with TestClient(app) as client:
        response = _post(client, request_example(openapi()))
    assert response.status_code == 503
    assert response.json() == operation_example(openapi(), "503")
    assert "bad-score-sentinel" not in response.text
    assert "-19" not in response.text


def test_analyzer_and_sink_failures_are_not_logged() -> None:
    marker = "private-failure-marker-77c1"

    class Boom:
        def assess(self, request: Any, *, input_digest: str) -> Any:
            raise RuntimeError(marker)

    class BoomSink:
        def record(self, request: Any, response: Any) -> None:
            raise RuntimeError(marker)

    captured: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = Capture()
    loggers = [logging.getLogger(name) for name in ("", "ingradient", "fastapi")]
    for logger in loggers:
        logger.addHandler(handler)
    try:
        failed = create_app(
            IsolatedSettings(log_level="INFO", env="test"),
            analysis_service=Boom(),
        )
        stored = create_app(
            IsolatedSettings(log_level="INFO", env="test"),
            learning_sink=BoomSink(),
        )
        with TestClient(failed) as client:
            error = _post(client, request_example(openapi()))
        with TestClient(stored) as client:
            saved = _post(client, request_example(openapi()))
    finally:
        for logger in loggers:
            logger.removeHandler(handler)

    assert error.status_code == 503
    assert saved.status_code == 200
    rendered = "\n".join(record.getMessage() for record in captured)
    assert marker not in rendered
    assert marker not in error.text
    assert marker not in saved.text


def test_bodies_and_addresses_stay_out_of_logs(app: FastAPI) -> None:
    body_marker = "request-body-marker-b11"
    address = "198.51.100.77"
    captured: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = Capture()
    loggers = [
        logging.getLogger(name)
        for name in ("", "ingradient", "uvicorn", "uvicorn.access", "fastapi")
    ]
    for logger in loggers:
        logger.addHandler(handler)
    try:
        with TestClient(app) as client:
            example = request_example(openapi())
            example["product"]["name"] = body_marker
            example["product"]["ingredientsStatus"] = "complete"
            example["product"]["ingredientsText"] = body_marker
            accepted = _post(client, example, forwarded=address)
            rejected = _post(
                client,
                {**example, "profile": body_marker},
                forwarded=address,
            )
    finally:
        for logger in loggers:
            logger.removeHandler(handler)

    assert accepted.status_code == 200
    assert body_marker in accepted.text
    assert rejected.status_code == 400
    rendered: list[str] = []
    for record in captured:
        rendered.append(record.getMessage())
        if record.args:
            rendered.append(repr(record.args))
    combined = "\n".join(rendered)
    assert body_marker not in combined
    assert address not in combined
    assert accepted.text not in combined
    assert any(
        "path=/v1/analyses" in line and "status=200" in line for line in rendered
    )


def test_analysis_does_not_touch_a_database(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_sqlite(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("POST /v1/analyses opened sqlite")

    def fail_connection(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("POST /v1/analyses opened a socket")

    reads: list[Path] = []
    original = Path.read_text

    def spy_read_text(
        self: Path,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> str:
        reads.append(self)
        return original(self, encoding=encoding, errors=errors, newline=newline)

    for driver in ("psycopg", "psycopg2", "asyncpg", "sqlalchemy", "databases"):
        assert driver not in sys.modules

    with TestClient(app) as client:
        monkeypatch.setattr(sqlite3, "connect", fail_sqlite)
        monkeypatch.setattr(socket, "create_connection", fail_connection)
        monkeypatch.setattr(Path, "read_text", spy_read_text)
        response = _post(client, request_example(openapi()))

    assert response.status_code == 200
    assert all(path.name != "MANIFEST.json" for path in reads)
    assert isinstance(app.state.learning_sink, NullLearningSink)
