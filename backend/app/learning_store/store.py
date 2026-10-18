"""Exclusive ADR014 writer. No environment URL lookup or production composition.

Only the owner/migrator may grant write access: public has no schema privileges.
All ingestion/curation/admin writes must use this boundary, never direct table DML.
The injected factory is purpose scoped; the runtime guard runs before it is called.
"""

import hashlib
import json
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from time import monotonic
from typing import Any, Literal
from uuid import UUID, uuid4

from psycopg import Connection, sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import (
    ProductPayload,
    Source,
    SourceSelector,
    StorageError,
    validate_payload,
)
from .serialize import remap_payload

DB = Connection[dict[str, Any]]
ConnectionFactory = Callable[[], DB]
Clock = Callable[[], datetime]
Reason = Literal[
    "expiry",
    "rights_withdrawal",
    "correction",
    "explicit_request",
    "invalid_content",
    "no_longer_needed",
]
PRODUCT_COLUMNS = (
    "barcode",
    "product_name",
    "market",
    "ingredients_text",
    "ingredients_status",
    "declared_category",
    "category",
    "source_refs",
    "observations",
    "scoring_facts",
    "issue_codes",
    "versions",
)
JSON_COLUMNS = {
    "source_refs",
    "observations",
    "scoring_facts",
    "issue_codes",
    "versions",
}


def utc_now() -> datetime:
    return datetime.now(UTC)


def month_deadline(now: datetime) -> datetime:
    """12 UTC calendar months, including the PostgreSQL leap-day clamp."""
    try:
        return now.replace(year=now.year + 1)
    except ValueError:
        return now.replace(year=now.year + 1, day=28)


def source_key(kind: str, reference: UUID) -> int:
    pair = json.dumps([kind, str(reference)], separators=(",", ":")).encode()
    return int.from_bytes(hashlib.sha256(pair).digest()[:8], "big", signed=True)


