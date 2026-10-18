# pyright: reportPrivateUsage=false
# Maintenance is part of the same exclusive writer boundary as LearningStore.
"""Explicit off-independent administration; no scheduler, provider or file access.

The release operator supplies independently recovered deletion evidence. This
module cannot choose its durable location or verify a provider's history window.
"""

import hashlib
import json
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from pydantic import Field, TypeAdapter, model_validator

from .models import Hash, SourceSelector, StorageError, StrictModel, Token
from .store import LearningStore, Reason


class DeletionEntry(StrictModel):
    deletion_id: UUID
    record_id: UUID | None
    record_kind: Literal["original", "curated"] | None
    artifact_id: UUID | None
    backup_id: UUID | None
    source_selector: SourceSelector | None
    reason: Reason
    propagate: bool
    requested_at: datetime

    @model_validator(mode="after")
    def target(self) -> Self:
        if (
            sum(
                v is not None
                for v in (
                    self.record_id,
                    self.artifact_id,
                    self.backup_id,
                    self.source_selector,
                )
            )
            != 1
        ):
            raise ValueError("one target required")
        if (self.record_id is None) != (self.record_kind is None):
            raise ValueError("record target requires kind")
        if self.requested_at.tzinfo is None:
            raise ValueError("timezone required")
        return self


class DeletionManifest(StrictModel):
    entries: Annotated[list[DeletionEntry], Field(max_length=10000)]
    checkpoint_sha256: Hash

    @model_validator(mode="after")
    def checksum(self) -> Self:
        ids = [e.deletion_id for e in self.entries]
        if len(set(ids)) != len(ids) or self.checkpoint_sha256 != manifest_hash(
            self.entries
        ):
            raise ValueError("manifest checkpoint mismatch")
        return self


