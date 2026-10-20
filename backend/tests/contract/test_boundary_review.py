"""Adversarial boundary cases found during the BE-11 review."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.contract.support import invoke_asgi

from app.contract.limits import MAX_REQUEST_BYTES


@pytest.mark.parametrize("depth", [200, 1000, 1100])
@pytest.mark.parametrize("product", [False, True])
def test_excessive_json_nesting_is_a_problem(
    depth: int, product: bool, app: FastAPI
) -> None:
    # Build the hostile bytes directly: json.dumps itself recurses on this input.
    raw = b'{"x":' * depth + b'"private-product-text"' + b"}" * depth
    if product:
        raw = b'{"product":' + raw + b"}"
    assert len(raw) < MAX_REQUEST_BYTES
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/analyses", content=raw, headers={"content-type": "application/json"}
        )
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "code": "invalid_request",
        "message": "Invalid product facts or undocumented field.",
    }
    assert "private-product-text" not in response.text


def test_content_length_requires_ascii_digits(app: FastAPI) -> None:
    status, _, _ = invoke_asgi(
        app,
        method="POST",
        path="/v1/analyses",
        headers=[(b"content-type", b"application/json"), (b"content-length", b"\xb2")],
        chunks=[b"{}"],
    )
    assert status == 400
