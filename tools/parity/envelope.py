"""AnalyzeResponse envelope check: backend responses against the phone's gate.

Builds the phone's own request for every case (envelope.mjs build), sends it
to the real FastAPI app with the deployed ReferenceAnalysisService through
FastAPI's in-process TestClient, stores each response in a temp directory, then
validates each one with the phone's generated wire validator and runs it
through the real hybrid analyser (envelope.mjs check). The cases include the
adversarial-refusal set in adversarial.mjs.

By default there is no network and never the live URL. With --base-url the
same requests also go over HTTPS to that backend (opt-in, never in pytest), the
phone-side checks run on the deployed answers, and every case that differs from
the in-process answer is listed. Only synthetic product data is sent. The 429
and 503 cases stay in-process. Requests are paced under the rate limit.

Exit 0: no defect. Exit 1: a defect or a deployed difference. Exit 2: the tool
could not run.

Usage: python tools/parity/envelope.py [--keep DIR] [--base-url URL]
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

MJS = Path(__file__).with_name("envelope.mjs")
JSON_HEADERS = {"content-type": "application/json"}
KEEP_HEADERS = {"content-type", "retry-after"}
IN_PROCESS_ONLY = {"problem-429-rate-limited", "problem-503-unavailable"}
# 60 requests per minute per client, burst 20: one request every 1.1 s never
# drains the bucket.
PACE_SECONDS = 1.1
WAKE_SECONDS = 150.0
USER_AGENT = "ingradient-parity/1 (synthetic product data)"

Stored = dict[str, Any]


class ExplodingService:
    """An analysis service that fails, so the route must answer 503."""

    def assess(self, request: Any, *, input_digest: str) -> Any:
        raise RuntimeError("simulated analysis failure")


def node(mode: str, work: Path) -> int:
    done = subprocess.run(["node", str(MJS), mode, str(work)], cwd=ROOT, check=False)
    if done.returncode not in (0, 1) or (mode == "build" and done.returncode != 0):
        raise SystemExit(2)
    return done.returncode


def stored_from(status: int, headers: dict[str, str], text: str) -> Stored:
    kept = {k.lower(): v for k, v in headers.items() if k.lower() in KEEP_HEADERS}
    return {"status": status, "headers": kept, "text": text}


def write(work: Path, folder: str, name: str, stored: Stored) -> None:
    (work / folder).mkdir(exist_ok=True)
    (work / folder / f"{name}.json").write_text(json.dumps(stored), encoding="utf-8")


def raw_problems(work: Path, first: str) -> list[tuple[str, bytes, dict[str, str]]]:
    """A valid phone request made undocumented, malformed, mislabelled or huge."""

    from app.contract.limits import MAX_REQUEST_BYTES

    sample = json.loads((work / "requests" / f"{first}.json").read_text("utf-8"))
    undocumented = {**sample, "profile": {"allergies": ["milk"]}}
    return [
        (
            "problem-400-undocumented-field",
            json.dumps(undocumented).encode(),
            JSON_HEADERS,
        ),
        ("problem-400-not-json", b"not json", JSON_HEADERS),
        (
            "problem-400-wrong-media-type",
            json.dumps(sample).encode(),
            {"content-type": "text/plain"},
        ),
        (
            "problem-413-oversize",
            b"{" + b" " * MAX_REQUEST_BYTES + b"}",
            JSON_HEADERS,
        ),
    ]


def requests_for(
    work: Path, cases: list[dict[str, Any]]
) -> list[tuple[str, bytes, dict[str, str]]]:
    """Every request that can go to any backend: the cases, then raw problems."""

    sent = [
        (
            case["name"],
            (work / "requests" / f"{case['name']}.json").read_bytes(),
            JSON_HEADERS,
        )
        for case in cases
    ]
    return [*sent, *raw_problems(work, cases[0]["name"])]


def collect(work: Path, cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """In-process answers for every case, plus the 429 and 503 problems."""

    from fastapi.testclient import TestClient

    from app.analysis import ReferenceAnalysisService, load_resources
    from app.contract.limits import AnalysisRateLimiter
    from app.main import create_app

    reference = ReferenceAnalysisService(load_resources())

    def keep(name: str, response: Any) -> None:
        stored = stored_from(
            response.status_code, dict(response.headers), response.text
        )
        write(work, "responses", name, stored)

    for name, content, headers in requests_for(work, cases):
        # A fresh app per case, so the rate limiter never limits a vector.
        with TestClient(create_app(analysis_service=reference)) as client:
            keep(name, client.post("/v1/analyses", content=content, headers=headers))
    extra = [
        {"name": name, "group": "problem"}
        for name, _content, _headers in raw_problems(work, cases[0]["name"])
    ]

    sample = (work / "requests" / f"{cases[0]['name']}.json").read_bytes()
    # The real limiter with a one-token bucket: the second request is limited.
    limited = create_app(
        analysis_service=reference,
        rate_limiter=AnalysisRateLimiter(clock=lambda: 0.0, burst=1),
    )
    with TestClient(limited) as client:
        client.post("/v1/analyses", content=sample, headers=JSON_HEADERS)
        keep(
            "problem-429-rate-limited",
            client.post("/v1/analyses", content=sample, headers=JSON_HEADERS),
        )
    extra.append({"name": "problem-429-rate-limited", "group": "problem"})

    failing = create_app(analysis_service=ExplodingService())  # type: ignore[arg-type]
    with TestClient(failing) as client:
        keep(
            "problem-503-unavailable",
            client.post("/v1/analyses", content=sample, headers=JSON_HEADERS),
        )
    extra.append({"name": "problem-503-unavailable", "group": "problem"})
    return [*cases, *extra]


# ----- deployed mode (opt-in) ------------------------------------------------


def checked_base_url(value: str) -> str:
    parts = urlsplit(value)
    local = parts.hostname in {"localhost", "127.0.0.1", "::1"}
    if parts.scheme != "https" and not (parts.scheme == "http" and local):
        raise argparse.ArgumentTypeError("use an https URL (http only for localhost)")
    return value.rstrip("/")


def http(
    method: str, url: str, body: bytes | None, headers: dict[str, str], timeout: float
) -> Stored:
    request = urllib.request.Request(
        url, data=body, method=method, headers={**headers, "user-agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return stored_from(
                response.status,
                dict(response.headers.items()),
                response.read().decode("utf-8", "replace"),
            )
    except urllib.error.HTTPError as error:
        return stored_from(
            error.code,
            dict(error.headers.items()),
            error.read().decode("utf-8", "replace"),
        )


def is_wake_up(stored: Stored) -> bool:
    """A proxy page while the free instance starts, not an API answer."""

    kind = stored["headers"].get("content-type", "")
    return stored["status"] in (502, 503, 504) and "json" not in kind


def wake(base_url: str) -> Stored:
    deadline = time.monotonic() + WAKE_SECONDS
    while True:
        try:
            health = http("GET", f"{base_url}/health", None, {}, 90.0)
            if health["status"] == 200:
                return health
        except (urllib.error.URLError, TimeoutError):
            pass
        if time.monotonic() > deadline:
            print(f"deployed backend did not wake in {WAKE_SECONDS:.0f} s")
            raise SystemExit(2)
        time.sleep(5)


def post_deployed(base_url: str, body: bytes, headers: dict[str, str]) -> Stored:
    stored: Stored = {}
    for _attempt in range(4):
        stored = http("POST", f"{base_url}/v1/analyses", body, headers, 60.0)
        if is_wake_up(stored):
            time.sleep(10)
            continue
        if stored["status"] == 429:
            # Never expected at this pace; wait it out once and record it.
            time.sleep(float(stored["headers"].get("retry-after", "5")) + 1)
            stored["note"] = "rate limited once, retried"
            continue
        return stored
    return stored


def deployed(work: Path, cases: list[dict[str, Any]], base_url: str) -> Stored:
    """Send the same requests to base_url; deployed answers replace in-process."""

    shutil.copytree(work / "responses", work / "responses-in-process")
    health = wake(base_url)
    print(f"deployed /health {health['status']}: {health['text']}")
    for name, content, headers in requests_for(work, cases):
        time.sleep(PACE_SECONDS)
        write(work, "responses", name, post_deployed(base_url, content, headers))
    return health


def summary(stored: Stored) -> str:
    try:
        body = json.loads(stored["text"])
    except ValueError:
        return f"{stored['status']} not-json"
    if isinstance(body, dict) and isinstance(body.get("scientific"), dict):
        scientific = body["scientific"]
        grade = scientific.get("grade", "")
        return f"{stored['status']} {scientific.get('state')} {grade}".strip()
    if isinstance(body, dict):
        return f"{stored['status']} {body.get('code', '')}".strip()
    return str(stored["status"])


def differences(work: Path, manifest: list[dict[str, Any]]) -> int:
    """Print the deployed-versus-in-process table. Returns the differing count."""

    rows: list[tuple[str, str, str, str]] = []
    for entry in manifest:
        name = entry["name"]
        here = json.loads(
            (work / "responses-in-process" / f"{name}.json").read_text("utf-8")
        )
        if name in IN_PROCESS_ONLY:
            rows.append((name, summary(here), "in-process only", "-"))
            continue
        there = json.loads((work / "responses" / f"{name}.json").read_text("utf-8"))
        same_status = here["status"] == there["status"]
        try:
            same_body = json.loads(here["text"]) == json.loads(there["text"])
        except ValueError:
            same_body = here["text"] == there["text"]
        same_type = here["headers"].get("content-type") == there["headers"].get(
            "content-type"
        )
        verdict = "same" if same_status and same_body and same_type else "DIFFER"
        if verdict == "DIFFER":
            parts = [
                label
                for label, ok in (
                    ("status", same_status),
                    ("body", same_body),
                    ("content-type", same_type),
                )
                if not ok
            ]
            verdict = "DIFFER " + "/".join(parts)
        rows.append((name, summary(here), summary(there), verdict))
    (work / "deployed-diff.json").write_text(json.dumps(rows, indent=2), "utf-8")
    print(f"{'case':38}{'in-process':30}{'deployed':30}compare")
    for name, here_text, there_text, verdict in rows:
        print(f"{name:38}{here_text:30}{there_text:30}{verdict}")
    differing = sum(1 for row in rows if row[3].startswith("DIFFER"))
    print(f"deployed: {differing} case(s) differ from in-process")
    return differing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", type=Path, help="write the work files here")
    parser.add_argument(
        "--base-url",
        type=checked_base_url,
        help="also send every request to this deployed backend (opt-in)",
    )
    args = parser.parse_args()
    work = args.keep or Path(tempfile.mkdtemp(prefix="ingr-envelope-"))
    work.mkdir(parents=True, exist_ok=True)
    try:
        node("build", work)
        cases = json.loads((work / "cases.json").read_text(encoding="utf-8"))
        manifest = collect(work, cases)
        differing = 0
        if args.base_url:
            deployed(work, cases, args.base_url)
            for entry in manifest:
                deployed_answer = entry["name"] not in IN_PROCESS_ONLY
                entry["via"] = "deployed" if deployed_answer else "in-process"
            differing = differences(work, manifest)
        (work / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        code = node("check", work)
    finally:
        if args.keep is None:
            shutil.rmtree(work, ignore_errors=True)
    raise SystemExit(1 if code or differing else 0)


if __name__ == "__main__":
    main()
