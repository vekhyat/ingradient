from datetime import timedelta
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.types.json import Jsonb

from app.learning_store.store import JSON_COLUMNS, ConnectionFactory, LearningStore

from .conftest import required_row


def test_complete_ingredients_whitespace_matches_python(
    database: ConnectionFactory, payload: dict[str, Any]
) -> None:
    from app.learning_store.models import StorageError, validate_payload

    whitespace = [chr(n) for n in range(0x110000) if chr(n).isspace()]
    with database() as conn:
        for text in [*whitespace, "\t\n", "".join(whitespace)]:
            payload["ingredients_text"] = text
            with pytest.raises(StorageError):
                validate_payload(payload)
            result = required_row(
                conn.execute(
                    "SELECT learning.valid_product(%s) AS valid", (Jsonb(payload),)
                )
            )
            assert result["valid"] is False
        payload["ingredients_text"] = "\t synthetic product text \n"
        assert validate_payload(payload)
        result = required_row(
            conn.execute(
                "SELECT learning.valid_product(%s) AS valid", (Jsonb(payload),)
            )
        )
        assert result["valid"] is True


@pytest.mark.parametrize(
    "mutation",
    [
        "source_extra",
        "obs_extra",
        "fact_extra",
        "version_extra",
        "source_null",
        "obs_null",
        "category_null",
        "missing_key",
        "unsupported_field",
        "wrong_unit",
        "null_fact",
        "incomplete_facts",
        "dangling",
        "duplicate",
        "missing_has_value",
        "numeric_string",
        "bool_value",
        "negative",
        "contradiction",
        "unreviewed_off",
    ],
)
def test_db_validates_nested_shape(
    database: ConnectionFactory, payload: dict[str, Any], mutation: str
) -> None:
    source, obs, facts = (
        payload["source_refs"][0],
        payload["observations"][0],
        payload["scoring_facts"],
    )
    if mutation == "source_extra":
        source["account_id"] = "forbidden"
    elif mutation == "obs_extra":
        obs["profile"] = {}
    elif mutation == "fact_extra":
        facts["cheese"]["source_ids"] = obs["source_ids"]
    elif mutation == "version_extra":
        payload["versions"]["session_id"] = "forbidden"
    elif mutation == "source_null":
        source["kind"] = None
    elif mutation == "obs_null":
        obs["kind"] = None
    elif mutation == "category_null":
        payload["category"] = None
    elif mutation == "missing_key":
        del payload["versions"]["ingestion_policy_version"]
    elif mutation == "unsupported_field":
        obs["field"] = "made_up"
    elif mutation == "wrong_unit":
        obs["unit"] = "kJ"
    elif mutation == "null_fact":
        facts["cheese"] = None
    elif mutation == "incomplete_facts":
        del facts["cheese"]
    elif mutation == "dangling":
        obs["source_ids"] = [str(uuid4())]
    elif mutation == "duplicate":
        obs["source_ids"] *= 2
    elif mutation == "missing_has_value":
        obs.update(kind="missing", reason="not_declared")
    elif mutation == "numeric_string":
        obs["value"] = "1"
    elif mutation == "bool_value":
        obs["value"] = True
    elif mutation == "negative":
        obs["value"] = -1
    elif mutation == "contradiction":
        facts["plainWater"] = {"state": "present", "source_ids": obs["source_ids"]}
    elif mutation == "unreviewed_off":
        source["kind"] = "off"
    with database() as conn:
        assert (
            required_row(
                conn.execute(
                    "SELECT learning.valid_product(%s) AS valid", (Jsonb(payload),)
                )
            )["valid"]
            is False
        )


def test_direct_sql_cannot_bypass_storage_dto(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
) -> None:
    record_id = uuid4()
    payload["source_refs"][0]["device_id"] = "forbidden"
    with (
        pytest.raises(psycopg.errors.CheckViolation, match="storage_invalid"),
        database() as conn,
    ):
        now = store.now()
        conn.execute(
            "INSERT INTO learning.record_registry "
            "(record_id,record_kind,generation,created_at) VALUES (%s,'original',0,%s)",
            (record_id, now),
        )
        values = {
            k: Jsonb(v) if k in JSON_COLUMNS and v is not None else v
            for k, v in payload.items()
        }
        values.update(
            record_id=record_id,
            received_at=now,
            expires_at=now + timedelta(days=90),
            storage_schema_version=1,
        )
        conn.execute(
            sql.SQL("INSERT INTO learning.original_submission ({}) VALUES ({})").format(
                sql.SQL(",").join(map(sql.Identifier, values)),
                sql.SQL(",").join(sql.Placeholder() for _ in values),
            ),
            tuple(values.values()),
        )
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.record_registry")
            )["n"]
            == 0
        )
