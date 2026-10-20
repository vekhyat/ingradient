# Ingradient backend

FastAPI exposes `GET /health` and `POST /v1/analyses` using the frozen contract in `contracts/openapi-hybrid.yaml`. The analysis boundary validates and limits request bodies, rate limits callers, computes a canonical product-input digest, validates responses and returns contract problem responses for failures. Health reads the contract version at startup and works without a database.

The base entrypoint is `app.main:app`. Its `create_app()` factory defaults to `NamedGapAnalysisService` and `NullLearningSink`: analysis returns the named `candidate_method_not_released` gap, and product collection is off. It does not read a database URL or import the optional PostgreSQL driver.

`app/analysis/` implements the pure Python reference calculator, ingredient parsing, exact matching and evidence rendering. The development entrypoint `deploy.app:app` explicitly injects `ReferenceAnalysisService` and keeps `NullLearningSink`. Resource loading verifies pinned bytes before requests are served; unavailable resources produce a method gap. Installing dependencies or setting a mobile server URL does not change the base factory's default service.

## Install and run

Use Python 3.14.3 (`.python-version`) and uv 0.13.1, matching CI. On Windows, from this directory:

```powershell
python -m pip install uv==0.13.1
uv sync --locked
uv run --locked uvicorn app.main:app --no-access-log --host 127.0.0.1 --port 8000
```

On Linux:

1. Install uv 0.13.1 with its standalone installer:

   ```bash
   curl -LsSf https://astral.sh/uv/0.13.1/install.sh | sh
   ```

   Open a new shell so `uv` is on `PATH`. uv downloads Python 3.14.3 from `.python-version` if it is not installed.

2. Install and run from this directory:

   ```bash
   uv sync --locked
   uv run --locked uvicorn app.main:app --no-access-log --host 127.0.0.1 --port 8000
   ```

Open <http://127.0.0.1:8000/health> for status and the manifest contract version. FastAPI's `/docs` describes the routes this process actually serves. The project package version is separate from the wire contract version.

The checked-in Render development blueprint is `deploy/render.yaml`; select that path when creating the service. It installs locked runtime dependencies with `uv sync --project backend --frozen --no-dev` and runs `deploy.app:app`, enabling reference analysis with collection off. Automatic deploys are disabled. The repository root stays in the deployment artifact so `backend/`, `contracts/` and `resources/` remain together. No production database or automatic migration runner is configured.

To run the same development service locally, replace `app.main:app` in the command above with `deploy.app:app`. For a hosted Unix process from `backend/`, use `.venv/bin/uvicorn deploy.app:app --no-access-log --host 0.0.0.0 --port "$PORT"`, with `PORT` set by the hosting environment.

The mobile app uses the phone pipeline by default. Set `EXPO_PUBLIC_ANALYSIS_URL` before starting Metro to enable hybrid requests. For a USB-connected Android phone, reverse port 8000 and use `http://127.0.0.1:8000`; an Android emulator uses `http://10.0.2.2:8000`. The client gates product-fact requests on acceptance of its versioned notice and falls back to phone analysis when needed. Photos and saved history are not part of the analysis request.

## Checks

```powershell
uv sync --locked
uv run --locked ruff check
uv run --locked ruff format --check
uv run --locked pyright
uv run --locked pytest
```

These commands are the same in bash on Linux.

The default `dev` dependency group includes the isolated `learning-store` group so strict type checking can inspect the optional store and its tests. The driver stays outside runtime dependencies: `uv sync --locked --no-dev` omits it. Having it installed for development does not import it into the API process. Base tests assert that health and default analysis do not import database drivers or open database connections.

Ordinary pytest runs skip the opt-in PostgreSQL wrapper when `BE13_TEST_DSN` is unset. Other API/scientific tests use local fixtures without external services. CI runs Python lint, formatting, type checks and tests, followed by comparisons of actual Python and TypeScript nutrition calculations, complete scientific assessments and exact matching. Those comparisons are separate from shared expected-vector tests.

From the repository root, after installing the app and backend dependencies, resource checks are:

```powershell
backend/.venv/Scripts/python.exe tools/resources/verify_resources.py
backend/.venv/Scripts/python.exe tools/resources/build_match_vectors.py --check
```

On Unix, use `backend/.venv/bin/python`. Parity commands and artifact outputs are recorded in `.github/workflows/backend.yml`; keep the full scientific comparison as well as the calculation-only and matching comparisons.

## Disposable PostgreSQL tests

`app/learning_store/` contains opt-in storage, validation, curation, deletion and backup-maintenance code. Migrations live in `migrations/`. This code is not wired into `app.main:app`; installing its driver does not enable collection.

The isolated suite requires PostgreSQL 18 on loopback and a database named exactly `learning_test`. Its fixtures drop and rebuild the `learning` schema and apply every up/down migration. Use only a disposable local database. With Docker running, from `backend/` in PowerShell:

```powershell
docker run --detach --rm --name ingradient-be13-pg18-test -e POSTGRES_PASSWORD=disposable_local_password -e POSTGRES_DB=learning_test -p 127.0.0.1:55432:5432 postgres:18
docker exec ingradient-be13-pg18-test pg_isready -U postgres -d learning_test
uv sync --locked --group learning-store
$env:BE13_TEST_DSN = 'postgresql://postgres:disposable_local_password@127.0.0.1:55432/learning_test'
$env:BE13_TEST_CONTAINER = 'ingradient-be13-pg18-test'
try {
  uv run --locked --group learning-store pytest tests/learning_store/test_isolated.py -v -s
} finally {
  Remove-Item Env:BE13_TEST_DSN
  Remove-Item Env:BE13_TEST_CONTAINER
  docker stop ingradient-be13-pg18-test
}
```

On Linux, from `backend/` in bash:

```bash
docker run --detach --rm --name ingradient-be13-pg18-test -e POSTGRES_PASSWORD=disposable_local_password -e POSTGRES_DB=learning_test -p 127.0.0.1:55432:5432 postgres:18
docker exec ingradient-be13-pg18-test pg_isready -U postgres -d learning_test
uv sync --locked --group learning-store
BE13_TEST_DSN='postgresql://postgres:disposable_local_password@127.0.0.1:55432/learning_test' \
BE13_TEST_CONTAINER='ingradient-be13-pg18-test' \
  uv run --locked --group learning-store pytest tests/learning_store/test_isolated.py -v -s
docker stop ingradient-be13-pg18-test
```

Wait for `pg_isready` to succeed before running pytest. The wrapper runs store cases in a child process so driver imports cannot invalidate the base API's no-driver assertions. The exact container name also enables the guarded synthetic dump/restore and deletion-replay case. CI provisions its own `postgres:18` service with a random local port, supplies both test variables and runs this wrapper independently of the base suite. It does not use inherited `DATABASE_URL` values or production credentials.

`app/learning_store/requirements.txt` mirrors the pinned isolated driver for standalone tooling. Prefer the locked uv group for reproducible development and CI.

## Settings and logs

`.env.example` lists process settings. Copy it to a gitignored `.env` if needed. `INGRADIENT_ENV` defaults to `local`; `INGRADIENT_LOG_LEVEL` defaults to `INFO`. Settings do not define a database URL or collection switch.

The `ingradient` logger records request method, route template and status. Unknown routes use `<unmatched>`; query strings, actual path parameters, request/response bodies and client addresses are omitted. App tracing, metrics and telemetry logs are disabled. Keep Uvicorn's `--no-access-log` flag, because its separate access log includes client addresses and raw request paths.
