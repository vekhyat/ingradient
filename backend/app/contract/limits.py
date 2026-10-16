"""Operating limits from the frozen contract's x-draft-operating-limits.

The bucket lives in this process only. A restart, including a Render spin-down,
clears it. The key is never written to a log or a database from this module.
"""

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

# Frozen openapi-hybrid.yaml, x-draft-operating-limits (D105).
MAX_REQUEST_BYTES = 262144
PER_CLIENT_PER_MINUTE = 60
PER_CLIENT_BURST = 20
GLOBAL_PER_HOUR = 1800

_HOUR_SECONDS = 3600
_MINUTE_SECONDS = 60


@dataclass(frozen=True)
class RateDecision:
    """One admission result. ``retry_after_seconds`` is 0 when allowed."""

    allowed: bool
    retry_after_seconds: int


class RateLimiter(Protocol):
    """Admission check the route calls. Tests can substitute another object."""

    def allow(self, key: str) -> RateDecision:
        """Return whether this key may spend one token."""
        ...


class _Bucket:
    def __init__(self, capacity: float, refill_per_second: float) -> None:
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self.tokens = capacity
        self.updated_at: float | None = None

    def refill(self, now: float) -> None:
        if self.updated_at is None:
            self.updated_at = now
            return
        elapsed = now - self.updated_at
        self.updated_at = now
        if elapsed <= 0:
            return
        self.tokens = min(
            self.capacity,
            self.tokens + elapsed * self.refill_per_second,
        )

    def retry_after_seconds(self) -> int:
        if self.tokens >= 1:
            return 0
        missing = 1 - self.tokens
        wait = missing / self.refill_per_second
        return max(1, math.ceil(wait - 1e-9))


class AnalysisRateLimiter:
    """Token bucket for POST /v1/analyses.

    Each client bucket holds ``burst`` tokens and refills at
    ``per_client_per_minute`` per minute. The global bucket holds
    ``global_per_hour`` tokens and refills at that many per hour. A request
    spends one token from both, or from neither.
    """

    def __init__(
        self,
        *,
        clock: Callable[[], float] | None = None,
        per_client_per_minute: int = PER_CLIENT_PER_MINUTE,
        burst: int = PER_CLIENT_BURST,
        global_per_hour: int = GLOBAL_PER_HOUR,
    ) -> None:
        if per_client_per_minute < 1 or burst < 1 or global_per_hour < 1:
            raise ValueError("rate limits must be positive")
        self.per_client_per_minute = per_client_per_minute
        self.burst = burst
        self.global_per_hour = global_per_hour
        self._clock = clock if clock is not None else time.monotonic
        self._client_refill = per_client_per_minute / _MINUTE_SECONDS
        self._global_refill = global_per_hour / _HOUR_SECONDS
        self._clients: dict[str, _Bucket] = {}
        self._global = _Bucket(float(global_per_hour), self._global_refill)
        self._lock = threading.Lock()

    def allow(self, key: str) -> RateDecision:
        with self._lock:
            now = self._clock()
            client = self._clients.get(key)
            if client is None:
                client = _Bucket(float(self.burst), self._client_refill)
                self._clients[key] = client
            client.refill(now)
            self._global.refill(now)
            if client.tokens >= 1 and self._global.tokens >= 1:
                client.tokens -= 1
                self._global.tokens -= 1
                return RateDecision(allowed=True, retry_after_seconds=0)
            waits = [
                bucket.retry_after_seconds()
                for bucket in (client, self._global)
                if bucket.tokens < 1
            ]
            return RateDecision(
                allowed=False,
                retry_after_seconds=max(waits),
            )


def client_rate_key(forwarded_headers: list[str], peer_host: str | None) -> str:
    """Key by the rightmost X-Forwarded-For entry.

    Render's proxy appends the address it observed. Earlier entries are whatever
    the caller sent, so they are not the key. With no forwarded header, the
    immediate peer is the only address the process actually saw.
    """

    parts: list[str] = []
    for header in forwarded_headers:
        for part in header.split(","):
            token = part.strip()
            if token:
                parts.append(token)
    if parts:
        return parts[-1]
    if peer_host:
        return peer_host
    return ""
