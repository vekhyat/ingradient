from typing import Any, cast

import pytest

from app.contract.models import AnalyzeRequest, AnalyzeResponse
from app.learning_store.models import ProductPayload, validate_payload
from app.learning_store.sink import PostSendLearningSink
from app.learning_store.store import LearningStore


def test_off_sink_never_prepares_or_connects() -> None:
    def forbidden_connect():
        pytest.fail("off sink opened DB")

    def forbidden_prepare(_: AnalyzeRequest) -> ProductPayload:
        pytest.fail("off sink projected content")

    sink = PostSendLearningSink(
        LearningStore(forbidden_connect),
        prepare=forbidden_prepare,
        sent_and_connected=lambda: True,
    )
    sink.record(cast(AnalyzeRequest, object()), cast(AnalyzeResponse, object()))
    assert sink.last_code is None


def test_exception_codes_are_allowlisted() -> None:
    from app.learning_store.models import StorageError

    assert str(StorageError("private note")) == "storage_invalid"


@pytest.mark.parametrize("connected", [False, True])
def test_post_send_callback_and_failure_do_not_leak(
    connected: bool, caplog: pytest.LogCaptureFixture
) -> None:
    def forbidden_connect():
        pytest.fail("failed prepare opened DB")

    def fail_prepare(_: AnalyzeRequest) -> ProductPayload:
        raise RuntimeError("synthetic confidential body, account and profile")

    sink = PostSendLearningSink(
        LearningStore(forbidden_connect, collection_enabled=lambda: True),
        prepare=fail_prepare,
        sent_and_connected=lambda: connected,
    )
    sink.record(cast(AnalyzeRequest, object()), cast(AnalyzeResponse, object()))
    assert sink.last_code == ("storage_unavailable" if connected else None)
    assert caplog.text == ""


def test_connected_post_send_writes_only_projected_payload(
    store: LearningStore, payload: dict[str, Any]
) -> None:
    checked = validate_payload(payload)
    sink = PostSendLearningSink(
        store, prepare=lambda _: checked, sent_and_connected=lambda: True
    )
    sink.record(cast(AnalyzeRequest, object()), cast(AnalyzeResponse, object()))
    assert sink.last_code is None
    with store.transaction() as conn:
        rows = conn.execute("SELECT * FROM learning.original_submission").fetchall()
        assert len(rows) == 1 and rows[0]["product_name"] == "Synthetic test product"
