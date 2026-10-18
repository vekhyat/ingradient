"""Opt-in disposable PostgreSQL only. No inherited DATABASE_URL or Neon access."""

# ruff: noqa: E402
# Skip this optional suite before importing the isolated store/driver. Deployment
# and base backend checks keep their existing dependency set and NullLearningSink.
import pytest

pytest.importorskip("psycopg", reason="Install app/learning_store/requirements.txt")

# pyright: reportPrivateUsage=false
# Transaction hooks intentionally exercise the exclusive writer internals.
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

from app.learning_store.store import ConnectionFactory, LearningStore

MIGRATIONS = Path(__file__).resolve().parents[3] / "migrations"


@pytest.fixture
def database():
    dsn = os.environ.get("BE13_TEST_DSN")
    if not dsn:
        pytest.skip("Set BE13_TEST_DSN to an explicitly disposable local PostgreSQL 18")
    info = conninfo_to_dict(dsn)
    if info.get("host") not in {"127.0.0.1", "localhost"}:
        pytest.fail("BE13 tests refuse non-loopback PostgreSQL")
    if info.get("dbname") != "learning_test":
        pytest.fail("BE13 tests require disposable database learning_test")

    def connect():
        return psycopg.Connection[dict[str, Any]].connect(
            dsn, row_factory=dict_row, connect_timeout=5, hostaddr="127.0.0.1"
        )

    with connect() as conn:
        assert int(conn.info.server_version) // 10000 == 18
        conn.execute("DROP SCHEMA IF EXISTS learning CASCADE")
        for path in sorted(MIGRATIONS.glob("*.up.sql")):
            conn.execute(path.read_bytes())
    yield connect
    with connect() as conn:
        for path in sorted(MIGRATIONS.glob("*.down.sql"), reverse=True):
            conn.execute(path.read_bytes())


@pytest.fixture
def clock():
    return [datetime(2024, 2, 29, 12, 30, tzinfo=UTC)]


@pytest.fixture
def store(database: ConnectionFactory, clock: list[datetime]):
    return LearningStore(
        database, clock=lambda: clock[0], collection_enabled=lambda: True
    )


@pytest.fixture
def payload():
    from uuid import uuid4

    source = str(uuid4())
    return {
        "barcode": "12345678",
        "product_name": "Synthetic test product",
        "market": "IN",
        "ingredients_text": "synthetic ingredient",
        "ingredients_status": "complete",
        "declared_category": "general",
        "category": "general",
        "source_refs": [
            {
                "source_id": source,
                "kind": "label",
                "title": "Nutrition panel",
                "rights_state": "eligible",
            }
        ],
        "observations": [
            {
                "observation_id": str(uuid4()),
                "field": "sugars",
                "kind": "read",
                "value": 0,
                "unit": "g",
                "basis": "per_100_g",
                "source_ids": [source],
                "issue_codes": [],
                "derivation_codes": [],
            }
        ],
        "scoring_facts": {
            "category_source_ids": [source],
            "cheese": {"state": "unknown"},
            "redMeat": {"state": "unknown"},
            "plainWater": {"state": "unknown"},
            "nonNutritiveSweetener": {"state": "unknown"},
        },
        "issue_codes": [],
        "versions": {
            "ingestion_policy_version": "synthetic-1",
            "contract_version": "0.3.0-draft",
            "server_resource_state": "unavailable",
            "client_resource_status": "unavailable",
        },
    }


def required_row(cursor: psycopg.Cursor[dict[str, Any]]) -> dict[str, Any]:
    row = cursor.fetchone()
    assert row is not None
    return row
