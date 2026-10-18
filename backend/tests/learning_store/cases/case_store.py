# pyright: reportPrivateUsage=false
# Transaction hooks intentionally exercise the exclusive writer internals.
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
import pytest

from app.learning_store.models import (
    PresentObservation,
    SourceSelector,
    StorageError,
    validate_payload,
)
from app.learning_store.store import ConnectionFactory, LearningStore

from .conftest import required_row


def ingest(store: LearningStore, payload: dict[str, Any]):
    record_id = uuid4()
    assert (
        store.ingest(payload, record_id=record_id, sent_and_connected=lambda: True)
        == record_id
    )
    return record_id


def test_nine_tables_and_up_down(database: ConnectionFactory):
    from .conftest import MIGRATIONS

    with database() as conn:
        assert (
            required_row(
                conn.execute(
                    "SELECT count(*) AS n FROM information_schema.tables "
                    "WHERE table_schema='learning'"
                )
            )["n"]
            == 9
        )
        for path in sorted(MIGRATIONS.glob("*.down.sql"), reverse=True):
            conn.execute(path.read_bytes())
        assert (
            required_row(conn.execute("SELECT to_regnamespace('learning') AS ns"))["ns"]
            is None
        )
        for path in sorted(MIGRATIONS.glob("*.up.sql")):
            conn.execute(path.read_bytes())


def test_off_and_pre_send_are_zero_connection_calls(payload: dict[str, Any]):
    calls = []

    def connect():
        calls.append(True)
        pytest.fail("off/pre-send path touched DB")

    off = LearningStore(connect)
    assert (
        off.ingest(object(), record_id=uuid4(), sent_and_connected=lambda: True) is None
    )
    assert off.expire() == 0
    on = LearningStore(connect, collection_enabled=lambda: True)
    assert on.ingest(payload, record_id=uuid4()) is None
    # Includes full-send-but-disconnected, partial-send and failed-send guards.
    for full, connected, success in [
        (True, False, True),
        (False, True, True),
        (True, True, False),
    ]:
        assert (
            on.ingest(
                payload,
                record_id=uuid4(),
                sent_and_connected=lambda flags=(full, connected, success): all(flags),
            )
            is None
        )
    assert calls == []


def test_immutable_receipt_and_idempotent_retry(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    clock: list[datetime],
):
    record_id = ingest(store, payload)
    clock[0] += timedelta(hours=1)
    assert (
        store.ingest(payload, record_id=record_id, sent_and_connected=lambda: True)
        == record_id
    )
    with database() as conn:
        row = required_row(
            conn.execute(
                "SELECT o.*,r.created_at FROM learning.original_submission o "
                "JOIN learning.record_registry r USING(record_id)"
            )
        )
        assert row["received_at"] == row["created_at"]
        assert row["expires_at"] - row["received_at"] == timedelta(days=90)
    with pytest.raises(psycopg.errors.CheckViolation), database() as conn:
        conn.execute("UPDATE learning.original_submission SET product_name='changed'")
    with pytest.raises(psycopg.errors.CheckViolation), database() as conn:
        conn.execute("UPDATE learning.record_registry SET generation=1")
    payload["product_name"] = "Different"
    with pytest.raises(StorageError, match="storage_retry_conflict"):
        store.ingest(payload, record_id=record_id, sent_and_connected=lambda: True)


def test_exact_expiry_preserves_reviewed_correction(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    clock: list[datetime],
):
    original = ingest(store, payload)
    curated = store.curate(
        [original],
        payload,
        protocol="synthetic-review-1",
        scope="correction_pair",
        before=payload,
    )
    start = clock[0]
    clock[0] = start + timedelta(days=90, microseconds=-1)
    assert store.read(original)
    assert store.expire() == 0
    clock[0] += timedelta(microseconds=1)
    with pytest.raises(StorageError):
        store.read(original)
    assert store.expire() == 1
    assert store.expire() == 0
    assert store.read(curated)
    with database() as conn:
        row = required_row(
            conn.execute("SELECT correction_before FROM learning.curated_example")
        )
        assert row["correction_before"]["observations"][0]["value"] == 0
        before_id = row["correction_before"]["source_refs"][0]["source_id"]
        assert before_id != payload["source_refs"][0]["source_id"]
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.original_submission")
            )["n"]
            == 0
        )
        assert required_row(
            conn.execute(
                "SELECT tombstoned_at FROM learning.record_registry WHERE record_id=%s",
                (original,),
            )
        )["tombstoned_at"]
    assert store.due_reviews() == []
    clock[0] = start.replace(year=2025, month=2, day=28) - timedelta(microseconds=1)
    assert store.read(curated)
    clock[0] += timedelta(microseconds=1)
    assert store.due_reviews() == [curated]
    with pytest.raises(StorageError, match="storage_review_due"):
        store.read(curated)
    with pytest.raises(StorageError, match="storage_review_required"):
        store.renew_review(curated)
    store.renew_review(curated, actual_review=True)
    assert store.read(curated)
    assert store.due_reviews() == []


