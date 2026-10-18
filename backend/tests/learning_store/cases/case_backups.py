from datetime import datetime, timedelta
from typing import Any

import pytest

from app.learning_store.backups import BackupEvidence, BackupMaintenance, BackupPlan
from app.learning_store.models import StorageError
from app.learning_store.store import ConnectionFactory, LearningStore

from .conftest import required_row


def test_dump_reservation_requires_runner_and_deadline(
    store: LearningStore, database: ConnectionFactory, clock: list[datetime]
) -> None:
    plan = BackupPlan(
        backup_kind="manual_dump",
        provider_reference="synthetic_object",
        covers_from=clock[0],
        covers_through=clock[0],
        earliest_original_expiry=clock[0] + timedelta(days=90),
        delete_by=clock[0] + timedelta(days=90),
    )
    with pytest.raises(StorageError, match="storage_backup_ineligible"):
        BackupMaintenance(store).reserve(plan)
    bad: dict[str, Any] = plan.model_dump()
    bad["delete_by"] += timedelta(microseconds=1)
    with pytest.raises(ValueError):
        BackupPlan.model_validate(bad)
    with database() as conn:
        assert (
            required_row(
                conn.execute("SELECT count(*) AS n FROM learning.backup_inventory")
            )["n"]
            == 0
        )
    admin = BackupMaintenance(store, independent_runner_ready=lambda: True)
    backup_id, job_id = admin.reserve(plan)
    with database() as conn:
        row = required_row(conn.execute("SELECT * FROM learning.deletion_job"))
        assert row["deletion_id"] == job_id and row["backup_id"] == backup_id
    # The administrative path continues even though normal runtime collection is off.
    off = LearningStore(database, clock=lambda: clock[0])
    runner = BackupMaintenance(off, independent_runner_ready=lambda: True)
    assert (
        runner.destroy_due(
            destroy_and_verify=lambda _id, _reference: pytest.fail("not due")
        )
        == 0
    )
    clock[0] += timedelta(days=90)
    assert runner.destroy_due(destroy_and_verify=lambda _id, _reference: None) == 0
    with database() as conn:
        row = required_row(conn.execute("SELECT * FROM learning.deletion_job"))
        assert (
            row["state"] == "blocked" and row["last_error_code"] == "backup_window_open"
        )
    assert (
        runner.destroy_due(
            destroy_and_verify=lambda _id, _reference: BackupEvidence(
                checkpoint_sha256="a" * 64
            )
        )
        == 1
    )
    assert (
        runner.destroy_due(
            destroy_and_verify=lambda _id, _reference: pytest.fail("already deleted")
        )
        == 0
    )
    with database() as conn:
        row = required_row(conn.execute("SELECT * FROM learning.backup_inventory"))
        assert (
            row["state"] == "verified_unrecoverable"
            and row["unrecoverable_verified_at"] == clock[0]
        )
