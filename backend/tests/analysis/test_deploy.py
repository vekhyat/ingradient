"""Development entrypoint keeps the approved analysis / no-collection boundary."""

import socket

import pytest
from fastapi.testclient import TestClient

from app.analysis import ReferenceAnalysisService
from app.contract.services import NullLearningSink


def test_deployment_health_never_needs_a_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deploy.app import app

    def refuse_connection(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("health opened a network connection")

    monkeypatch.setattr(socket, "create_connection", refuse_connection)
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert isinstance(app.state.learning_sink, NullLearningSink)
    assert isinstance(app.state.analysis_service, ReferenceAnalysisService)
    assert app.state.analysis_service.resources is not None
