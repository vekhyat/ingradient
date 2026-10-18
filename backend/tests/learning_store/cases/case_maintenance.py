# pyright: reportPrivateUsage=false
# Transaction hooks intentionally exercise the exclusive writer internals.
import os
import subprocess
from typing import Any

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

from app.learning_store.maintenance import Maintenance
from app.learning_store.models import StorageError
from app.learning_store.store import ConnectionFactory, LearningStore

from .case_store import ingest
from .conftest import required_row


def test_artifacts_require_curated_members_and_rights_deletion_blocks_model(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
):
    admin = Maintenance(store)
    original = ingest(store, payload)
    with pytest.raises(StorageError):
        admin.admit_artifact(
            kind="dataset",
            version="synthetic",
            sha256="a" * 64,
            members=[original],
            reviewed=True,
        )
    child = store.curate(
        [original], payload, protocol="synthetic", scope="product_facts"
    )
    dataset = admin.admit_artifact(
        kind="dataset",
        version="synthetic",
        sha256="a" * 64,
        members=[child],
        reviewed=True,
    )
    model = admin.admit_artifact(
        kind="model",
        version="synthetic",
        sha256="b" * 64,
        members=[],
        dependencies=[dataset],
        reviewed=True,
    )
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.artifact_member")
            )["n"]
            == 1
        )
        # Generation witnesses prevent cycles, independently of the Python API.
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute(
                "INSERT INTO learning.artifact_dependency "
                "(artifact_id,child_generation,input_artifact_id,input_generation) "
                "VALUES (%s,0,%s,1)",
                (dataset, model),
            )
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute(
                "INSERT INTO learning.curation_link "
                "(curated_id,child_generation,source_record_id,source_generation,"
                "derivation_kind,created_at) VALUES (%s,1,%s,1,'revision',%s)",
                (child, child, store.now()),
            )
    job = store.enqueue_record(original, "rights_withdrawal")
    store.process_deletion(job)
    with database() as conn:
        states = conn.execute(
            "SELECT state FROM learning.artifact ORDER BY artifact_id"
        ).fetchall()
        assert [r["state"] for r in states] == ["blocked", "blocked"]
    with pytest.raises(StorageError):
        admin.admit_artifact(
            kind="model",
            version="synthetic2",
            sha256="c" * 64,
            members=[],
            dependencies=[dataset],
            reviewed=True,
        )


def test_artifact_target_commits_barrier_before_sweep(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
) -> None:
    admin = Maintenance(store)
    original = ingest(store, payload)
    child = store.curate(
        [original], payload, protocol="synthetic", scope="product_facts"
    )
    dataset = admin.admit_artifact(
        kind="dataset",
        version="synthetic",
        sha256="a" * 64,
        members=[child],
        reviewed=True,
    )
    model = admin.admit_artifact(
        kind="model",
        version="synthetic",
        sha256="b" * 64,
        members=[],
        dependencies=[dataset],
        reviewed=True,
    )
    job = admin.enqueue_artifact(dataset, "explicit_request")
    with pytest.raises(StorageError):
        admin.admit_artifact(
            kind="model",
            version="synthetic2",
            sha256="c" * 64,
            members=[],
            dependencies=[dataset],
            reviewed=True,
        )
    store.process_deletion(job)
    with database() as conn:
        row = required_row(
            conn.execute(
                "SELECT state FROM learning.artifact WHERE artifact_id=%s", (model,)
            )
        )
        assert row["state"] == "blocked"
        row = required_row(
            conn.execute("SELECT state,last_error_code FROM learning.deletion_job")
        )
        assert row == {"state": "blocked", "last_error_code": "artifact_unavailable"}


def test_stale_local_pg_dump_restore_replays_newer_independent_tombstone(
    store: LearningStore, database: ConnectionFactory, payload: dict[str, Any]
):
    """Dump bytes are synthetic; manifest is held separately from the stale dump."""
    container = os.environ.get("BE13_TEST_CONTAINER")
    if container != "ingradient-be13-pg18-test":
        pytest.skip(
            "Set BE13_TEST_CONTAINER to the dedicated synthetic Docker container"
        )
    info = conninfo_to_dict(os.environ["BE13_TEST_DSN"])
    assert info["host"] == "127.0.0.1" and info["dbname"] == "learning_test"
    admin = Maintenance(store)
    original = ingest(store, payload)
    child = store.curate(
        [original],
        payload,
        protocol="synthetic",
        scope="correction_pair",
        before=payload,
    )
    dump = subprocess.run(
        [
            "docker",
            "exec",
            container,
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "learning_test",
            "--schema=learning",
            "--format=custom",
        ],
        check=True,
        capture_output=True,
    ).stdout
    job = store.enqueue_record(original, "explicit_request")
    store.process_deletion(job)
    manifest = admin.export_deletions()  # newer than the dump, outside restored DB
    assert (
        str(child) not in manifest.model_dump_json()
    )  # no copied payload or derived text
    # Quarantine: only this test can access the local store during restore/replay.
    with database() as conn:
        conn.execute("DROP SCHEMA learning CASCADE")
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            container,
            "pg_restore",
            "-U",
            "postgres",
            "-d",
            "learning_test",
            "--exit-on-error",
        ],
        input=dump,
        check=True,
        capture_output=True,
    )
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.original_submission")
            )["n"]
            == 1
        )
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.deletion_job")
            )["n"]
            == 0
        )
    admin.replay_deletions(manifest)
    admin.replay_deletions(manifest)
    for record in [original, child]:
        with pytest.raises(StorageError):
            store.read(record)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.original_submission")
            )["n"]
            == 0
        )
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.curated_example")
            )["n"]
            == 0
        )
    broken = manifest.model_dump(mode="json")
    broken["checkpoint_sha256"] = "0" * 64
    with pytest.raises(ValueError):
        type(manifest).model_validate(broken)