def manifest_hash(entries: Sequence[DeletionEntry]) -> str:
    raw = [e.model_dump(mode="json", exclude_unset=True) for e in entries]
    return hashlib.sha256(
        json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class Maintenance:
    def __init__(self, store: LearningStore) -> None:
        self.store = store

    def enqueue_artifact(self, artifact_id: UUID, reason: Reason) -> UUID:
        if reason == "expiry":
            raise StorageError()
        with self.store.transaction() as conn:
            exists = conn.execute(
                "SELECT 1 FROM learning.artifact WHERE artifact_id=%s FOR UPDATE",
                (artifact_id,),
            ).fetchone()
            if exists is None:
                raise StorageError("storage_artifact_ineligible")
            # Commit the root admission barrier before a later descendant sweep.
            conn.execute(
                "UPDATE learning.artifact SET state='blocked' "
                "WHERE artifact_id=%s AND state<>'deleted'",
                (artifact_id,),
            )
            deletion_id = uuid4()
            conn.execute(
                "INSERT INTO learning.deletion_job "
                "(deletion_id,artifact_id,propagate,reason,state,requested_at) "
                "VALUES (%s,%s,true,%s,'queued',%s)",
                (deletion_id, artifact_id, reason, self.store.now()),
            )
            return deletion_id

    def export_deletions(self) -> DeletionManifest:
        """Export only technical barriers; durable off-DB persistence is "
        "a release gate."""
        with self.store.transaction() as conn:
            rows = conn.execute(
                "SELECT deletion_id,record_id,record_kind,artifact_id,"
                "backup_id,source_selector,reason,propagate,requested_at "
                "FROM learning.deletion_job WHERE rescinded_at IS NULL "
                "ORDER BY deletion_id"
            ).fetchall()
        entries = [DeletionEntry.model_validate(r) for r in rows]
        return DeletionManifest(
            entries=entries, checkpoint_sha256=manifest_hash(entries)
        )

    def replay_deletions(self, manifest: DeletionManifest) -> None:
        """Run on a quarantined restore before any caller can read/export it.

        Hashes detect corruption, not authenticity or freshness. The release
        operator must recover/verify the latest external checkpoint independently.
        Replay never marks provider history, artifacts or backups erased.
        """
        checked = DeletionManifest.model_validate(
            manifest.model_dump(mode="json", exclude_unset=True)
        )
        # Reinsert all barriers atomically before any erasure sweeps can start.
        with self.store.transaction() as conn:
            selectors = [
                e.source_selector for e in checked.entries if e.source_selector
            ]
            from .store import source_key

            for key in sorted(
                {source_key(s.kind, s.rights_reference) for s in selectors}
            ):
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (key,))
            ids = [e.record_id for e in checked.entries if e.record_id is not None]
            existing = conn.execute(
                "SELECT record_id FROM learning.record_registry "
                "WHERE record_id=ANY(%s)",
                (ids,),
            ).fetchall()
            known = {r["record_id"] for r in existing}
            self.store._lock_records(conn, sorted(known))
            for entry in checked.entries:
                # A target created after this snapshot has no payload to erase.
                if entry.record_id is not None and entry.record_id not in known:
                    continue
                if entry.artifact_id is not None or entry.backup_id is not None:
                    # Those objects need independent inventory/retirement replay;
                    # refuse reconnect until an operator reconciles that evidence.
                    raise StorageError("storage_external_replay_required")
                conn.execute(
                    """INSERT INTO learning.deletion_job
                    (deletion_id,record_id,record_kind,source_selector,propagate,reason,
                     state,requested_at) VALUES (%s,%s,%s,%s,%s,%s,'queued',%s)
                    ON CONFLICT (deletion_id) DO UPDATE SET rescinded_at=NULL,
                    rescind_reason=NULL,state='queued',completed_at=NULL,
                    ledger_checkpoint_sha256=NULL""",
                    (
                        entry.deletion_id,
                        entry.record_id,
                        entry.record_kind,
                        Jsonb(
                            entry.source_selector.model_dump(
                                mode="json", exclude_none=True
                            )
                        )
                        if entry.source_selector
                        else None,
                        entry.propagate,
                        entry.reason,
                        entry.requested_at,
                    ),
                )
                if entry.record_id is not None:
                    conn.execute(
                        "UPDATE learning.record_registry SET blocked_at="
                        "COALESCE(blocked_at,%s) WHERE record_id=%s",
                        (self.store.now(), entry.record_id),
                    )
        for entry in checked.entries:
            if entry.record_id is None or entry.record_id in known:
                self.store.process_deletion(entry.deletion_id)

    def admit_artifact(
        self,
        *,
        kind: Literal["dataset", "export", "model"],
        version: str,
        sha256: str,
        members: Sequence[UUID],
        dependencies: Sequence[UUID] = (),
        reviewed: bool = False,
    ) -> UUID:
        TypeAdapter(Token).validate_python(version)
        TypeAdapter(Hash).validate_python(sha256)
        if (
            not reviewed
            or kind not in {"dataset", "export", "model"}
            or len(members) > 10000
            or len(dependencies) > 100
            or len(set(members)) != len(members)
            or len(set(dependencies)) != len(dependencies)
            or kind == "model"
            and (members or not dependencies)
            or kind in {"dataset", "export"}
            and (not members or dependencies)
        ):
            raise StorageError("storage_artifact_ineligible")
        with self.store.transaction() as conn:
            dep_rows = conn.execute(
                "SELECT * FROM learning.artifact WHERE artifact_id=ANY(%s)",
                (list(dependencies),),
            ).fetchall()
            if len(dep_rows) != len(dependencies) or any(
                d["state"] != "approved" or d["artifact_kind"] != "dataset"
                for d in dep_rows
            ):
                raise StorageError("storage_artifact_ineligible")
            inherited = conn.execute(
                "SELECT curated_id FROM learning.artifact_member "
                "WHERE artifact_id=ANY(%s)",
                (list(dependencies),),
            ).fetchall()
            all_members = sorted(set(members) | {r["curated_id"] for r in inherited})
            self.store._source_locks(
                conn, self.store._discover_sources(conn, all_members)
            )
            self.store._lock_records(conn, self.store._ancestry(conn, all_members))
            now = self.store.now()
            for record_id in all_members:
                row = self.store._eligible(conn, record_id, now)
                if row["record_kind"] != "curated":
                    raise StorageError("storage_artifact_ineligible")
            # Registry locks are held before artifacts; deletion follows the same order.
            for dep in sorted(dependencies):
                row = conn.execute(
                    "SELECT state FROM learning.artifact "
                    "WHERE artifact_id=%s FOR UPDATE",
                    (dep,),
                ).fetchone()
                if row is None or row["state"] != "approved":
                    raise StorageError("storage_artifact_ineligible")
            artifact_id = uuid4()
            generation = 1 + max((r["generation"] for r in dep_rows), default=-1)
            conn.execute(
                "INSERT INTO learning.artifact "
                "(artifact_id,artifact_kind,generation,version,sha256,state,created_at,"
                "approved_at,storage_object_id) "
                "VALUES (%s,%s,%s,%s,%s,'approved',%s,%s,%s)",
                (artifact_id, kind, generation, version, sha256, now, now, uuid4()),
            )
            for member in members:
                conn.execute(
                    "INSERT INTO learning.artifact_member "
                    "(artifact_id,artifact_kind,curated_id) VALUES (%s,%s,%s)",
                    (artifact_id, kind, member),
                )
            for dep in dep_rows:
                conn.execute(
                    "INSERT INTO learning.artifact_dependency "
                    "(artifact_id,child_generation,input_artifact_id,input_generation) "
                    "VALUES (%s,%s,%s,%s)",
                    (artifact_id, generation, dep["artifact_id"], dep["generation"]),
                )
            return artifact_id