def test_off_leaves_idle_expired_payload_but_excludes_reads(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    clock: list[datetime],
):
    original = ingest(store, payload)
    clock[0] += timedelta(days=90)
    off = LearningStore(database, clock=lambda: clock[0])
    assert off.expire() == 0
    with pytest.raises(StorageError):
        off.read(original)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.original_submission")
            )["n"]
            == 1
        )


def test_enqueue_barrier_descendants_and_retry(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
):
    original = ingest(store, payload)
    child = store.curate(
        [original], payload, protocol="synthetic", scope="product_facts"
    )
    grandchild = store.curate(
        [child], payload, protocol="synthetic", scope="product_facts"
    )
    job = store.enqueue_record(original, "explicit_request")
    for record_id in [original, child, grandchild]:
        with pytest.raises(StorageError):
            store.read(record_id)
    with pytest.raises(StorageError):
        store.curate([child], payload, protocol="synthetic", scope="product_facts")
    store.process_deletion(job)
    store.process_deletion(job)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.curated_example")
            )["n"]
            == 0
        )
        row = required_row(
            conn.execute(
                "SELECT state,last_error_code FROM learning.deletion_job "
                "WHERE deletion_id=%s",
                (job,),
            )
        )
        assert row == {"state": "blocked", "last_error_code": "ledger_unavailable"}


def test_source_revocation_survives_completed_marker_and_unknown_editions(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
):
    rights = uuid4()
    payload["source_refs"][0].update(
        kind="off", title="Open Food Facts product", rights_reference=str(rights)
    )
    original = ingest(store, payload)
    curated = store.curate(
        [original],
        payload,
        protocol="synthetic",
        scope="correction_pair",
        before=payload,
    )
    selector = SourceSelector(kind="off", rights_reference=rights, edition="rev-123")
    job = store.revoke_source(selector)
    with pytest.raises(StorageError, match="storage_source_revoked"):
        ingest(store, payload)
    with pytest.raises(StorageError):
        store.read(curated)
    store.process_deletion(job)
    store.process_deletion(job)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.curated_example")
            )["n"]
            == 0
        )
        # Administrative evidence does not rescind the denial marker.
        conn.execute(
            "UPDATE learning.deletion_job SET "
            "state='verified',completed_at=requested_at,"
            "ledger_checkpoint_sha256=%s WHERE deletion_id=%s",
            ("a" * 64, job),
        )
    with pytest.raises(StorageError, match="storage_source_revoked"):
        ingest(store, payload)


def test_mutated_model_revalidates_before_db(payload: dict[str, Any]):
    checked = validate_payload(payload)
    assert isinstance(checked.observations[0], PresentObservation)
    checked.observations[0].source_ids.append(uuid4())

    def no_connection():
        pytest.fail("mutation reached DB")

    with pytest.raises(StorageError):
        LearningStore(no_connection, collection_enabled=lambda: True).ingest(
            checked, record_id=uuid4(), sent_and_connected=lambda: True
        )


def test_failed_transaction_retries_same_reserved_id(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record_id = uuid4()
    real_insert = store._insert_payload

    def fail_insert(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("synthetic interrupted transaction")

    monkeypatch.setattr(store, "_insert_payload", fail_insert)
    with pytest.raises(RuntimeError):
        store.ingest(payload, record_id=record_id, sent_and_connected=lambda: True)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.record_registry")
            )["n"]
            == 0
        )
    monkeypatch.setattr(store, "_insert_payload", real_insert)
    assert (
        store.ingest(payload, record_id=record_id, sent_and_connected=lambda: True)
        == record_id
    )


def test_expiry_batch_cap(
    store: LearningStore, payload: dict[str, Any], clock: list[datetime]
) -> None:
    for _ in range(3):
        ingest(store, payload)
    clock[0] += timedelta(days=90)
    assert store.expire(batch_size=1) == 1
    assert store.expire(batch_size=2) == 2
    with pytest.raises(StorageError):
        store.expire(batch_size=101)


def test_shared_rights_scope_survives_original_expiry_and_manifest_replay(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    clock: list[datetime],
) -> None:
    from copy import deepcopy

    from app.learning_store.maintenance import Maintenance

    rights = uuid4()
    payload["source_refs"][0].update(
        kind="off", title="Open Food Facts product", rights_reference=str(rights)
    )
    original = ingest(store, payload)
    stripped = deepcopy(payload)
    stripped["source_refs"][0].pop("rights_reference")
    stripped["source_refs"][0].update(kind="label", title="Nutrition panel")
    with pytest.raises(StorageError, match="storage_rights_ineligible"):
        store.curate([original], stripped, protocol="synthetic", scope="product_facts")
    child = store.curate(
        [original], payload, protocol="synthetic", scope="product_facts"
    )
    clock[0] += timedelta(days=90)
    assert store.expire() == 1
    assert store.read(child)
    store.revoke_source(SourceSelector(kind="off", rights_reference=rights))
    admin = Maintenance(store)
    manifest = admin.export_deletions()
    admin.replay_deletions(manifest)
    with pytest.raises(StorageError):
        store.read(child)
