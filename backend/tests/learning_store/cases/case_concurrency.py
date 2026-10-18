# pyright: reportPrivateUsage=false
# Transaction hooks intentionally exercise the exclusive writer internals.
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event
from typing import Any
from uuid import UUID, uuid4

import pytest
from psycopg.types.json import Jsonb

from app.learning_store.models import (
    Source,
    SourceSelector,
    StorageError,
)
from app.learning_store.store import DB, ConnectionFactory, LearningStore, source_key

from .case_store import ingest
from .conftest import required_row


def test_curation_waits_then_refuses_committed_deletion(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
):
    original = ingest(store, payload)
    waiting = Event()
    real_lock = store._lock_records

    def lock(conn: DB, ids: Sequence[UUID]):
        waiting.set()
        real_lock(conn, ids)

    monkeypatch.setattr(store, "_lock_records", lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with store.transaction() as barrier:
            real_lock(barrier, [original])
            future = pool.submit(
                store.curate,
                [original],
                payload,
                protocol="synthetic",
                scope="product_facts",
            )
            assert waiting.wait(5)
            store._enqueue_record(barrier, original, "explicit_request", store.now())
        with pytest.raises(StorageError):
            future.result(timeout=5)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.curated_example")
            )["n"]
            == 0
        )


def test_curation_first_is_in_deletion_descendants(
    store: LearningStore,
    database: ConnectionFactory,
    payload: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
):
    original = ingest(store, payload)
    ready, release = Event(), Event()
    real_eligible = store._eligible

    def eligible(conn: DB, record_id: UUID, now: datetime):
        result = real_eligible(conn, record_id, now)
        ready.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(store, "_eligible", eligible)
    with ThreadPoolExecutor(max_workers=2) as pool:
        curation = pool.submit(
            store.curate,
            [original],
            payload,
            protocol="synthetic",
            scope="product_facts",
        )
        assert ready.wait(5)
        deletion = pool.submit(store.enqueue_record, original, "explicit_request")
        release.set()
        child = curation.result(timeout=5)
        job = deletion.result(timeout=5)
    store.process_deletion(job)
    with database() as conn:
        assert required_row(
            conn.execute(
                "SELECT tombstoned_at FROM learning.record_registry WHERE record_id=%s",
                (child,),
            )
        )["tombstoned_at"]


def test_curation_waits_across_expiry_and_refuses(
    store: LearningStore,
    payload: dict[str, Any],
    clock: list[datetime],
    monkeypatch: pytest.MonkeyPatch,
):
    original = ingest(store, payload)
    clock[0] += timedelta(days=90, microseconds=-1)
    waiting = Event()
    real_lock = store._lock_records

    def lock(conn: DB, ids: Sequence[UUID]):
        waiting.set()
        real_lock(conn, ids)

    monkeypatch.setattr(store, "_lock_records", lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with store.transaction() as barrier:
            real_lock(barrier, [original])
            future = pool.submit(
                store.curate,
                [original],
                payload,
                protocol="synthetic",
                scope="product_facts",
            )
            assert waiting.wait(5)
            clock[0] += timedelta(microseconds=1)
            # Another expiry session skips the row locked by curation/barrier.
            assert store.expire() == 0
        with pytest.raises(StorageError, match="storage_record_unavailable"):
            future.result(timeout=5)
    assert store.expire() == 1


def test_shared_scope_lock_serialises_unknown_edition_ingest_and_revocation(
    store: LearningStore, payload: dict[str, Any], monkeypatch: pytest.MonkeyPatch
):
    rights = uuid4()
    payload["source_refs"][0].update(
        kind="off", title="Open Food Facts product", rights_reference=str(rights)
    )
    selector = SourceSelector(kind="off", rights_reference=rights, edition="rev-123")
    waiting = Event()
    real_lock = store._source_locks

    def lock(conn: DB, sources: Sequence[Source]):
        waiting.set()
        real_lock(conn, sources)

    monkeypatch.setattr(store, "_source_locks", lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with store.transaction() as barrier:
            barrier.execute(
                "SELECT pg_advisory_xact_lock(%s)", (source_key("off", rights),)
            )
            future = pool.submit(ingest, store, payload)
            assert waiting.wait(5)
            barrier.execute(
                "INSERT INTO learning.deletion_job "
                "(deletion_id,source_selector,propagate,reason,state,requested_at) "
                "VALUES (%s,%s,true,'rights_withdrawal','queued',%s)",
                (
                    uuid4(),
                    Jsonb(selector.model_dump(mode="json", exclude_none=True)),
                    store.now(),
                ),
            )
        with pytest.raises(StorageError, match="storage_source_revoked"):
            future.result(timeout=5)
