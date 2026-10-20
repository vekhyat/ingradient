"""Token bucket defaults are the frozen operating limits."""

from typing import Any

from tests.contract.support import openapi

from app.contract.limits import (
    GLOBAL_PER_HOUR,
    MAX_REQUEST_BYTES,
    PER_CLIENT_BURST,
    PER_CLIENT_PER_MINUTE,
    AnalysisRateLimiter,
    client_rate_key,
)


def _limits() -> dict[str, Any]:
    spec = openapi()
    limits = spec["x-draft-operating-limits"]
    if not isinstance(limits, dict):
        raise AssertionError("operating limits missing")
    return limits


def test_constants_match_the_frozen_operating_limits() -> None:
    limits = _limits()
    rate = limits["rateLimit"]
    assert MAX_REQUEST_BYTES == limits["maxRequestBytes"] == 262144
    assert rate["scope"] == "POST /v1/analyses only"
    assert PER_CLIENT_PER_MINUTE == rate["perClientAddressPerMinute"] == 60
    assert PER_CLIENT_BURST == rate["burst"] == 20
    assert GLOBAL_PER_HOUR == rate["globalPerHour"] == 1800
    limiter = AnalysisRateLimiter()
    assert limiter.per_client_per_minute == PER_CLIENT_PER_MINUTE
    assert limiter.burst == PER_CLIENT_BURST
    assert limiter.global_per_hour == GLOBAL_PER_HOUR


def test_per_client_burst_then_refill() -> None:
    now = {"t": 0.0}
    limiter = AnalysisRateLimiter(clock=lambda: now["t"])
    for _ in range(PER_CLIENT_BURST):
        assert limiter.allow("198.51.100.8").allowed
    denied = limiter.allow("198.51.100.8")
    assert not denied.allowed
    assert denied.retry_after_seconds == 1
    assert limiter.allow("198.51.100.9").allowed

    now["t"] = 0.5
    assert not limiter.allow("198.51.100.8").allowed
    now["t"] = 1.0
    assert limiter.allow("198.51.100.8").allowed


def test_global_bucket_is_1800_and_then_waits_two_seconds() -> None:
    limiter = AnalysisRateLimiter(clock=lambda: 0.0)
    for index in range(GLOBAL_PER_HOUR):
        decision = limiter.allow(f"client-{index // PER_CLIENT_BURST}")
        assert decision.allowed
    denied = limiter.allow("client-fresh")
    assert not denied.allowed
    assert denied.retry_after_seconds == 2


def test_rejected_new_clients_do_not_allocate_buckets() -> None:
    limiter = AnalysisRateLimiter(clock=lambda: 0.0, global_per_hour=1)
    assert limiter.allow("admitted").allowed
    for index in range(10_000):
        assert not limiter.allow(f"rejected-{index}").allowed
    # Inspect allocation itself: public allow() cannot prove no bucket was stored.
    assert set(limiter._clients) == {"admitted"}  # pyright: ignore[reportPrivateUsage]


def test_sweep_removes_full_idle_buckets_and_keeps_depleted_clients() -> None:
    now = {"t": 0.0}
    limiter = AnalysisRateLimiter(
        clock=lambda: now["t"], per_client_per_minute=2, burst=2
    )
    assert limiter.allow("idle").allowed
    now["t"] = 30.0
    assert limiter.allow("active").allowed
    assert limiter.allow("active").allowed
    now["t"] = 60.0
    assert limiter.allow("new").allowed
    assert set(limiter._clients) == {"active", "new"}  # pyright: ignore[reportPrivateUsage]
    assert limiter.allow("active").allowed
    assert not limiter.allow("active").allowed
    assert limiter.allow("idle").allowed
    assert limiter.allow("idle").allowed
    assert not limiter.allow("idle").allowed


def test_a_backwards_clock_does_not_refill() -> None:
    now = {"t": 5.0}
    limiter = AnalysisRateLimiter(clock=lambda: now["t"])
    for _ in range(PER_CLIENT_BURST):
        assert limiter.allow("198.51.100.8").allowed
    now["t"] = 0.0
    assert not limiter.allow("198.51.100.8").allowed


def test_rate_key_uses_the_rightmost_forwarded_address() -> None:
    assert client_rate_key(["203.0.113.1, 198.51.100.10"], "192.0.2.1") == (
        "198.51.100.10"
    )
    assert client_rate_key(["  198.51.100.10 , 203.0.113.50  "], "192.0.2.1") == (
        "203.0.113.50"
    )
    assert client_rate_key(["203.0.113.9", "198.51.100.8"], "192.0.2.1") == (
        "198.51.100.8"
    )
    assert client_rate_key([], "192.0.2.1") == "192.0.2.1"
    assert client_rate_key([""], "192.0.2.1") == "192.0.2.1"
    assert client_rate_key([], None) == ""
