"""Adversarial boundary cases found during the BE-11 review."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.contract.support import invoke_asgi


@pytest.mark.parametrize(
    "raw",
    [
        b"[" * 1100 + b"0" + b"]" * 1100,
        b'{"product":' + b"[" * 950 + b"0" + b"]" * 950 + b"}",
    ],
)
def test_excessive_json_nesting_is_a_problem(raw: bytes, app: FastAPI) -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyses", content=raw, headers={"content-type": "application/json"}
        )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"


def test_content_length_requires_ascii_digits(app: FastAPI) -> None:
    status, _, _ = invoke_asgi(
        app,
        method="POST",
        path="/v1/analyses",
        headers=[(b"content-type", b"application/json"), (b"content-length", b"\xb2")],
        chunks=[b"{}"],
    )
    assert status == 400
