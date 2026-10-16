"""Shared fixtures. Tests pass settings in and do not read a developer .env."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_settings import SettingsConfigDict

from app.main import create_app
from app.settings import Settings


class TestSettings(Settings):
    """Settings that ignore a developer .env file."""

    model_config = SettingsConfigDict(
        env_prefix="INGRADIENT_",
        env_file=None,
        extra="ignore",
    )


@pytest.fixture
def app() -> FastAPI:
    return create_app(TestSettings(log_level="INFO", env="test"))


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
