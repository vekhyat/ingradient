"""Synthetic/admin backup inventory. No dump or cloud provider is invoked here."""

from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from .models import Hash, StorageError, StrictModel
from .store import LearningStore


class BackupPlan(StrictModel):
    backup_kind: Literal["neon_history", "manual_dump", "restore_branch"]
    provider_reference: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")]
    covers_from: datetime
    covers_through: datetime
    earliest_original_expiry: datetime | None
    delete_by: datetime | None

    @model_validator(mode="after")
    def deadlines(self) -> Self:
        dates = [
            self.covers_from,
            self.covers_through,
            self.earliest_original_expiry,
            self.delete_by,
        ]
        if any(d is not None and d.tzinfo is None for d in dates):
            raise ValueError("timezone required")
        if self.covers_from > self.covers_through:
            raise ValueError("invalid interval")
        if (
            self.backup_kind == "manual_dump"
            and self.earliest_original_expiry is not None
        ):
            if self.delete_by is None or self.delete_by > self.earliest_original_expiry:
                raise ValueError("manual dump outlives original")
        return self


class BackupEvidence(StrictModel):
    checkpoint_sha256: Hash


class BackupMaintenance:
    def __init__(
        self,
        store: LearningStore,
        *,
        independent_runner_ready: Callable[[], bool] = lambda: False,
    ) -> None:
        self.store = store
        self.independent_runner_ready = independent_runner_ready

    def reserve(self, plan: BackupPlan) -> tuple[UUID, UUID]:
        """Inventory and reserved destruction work commit before dump creation.

        Original manual dumps require an independently configured off-state
        runner. Merely reserving a row does not create a backup or prove erasure.
        """
        checked = BackupPlan.model_validate(plan.model_dump())
        now = self.store.now()
        if (
            checked.covers_through > now
            or checked.delete_by is not None
            and checked.delete_by <= now
            or checked.earliest_original_expiry is not None
            and checked.backup_kind == "manual_dump"
            and not self.independent_runner_ready()
        ):
            raise StorageError("storage_backup_ineligible")
        backup_id, job_id = uuid4(), uuid4()
        with self.store.transaction() as conn:
            conn.execute(
                "INSERT INTO learning.backup_inventory "
                "(backup_id,backup_kind,provider_reference,observed_at,covers_from,"
                "covers_through,originals_included,earliest_original_expiry,"
                "delete_by,state) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'present')",
                (
                    backup_id,
                    checked.backup_kind,
                    checked.provider_reference,
                    now,
                    checked.covers_from,
                    checked.covers_through,
                    checked.earliest_original_expiry is not None,
                    checked.earliest_original_expiry,
                    checked.delete_by,
                ),
            )
            conn.execute(
                "INSERT INTO learning.deletion_job "
                "(deletion_id,backup_id,propagate,reason,state,requested_at) "
                "VALUES (%s,%s,false,'no_longer_needed','queued',%s)",
                (job_id, backup_id, now),
            )
        return backup_id, job_id

    def destroy_due(
        self,
        *,
        destroy_and_verify: Callable[[UUID, str], BackupEvidence | None],
        batch_size: int = 100,
    ) -> int:
        """Off-independent runner callback; retries must be idempotent by backup ID."""
        if not self.independent_runner_ready() or not 1 <= batch_size <= 100:
            raise StorageError("storage_backup_runner_unavailable")
        count = 0
        with self.store.transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM learning.backup_inventory "
                "WHERE state<>'verified_unrecoverable' "
                "AND (delete_by<=%s OR state='deletion_pending') "
                "ORDER BY delete_by,backup_id LIMIT %s FOR UPDATE SKIP LOCKED",
                (self.store.now(), batch_size),
            ).fetchall()
            for row in rows:
                # Callback failure leaves durable queued work for the next retry.
                try:
                    evidence = destroy_and_verify(
                        row["backup_id"], row["provider_reference"]
                    )
                    checked = (
                        BackupEvidence.model_validate(evidence.model_dump())
                        if evidence is not None
                        else None
                    )
                except Exception:
                    checked = None
                if checked is None:
                    conn.execute(
                        "UPDATE learning.backup_inventory SET state='deletion_pending' "
                        "WHERE backup_id=%s",
                        (row["backup_id"],),
                    )
                    conn.execute(
                        "UPDATE learning.deletion_job SET state='blocked',"
                        "last_error_code='backup_window_open' WHERE backup_id=%s",
                        (row["backup_id"],),
                    )
                    continue
                now = self.store.now()
                conn.execute(
                    "UPDATE learning.backup_inventory "
                    "SET state='verified_unrecoverable',"
                    "unrecoverable_verified_at=%s,ledger_checkpoint_sha256=%s "
                    "WHERE backup_id=%s",
                    (now, checked.checkpoint_sha256, row["backup_id"]),
                )
                conn.execute(
                    "UPDATE learning.deletion_job SET state='verified',"
                    "completed_at=%s,"
                    "last_error_code=NULL,ledger_checkpoint_sha256=%s WHERE "
                    "backup_id=%s",
                    (now, checked.checkpoint_sha256, row["backup_id"]),
                )
                count += 1
        return count
