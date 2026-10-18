"""Unwired sink. Its host must supply actual post-send/connected evidence.

The current API background callback has no such evidence, so it cannot enable
this sink. NullLearningSink stays in deploy/app.py until a separate release.
"""

from collections.abc import Callable
from uuid import uuid4

from app.contract.models import AnalyzeRequest, AnalyzeResponse

from .models import ProductPayload, StorageError
from .store import LearningStore


class PostSendLearningSink:
    def __init__(
        self,
        store: LearningStore,
        *,
        prepare: Callable[[AnalyzeRequest], ProductPayload],
        sent_and_connected: Callable[[], bool] = lambda: False,
    ) -> None:
        self.store = store
        self.prepare = prepare
        self.sent_and_connected = sent_and_connected
        self.last_code: str | None = None

    def record(self, request: AnalyzeRequest, response: AnalyzeResponse) -> None:
        if not self.store.collection_enabled() or not self.sent_and_connected():
            return
        record_id = uuid4()
        try:
            payload = self.prepare(request)
            self.store.ingest(
                payload, record_id=record_id, sent_and_connected=self.sent_and_connected
            )
            self.store.expire()
        except StorageError as exc:
            self.last_code = exc.code
        except Exception:
            # Driver/validation exceptions may contain product data: never log,
            # expose, persist or attach the exception to the already-sent reply.
            self.last_code = "storage_unavailable"