class LearningStore:
    def __init__(
        self,
        connect: ConnectionFactory,
        *,
        clock: Clock = utc_now,
        collection_enabled: Callable[[], bool] = lambda: False,
    ) -> None:
        self._connect = connect
        self.clock = clock
        self.collection_enabled = collection_enabled

    def now(self) -> datetime:
        now = self.clock()
        if now.tzinfo is None:
            raise StorageError("storage_clock_invalid")
        return now.astimezone(UTC)

    @contextmanager
    def transaction(self) -> Generator[DB]:
        with self._connect() as conn:
            conn.row_factory = dict_row
            conn.execute("SET LOCAL TIME ZONE 'UTC'")
            conn.execute("SET LOCAL lock_timeout = '2s'")
            conn.execute("SET LOCAL statement_timeout = '5s'")
            yield conn

    def _source_locks(self, conn: DB, sources: Sequence[Source]) -> None:
        keys = {
            source_key(s.kind, s.rights_reference)
            for s in sources
            if s.rights_reference is not None
        }
        for key in sorted(keys):
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (key,))

    def _sources_allowed(
        self, conn: DB, sources: Sequence[Source], *, curated: bool = False
    ) -> None:
        jobs = conn.execute(
            "SELECT source_selector FROM learning.deletion_job "
            "WHERE source_selector IS NOT NULL AND rescinded_at IS NULL"
        ).fetchall()
        for source in sources:
            if source.rights_state in {"restricted", "withdrawn"} or (
                curated and source.rights_state != "eligible"
            ):
                raise StorageError("storage_rights_ineligible")
            for job in jobs:
                if SourceSelector.model_validate(job["source_selector"]).matches(
                    source
                ):
                    raise StorageError("storage_source_revoked")

    def _sources(self, payloads: Sequence[ProductPayload]) -> list[Source]:
        return [s for p in payloads for s in p.source_refs]

    def _insert_payload(
        self,
        conn: DB,
        table: Literal["original_submission", "curated_example"],
        record_id: UUID,
        payload: ProductPayload,
        extra: dict[str, object],
    ) -> None:
        raw = payload.model_dump(mode="json", exclude_unset=True)
        values = {
            key: (
                Jsonb(raw[key])
                if key in JSON_COLUMNS and raw[key] is not None
                else raw[key]
            )
            for key in PRODUCT_COLUMNS
        }
        values.update(record_id=record_id, storage_schema_version=1, **extra)
        columns = sql.SQL(",").join(sql.Identifier(key) for key in values)
        placeholders = sql.SQL(",").join(sql.Placeholder() for _ in values)
        # Table names and column keys are internal constants, never product strings.
        conn.execute(
            sql.SQL("INSERT INTO learning.{} ({}) VALUES ({})").format(
                sql.Identifier(table), columns, placeholders
            ),
            tuple(values.values()),
        )

    def ingest(
        self,
        payload: object,
        *,
        record_id: UUID,
        sent_and_connected: Callable[[], bool] = lambda: False,
    ) -> UUID | None:
        if not self.collection_enabled() or not sent_and_connected():
            return None
        checked = validate_payload(payload)  # before opening any DB connection
        if not self.collection_enabled() or not sent_and_connected():
            return None
        with self.transaction() as conn:
            self._source_locks(conn, checked.source_refs)
            if not self.collection_enabled() or not sent_and_connected():
                return None
            self._sources_allowed(conn, checked.source_refs)
            # Reserve UUID once per operation; a concurrent retry waits on the PK.
            now = self.now()
            inserted = conn.execute(
                "INSERT INTO learning.record_registry "
                "(record_id,record_kind,generation,created_at) VALUES "
                "(%s,'original',0,%s) "
                "ON CONFLICT DO NOTHING RETURNING record_id",
                (record_id, now),
            ).fetchone()
            if inserted is None:
                existing = conn.execute(
                    "SELECT * FROM learning.record_registry "
                    "WHERE record_id=%s FOR UPDATE",
                    (record_id,),
                ).fetchone()
                original = conn.execute(
                    "SELECT * FROM learning.original_submission WHERE record_id=%s",
                    (record_id,),
                ).fetchone()
                if (
                    existing is None
                    or existing["record_kind"] != "original"
                    or existing["blocked_at"]
                    or existing["tombstoned_at"]
                    or original is None
                    or original["expires_at"] <= now
                    or self._payload(original) != checked
                ):
                    raise StorageError("storage_retry_conflict")
                return record_id
            self._insert_payload(
                conn,
                "original_submission",
                record_id,
                checked,
                {"received_at": now, "expires_at": now + timedelta(days=90)},
            )
        return record_id

    def _payload(self, row: dict[str, Any]) -> ProductPayload:
        return validate_payload({key: row[key] for key in PRODUCT_COLUMNS})

    def _ancestry(self, conn: DB, ids: Sequence[UUID]) -> list[UUID]:
        rows = conn.execute(
            """WITH RECURSIVE ancestors(id) AS (
            SELECT unnest(%s::uuid[]) UNION
            SELECT l.source_record_id FROM learning.curation_link l
            JOIN ancestors a ON l.curated_id=a.id)
            SELECT id FROM ancestors ORDER BY id""",
            (list(ids),),
        ).fetchall()
        return [r["id"] for r in rows]

    def _lock_records(self, conn: DB, ids: Sequence[UUID]) -> None:
        for record_id in sorted(set(ids)):
            row = conn.execute(
                "SELECT record_id FROM learning.record_registry "
                "WHERE record_id=%s FOR UPDATE",
                (record_id,),
            ).fetchone()
            if row is None:
                raise StorageError("storage_record_unavailable")

    def _eligible(self, conn: DB, record_id: UUID, now: datetime) -> dict[str, Any]:
        reg = conn.execute(
            "SELECT * FROM learning.record_registry WHERE record_id=%s", (record_id,)
        ).fetchone()
        if reg is None or reg["blocked_at"] or reg["tombstoned_at"]:
            raise StorageError("storage_record_unavailable")
        table = (
            "original_submission"
            if reg["record_kind"] == "original"
            else "curated_example"
        )
        row = conn.execute(
            sql.SQL("SELECT * FROM learning.{} WHERE record_id=%s").format(
                sql.Identifier(table)
            ),
            (record_id,),
        ).fetchone()
        if row is None or (
            reg["record_kind"] == "original" and row["expires_at"] <= now
        ):
            raise StorageError("storage_record_unavailable")
        if reg["record_kind"] == "curated" and (
            row["next_review_at"] <= now or row["rights_status"] != "eligible"
        ):
            raise StorageError("storage_review_due")
        ancestors = self._ancestry(conn, [record_id])
        denied = conn.execute(
            "SELECT 1 FROM learning.deletion_job WHERE "
            "record_id=ANY(%s) AND propagate AND rescinded_at IS NULL LIMIT 1",
            (ancestors,),
        ).fetchone()
        if denied:
            raise StorageError("storage_ancestor_blocked")
        payloads = [self._payload(row)]
        if row.get("correction_before") is not None:
            payloads.append(validate_payload(row["correction_before"]))
        self._sources_allowed(
            conn, self._sources(payloads), curated=reg["record_kind"] == "curated"
        )
        return row | {"generation": reg["generation"]}

    def read(self, record_id: UUID) -> ProductPayload:
        """Administrative read, not a customer runtime entrypoint."""
        with self.transaction() as conn:
            return self._payload(self._eligible(conn, record_id, self.now()))

    def curate(
        self,
        inputs: Sequence[UUID],
        payload: object,
        *,
        protocol: str,
        scope: Literal["product_facts", "training_example", "correction_pair"],
        before: object | None = None,
    ) -> UUID:
        from pydantic import TypeAdapter

        from .models import Token

        checked = remap_payload(validate_payload(payload))
        previous = (
            remap_payload(validate_payload(before)) if before is not None else None
        )
        TypeAdapter(Token).validate_python(protocol)
        if not inputs or len(inputs) > 100 or len(set(inputs)) != len(inputs):
            raise StorageError("storage_inputs_invalid")
        if scope not in {"product_facts", "training_example", "correction_pair"} or (
            (scope == "correction_pair") != (previous is not None)
        ):
            raise StorageError()
        sources = self._sources([checked] + ([previous] if previous else []))
        with self.transaction() as conn:
            # Lock proposed AND input-source scopes before registry rows. Inputs
            # are immutable; discovery is repeated under locks before admission.
            discovered = self._discover_sources(conn, inputs)
            self._source_locks(conn, sources + discovered)
            ancestors = self._ancestry(conn, inputs)
            self._lock_records(conn, ancestors)
            now = self.now()
            rows = [self._eligible(conn, i, now) for i in inputs]
            self._sources_allowed(conn, sources, curated=True)
            # Retain shared publisher scope provenance across fresh IDs. Otherwise
            # expiring the only original could make its derived copy undiscoverable
            # by a later withdrawal. Unknown retained editions match every edition.
            for source in discovered:
                if source.rights_reference is not None and not any(
                    candidate.kind == source.kind
                    and candidate.rights_reference == source.rights_reference
                    and candidate.title == source.title
                    and candidate.edition in {source.edition, None}
                    for candidate in sources
                ):
                    raise StorageError("storage_rights_ineligible")
            record_id = uuid4()
            generation = 1 + max(r["generation"] for r in rows)
            conn.execute(
                "INSERT INTO learning.record_registry "
                "(record_id,record_kind,generation,created_at) "
                "VALUES (%s,'curated',%s,%s)",
                (record_id, generation, now),
            )
            self._insert_payload(
                conn,
                "curated_example",
                record_id,
                checked,
                {
                    "reviewed_at": now,
                    "next_review_at": month_deadline(now),
                    "review_protocol_version": protocol,
                    "review_scope": scope,
                    "rights_status": "eligible",
                    "correction_before": (
                        Jsonb(previous.model_dump(mode="json", exclude_unset=True))
                        if previous
                        else None
                    ),
                },
            )
            for row in rows:
                conn.execute(
                    "INSERT INTO learning.curation_link "
                    "(curated_id,child_generation,source_record_id,source_generation,"
                    "derivation_kind,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                    (
                        record_id,
                        generation,
                        row["record_id"],
                        row["generation"],
                        "correction" if previous else "curation",
                        now,
                    ),
                )
            # Recheck time-sensitive input eligibility before leaving the transaction.
            for input_id in inputs:
                self._eligible(conn, input_id, self.now())
            return record_id

    def _discover_sources(self, conn: DB, ids: Sequence[UUID]) -> list[Source]:
        sources = []
        for table in ("original_submission", "curated_example"):
            for row in conn.execute(
                sql.SQL("SELECT * FROM learning.{} WHERE record_id=ANY(%s)").format(
                    sql.Identifier(table)
                ),
                (list(ids),),
            ).fetchall():
                sources.extend(self._payload(row).source_refs)
                if row.get("correction_before") is not None:
                    sources.extend(
                        validate_payload(row["correction_before"]).source_refs
                    )
        return sources

    def enqueue_record(self, record_id: UUID, reason: Reason) -> UUID:
        with self.transaction() as conn:
            self._source_locks(conn, self._discover_sources(conn, [record_id]))
            self._lock_records(conn, [record_id])
            return self._enqueue_record(conn, record_id, reason, self.now())

    def _enqueue_record(
        self, conn: DB, record_id: UUID, reason: Reason, now: datetime
    ) -> UUID:
        reg = conn.execute(
            "SELECT * FROM learning.record_registry WHERE record_id=%s", (record_id,)
        ).fetchone()
        if reg is None:
            raise StorageError("storage_record_unavailable")
        propagate = not (
            reg["record_kind"] == "original"
            and reason in {"expiry", "no_longer_needed"}
        )
        if reason == "expiry" and reg["record_kind"] != "original":
            raise StorageError()
        job = uuid4()
        conn.execute(
            "UPDATE learning.record_registry SET blocked_at=COALESCE(blocked_at,%s) "
            "WHERE record_id=%s",
            (now, record_id),
        )
        conn.execute(
            "UPDATE learning.curated_example SET rights_status='deletion_pending' "
            "WHERE record_id=%s",
            (record_id,),
        )
        conn.execute(
            "INSERT INTO learning.deletion_job "
            "(deletion_id,record_id,record_kind,propagate,reason,state,requested_at) "
            "VALUES (%s,%s,%s,%s,%s,'queued',%s)",
            (job, record_id, reg["record_kind"], propagate, reason, now),
        )
        return job

    def revoke_source(self, selector: SourceSelector) -> UUID:
        selector = SourceSelector.model_validate(
            selector.model_dump(exclude_unset=True)
        )
        with self.transaction() as conn:
            conn.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (source_key(selector.kind, selector.rights_reference),),
            )
            job = uuid4()
            conn.execute(
                "INSERT INTO learning.deletion_job "
                "(deletion_id,source_selector,propagate,reason,state,requested_at) "
                "VALUES (%s,%s,true,'rights_withdrawal','queued',%s)",
                (
                    job,
                    Jsonb(selector.model_dump(mode="json", exclude_none=True)),
                    self.now(),
                ),
            )
            return job

    def expire(self, *, batch_size: int = 100, budget_seconds: float = 0.1) -> int:
        if not self.collection_enabled():
            return 0
        if not 1 <= batch_size <= 100 or not 0 < budget_seconds <= 0.1:
            raise StorageError()
        deadline = monotonic() + budget_seconds
        with self.transaction() as conn:
            if not self.collection_enabled():
                return 0
            # SKIP LOCKED applies to registry too; curation locks those same rows.
            rows = conn.execute(
                "SELECT o.record_id FROM learning.original_submission o "
                "JOIN learning.record_registry r USING(record_id) "
                "WHERE o.expires_at<=%s ORDER BY o.expires_at,o.record_id "
                "LIMIT %s FOR UPDATE OF o,r SKIP LOCKED",
                (self.now(), batch_size),
            ).fetchall()
            count = 0
            for row in rows:
                if monotonic() >= deadline or not self.collection_enabled():
                    break
                job = self._enqueue_record(conn, row["record_id"], "expiry", self.now())
                self._erase_record_job(conn, job)
                count += 1
            return count

    def _descendants(self, conn: DB, ids: Sequence[UUID]) -> list[UUID]:
        rows = conn.execute(
            """WITH RECURSIVE descendants(id) AS (
            SELECT unnest(%s::uuid[]) UNION
            SELECT l.curated_id FROM learning.curation_link l
            JOIN descendants d ON l.source_record_id=d.id)
            SELECT id FROM descendants ORDER BY id""",
            (list(ids),),
        ).fetchall()
        return [r["id"] for r in rows]

    def _erase_record_job(self, conn: DB, job_id: UUID) -> None:
        job = conn.execute(
            "SELECT * FROM learning.deletion_job WHERE deletion_id=%s FOR UPDATE",
            (job_id,),
        ).fetchone()
        if job is None or job["record_id"] is None or job["rescinded_at"] is not None:
            raise StorageError()
        ids = (
            self._descendants(conn, [job["record_id"]])
            if job["propagate"]
            else [job["record_id"]]
        )
        self._lock_records(conn, ids)
        # Block every dependent artifact before payload erasure. No file deletion
        # is claimed; administrative verification remains required for completion.
        if job["propagate"]:
            affected = conn.execute(
                """WITH RECURSIVE affected(id) AS (
                SELECT artifact_id FROM learning.artifact_member
                WHERE curated_id=ANY(%s)
                UNION SELECT d.artifact_id FROM learning.artifact_dependency d
                JOIN affected a ON d.input_artifact_id=a.id)
                SELECT id FROM affected ORDER BY id""",
                (ids,),
            ).fetchall()
            self._block_artifacts(conn, [row["id"] for row in affected])
        now = self.now()
        conn.execute(
            "UPDATE learning.record_registry SET blocked_at=COALESCE(blocked_at,%s),"
            "tombstoned_at=COALESCE(tombstoned_at,%s) WHERE record_id=ANY(%s)",
            (now, now, ids),
        )
        conn.execute(
            "DELETE FROM learning.original_submission WHERE record_id=ANY(%s)", (ids,)
        )
        conn.execute(
            "DELETE FROM learning.curated_example WHERE record_id=ANY(%s)", (ids,)
        )
        conn.execute(
            "UPDATE learning.deletion_job SET state='blocked', "
            "last_error_code='ledger_unavailable' "
            "WHERE deletion_id=%s AND state<>'verified'",
            (job_id,),
        )

    def process_deletion(self, job_id: UUID) -> None:
        """Off-independent admin entrypoint. Never called by health or analysis."""
        with self.transaction() as conn:
            job = conn.execute(
                "SELECT * FROM learning.deletion_job WHERE deletion_id=%s", (job_id,)
            ).fetchone()
            if job is None:
                raise StorageError()
            if job["rescinded_at"] is not None:
                raise StorageError("storage_review_required")
            if job["backup_id"] is not None:
                conn.execute(
                    "UPDATE learning.backup_inventory SET state='deletion_pending' "
                    "WHERE backup_id=%s AND state<>'verified_unrecoverable'",
                    (job["backup_id"],),
                )
                conn.execute(
                    "UPDATE learning.deletion_job SET state='blocked',"
                    "last_error_code='backup_window_open' "
                    "WHERE deletion_id=%s AND state<>'verified'",
                    (job_id,),
                )
                return
            if job["artifact_id"] is not None:
                self._block_artifact_tree(conn, job["artifact_id"])
                conn.execute(
                    "UPDATE learning.deletion_job SET state='blocked',"
                    "last_error_code='artifact_unavailable' "
                    "WHERE deletion_id=%s AND state<>'verified'",
                    (job_id,),
                )
                return
            if job["source_selector"] is None:
                ids = self._descendants(conn, [job["record_id"]])
                self._source_locks(conn, self._discover_sources(conn, ids))
                self._lock_records(conn, ids)
                self._erase_record_job(conn, job_id)
                return
            selector = SourceSelector.model_validate(job["source_selector"])
            conn.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (source_key(selector.kind, selector.rights_reference),),
            )
            # Match before LIMIT so unrelated editions cannot starve a sweep.
            candidates = conn.execute(
                """SELECT record_id FROM learning.original_submission
                WHERE learning.source_matches(source_refs,%s)
                UNION SELECT record_id FROM learning.curated_example
                WHERE learning.source_matches(source_refs,%s)
                OR learning.source_matches(correction_before->'source_refs',%s)
                ORDER BY record_id LIMIT 100""",
                tuple([Jsonb(selector.model_dump(mode="json", exclude_none=True))] * 3),
            ).fetchall()
            ids = [row["record_id"] for row in candidates]
            self._lock_records(conn, self._descendants(conn, ids))
            for record_id in ids:
                child = self._enqueue_record(
                    conn, record_id, "rights_withdrawal", self.now()
                )
                self._erase_record_job(conn, child)
            conn.execute(
                "UPDATE learning.deletion_job SET state='blocked',"
                "last_error_code='review_required' WHERE deletion_id=%s",
                (job_id,),
            )

    def _block_artifact_tree(self, conn: DB, artifact_id: UUID) -> None:
        rows = conn.execute(
            """WITH RECURSIVE affected(id) AS (
                SELECT %s::uuid UNION SELECT d.artifact_id
                FROM learning.artifact_dependency d JOIN affected a
                ON d.input_artifact_id=a.id) SELECT id FROM affected ORDER BY id""",
            (artifact_id,),
        ).fetchall()
        self._block_artifacts(conn, [row["id"] for row in rows])

    def _block_artifacts(self, conn: DB, ids: Sequence[UUID]) -> None:
        for artifact_id in sorted(set(ids)):
            conn.execute(
                "SELECT artifact_id FROM learning.artifact "
                "WHERE artifact_id=%s FOR UPDATE",
                (artifact_id,),
            )
        conn.execute(
            "UPDATE learning.artifact SET state='blocked' "
            "WHERE artifact_id=ANY(%s) AND state<>'deleted'",
            (list(ids),),
        )

    def due_reviews(self, *, batch_size: int = 100) -> list[UUID]:
        if not 1 <= batch_size <= 100:
            raise StorageError()
        with self.transaction() as conn:
            return [
                r["record_id"]
                for r in conn.execute(
                    "SELECT record_id FROM learning.curated_example WHERE "
                    "next_review_at<=%s "
                    "ORDER BY next_review_at,record_id LIMIT %s",
                    (self.now(), batch_size),
                ).fetchall()
            ]

    def renew_review(self, record_id: UUID, *, actual_review: bool = False) -> None:
        """Attest an actual review of unchanged content, never automatically."""
        if not actual_review:
            raise StorageError("storage_review_required")
        with self.transaction() as conn:
            sources = self._discover_sources(conn, [record_id])
            self._source_locks(conn, sources)
            ancestors = self._ancestry(conn, [record_id])
            self._lock_records(conn, ancestors)
            reg = conn.execute(
                "SELECT * FROM learning.record_registry WHERE record_id=%s",
                (record_id,),
            ).fetchone()
            row = conn.execute(
                "SELECT * FROM learning.curated_example WHERE record_id=%s",
                (record_id,),
            ).fetchone()
            denied = conn.execute(
                "SELECT 1 FROM learning.deletion_job WHERE record_id=ANY(%s) "
                "AND propagate AND rescinded_at IS NULL",
                (ancestors,),
            ).fetchone()
            if (
                reg is None
                or row is None
                or reg["blocked_at"]
                or reg["tombstoned_at"]
                or denied
                or row["rights_status"] != "eligible"
            ):
                raise StorageError("storage_record_unavailable")
            self._sources_allowed(conn, sources, curated=True)
            now = self.now()
            conn.execute(
                "UPDATE learning.curated_example SET reviewed_at=%s,next_review_at=%s "
                "WHERE record_id=%s",
                (now, month_deadline(now), record_id),
            )
