"""Run all store cases separately from production no-driver import assertions."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_postgresql_storage_in_isolated_process() -> None:
    if not os.environ.get("BE13_TEST_DSN"):
        pytest.skip("BE13_TEST_DSN enables the disposable local PostgreSQL suite")
    if importlib.util.find_spec("psycopg") is None:
        pytest.fail(
            "Install app/learning_store/requirements.txt for the isolated suite"
        )
    env = dict(os.environ, BE13_ISOLATED_CHILD="1")
    backend = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/learning_store/cases",
            "-q",
            "-o",
            "python_files=case_*.py",
        ],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    print(result.stdout)
    print(result.stderr)
    assert result.returncode == 0, result.stdout + result.stderr
