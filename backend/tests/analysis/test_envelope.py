"""Every backend response the phone could get passes the phone's own gate.

Runs tools/parity/envelope.py once, in-process only: the phone's own requests,
the adversarial-refusal set (tools/parity/adversarial.mjs), tampered answers,
the phone's generated wire validator and the phone's hybrid analyser. Any new
defect fails the test. Listed known defects (tools/parity/known-defects.mjs)
are reported, and fail the run once they stop reproducing. The opt-in
--base-url mode never runs here.
"""

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]
TOOL = ROOT / "tools/parity/envelope.py"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (ROOT / "node_modules/typescript").exists(),
    reason="needs node and the phone's installed dependencies",
)

# The brief's adversarial families, one representative case each.
REQUIRED_CASES = {
    "adv-sugars-negative",
    "adv-sugars-nan",
    "adv-sugars-infinity",
    "adv-energy-above-3800kj",
    "adv-duplicate-observation-differ",
    "adv-unit-sugars-kj",
    "adv-enum-category",
    "adv-name-501",
    "adv-ingredients-20001-emoji",
    "adv-inject-script",
    "adv-inject-sql",
    "adv-inject-zalgo-rtl",
    "adv-wire-forged-input-digest",
    "adv-wire-contract-version-old",
}


class Run:
    def __init__(self, done: subprocess.CompletedProcess[str], work: Path) -> None:
        self.done = done
        self.work = work
        self.results: dict[str, Any] = json.loads(
            (work / "results.json").read_text("utf-8")
        )


@pytest.fixture(scope="module")
def run(tmp_path_factory: pytest.TempPathFactory) -> Run:
    work = tmp_path_factory.mktemp("envelope")
    done = subprocess.run(
        [sys.executable, str(TOOL), "--keep", str(work)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    return Run(done, work)


def known_cases(run: Run) -> set[str]:
    """Cases with a listed known defect (the tool fails on any other finding)."""

    return {finding["key"].split(":")[0] for finding in run.results["findings"]}


def test_envelope_has_no_defect(run: Run) -> None:
    out = run.done.stdout
    assert run.done.returncode == 0, out + run.done.stderr
    assert "vector-general-mid" in out
    assert "problem-429-rate-limited" in out
    assert "envelope: no defects" in out
    assert run.results["defects"] == []


def test_canonical_python_answers_use_production_replay(run: Run) -> None:
    vectors = json.loads(
        (ROOT / "resources/vectors/nutriscore-vectors.json").read_text("utf-8")
    )["vectors"]
    rows = {row["case"]: row for row in run.results["rows"]}
    assert len(vectors) == 15
    for vector in vectors:
        row = rows[vector["id"]]
        expected = (
            "replayed-grade"
            if vector["expectedAssessment"]["state"] == "graded"
            else "gap-copy"
        )
        assert row["outcome"] == expected, row


def test_missing_and_null_replay_refuse_each_canonical_grade(run: Run) -> None:
    graded = [
        row
        for row in run.results["rows"]
        if row["case"].startswith("vector-") and row["state"] == "graded"
    ]
    assert len(graded) == 12
    for row in graded:
        assert row["replayControls"] == {
            "missing": "refused-unreplayable",
            "null": "refused-unreplayable",
        }, row


def test_changed_scientific_evidence_is_refused(run: Run) -> None:
    rows = {row["case"]: row for row in run.results["tamperRows"]}
    for change in (
        "grade",
        "score",
        "route",
        "method-id",
        "method-label",
        "trace-points",
        "trace-locator",
        "trace-citations",
        "reason-template",
        "reason-inputs",
        "reason-omission",
    ):
        row = rows[f"tamper-replay-{change}"]
        assert row["phone"] == "refused-unreplayable", row
    assert rows["tamper-method-sha"]["phone"] != "shown"
    assert rows["tamper-replay-server-text"]["phone"] == "shown"


def test_issue_field_known_defect_is_not_hidden_by_replay(run: Run) -> None:
    rows = {row["case"]: row for row in run.results["tamperRows"]}
    assert rows["tamper-script-field"]["phone"] == "shown"
    assert any(
        finding["key"] == "tamper-script-field:phone"
        for finding in run.results["findings"]
    )


def test_default_run_stays_in_process(run: Run) -> None:
    assert not (run.work / "responses-in-process").exists()
    assert not (run.work / "deployed-diff.json").exists()
    manifest = json.loads((run.work / "manifest.json").read_text("utf-8"))
    assert all("via" not in entry for entry in manifest)


def test_adversarial_cases_get_the_documented_outcome(run: Run) -> None:
    rows = run.results["advRows"]
    names = {row["case"] for row in rows}
    assert REQUIRED_CASES <= names, REQUIRED_CASES - names
    known = known_cases(run)
    for row in rows:
        assert row["phone"] != "THROWN", row
        if row["case"] not in known:
            assert row["backend"] == row["expect"], row
            assert row["wireAgrees"], row
            assert not row["parity"].startswith("DIFFER"), row
        if row["sent"] == "phone" and row["backend"] in {
            "graded",
            "insufficient_data",
            "method_unavailable",
        }:
            assert row["gate"] == "ok", row


def test_phone_refuses_what_the_backend_refuses(run: Run) -> None:
    for row in run.results["advRows"]:
        if row["sent"] == "raw" and isinstance(row["backend"], int):
            assert row["phone"].startswith("fallback-"), row


def test_tampered_answers_are_refused_or_shown_safely(run: Run) -> None:
    rows = run.results["tamperRows"]
    assert len(rows) >= 13
    for row in rows:
        shown = row["phone"] == "shown"
        assert shown == (row["expect"] == "shown"), row


def test_known_defects_are_reported(run: Run) -> None:
    assert "KNOWN DEFECT (reported, not fixed)" in run.done.stdout
    assert known_cases(run) <= {row["case"] for row in run.results["advRows"]} | {
        row["case"] for row in run.results["tamperRows"]
    }


def load_tool() -> ModuleType:
    spec = importlib.util.spec_from_file_location("parity_envelope", TOOL)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "url",
    ["http://ingradient-dev.onrender.com", "ftp://example.org", "example.org"],
)
def test_base_url_refuses_plain_http_off_localhost(url: str) -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        load_tool().checked_base_url(url)


def test_base_url_accepts_https_and_local_http() -> None:
    tool = load_tool()
    assert tool.checked_base_url("https://x.example/") == "https://x.example"
    assert tool.checked_base_url("http://127.0.0.1:8000") == "http://127.0.0.1:8000"
