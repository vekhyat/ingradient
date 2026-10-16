# Ingradient backend

Local FastAPI process for the analysis API. This task only serves `GET /health`. It does not call Render or Neon, and it does not open a database. Deployment is a later task (BE-14).

The package version in `pyproject.toml` (`0.1.0`) names this Python project. `contractVersion` in the health response is a different value: it is read from `contracts/MANIFEST.json`.

## Run

From this directory (`backend/`):

```powershell
uv run uvicorn app.main:app --no-access-log --host 127.0.0.1 --port 8000
```

Then open <http://127.0.0.1:8000/health>.

The body is JSON: `status` is `ok`, and `contractVersion` is the value in `contracts/MANIFEST.json`.

Install uv if the command is not recognized: <https://docs.astral.sh/uv/getting-started/installation/>. `.python-version` pins 3.14.3. Render's Python page lists 3.14.3 as the default for services created on or after 2026-02-11, and a `.python-version` file selects the interpreter: <https://render.com/docs/python-version>.

## Checks

From this directory:

```powershell
uv run ruff check
uv run ruff format --check
uv run pyright
uv run pytest
```

`uv run` creates `.venv` from `uv.lock` when it is missing. The first run downloads the pinned interpreter and packages. Tests do not use the network.

## Settings

Copy `.env.example` to `.env` in this directory. `.env` is gitignored. The example file has names and placeholders only.

| Name                   | Default | Meaning                                                                             |
| ---------------------- | ------- | ----------------------------------------------------------------------------------- |
| `INGRADIENT_ENV`       | `local` | A label for this process, written once when the app starts                          |
| `INGRADIENT_LOG_LEVEL` | `INFO`  | Level for the `ingradient` logger (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) |

There is no database URL. `GET /health` must answer without a database (D105).

## Logging

The app logger is named `ingradient`. After each HTTP request it writes one line: method, route template and status. For example, `/example/{value}` omits the actual parameter value; an unknown route is `<unmatched>`. Query strings are omitted. The line does not include the request body, the response body, or the client address. FastAPI tracing, metrics and logs are turned off in `app/main.py`, so a machine-wide OpenTelemetry provider does not start recording query strings.

Uvicorn has a second log, the access log. Its default line includes the client address, for example `127.0.0.1:51234 - "GET /health HTTP/1.1" 200 OK`. `--no-access-log` turns that log off. [Uvicorn's logging settings](https://www.uvicorn.org/settings/#logging) document the flag. Leave it on the command above.

## What each file does

| File                   | Role                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `pyproject.toml`       | Package name, Python range, runtime libraries and dev tools                      |
| `uv.lock`              | Exact versions of those libraries. Commit this file                              |
| `.python-version`      | Interpreter uv and Render should use: 3.14.3                                     |
| `.env.example`         | Setting names with placeholder values                                            |
| `app/main.py`          | App factory. Builds the FastAPI app used by Uvicorn (`app.main:app`)             |
| `app/settings.py`      | Reads `INGRADIENT_*` from the environment and from `.env`                        |
| `app/health.py`        | `GET /health`. Loads `contractVersion` from `contracts/MANIFEST.json` at startup |
| `app/logging.py`       | Logger setup and the request-completed line                                      |
| `app/__init__.py`      | Marks `app` as a Python package                                                  |
| `tests/conftest.py`    | Test app. Does not read a developer's `.env`                                     |
| `tests/test_health.py` | Health body, schema, no database, and the log check                              |

## What this folder does not do yet

`POST /v1/analyses`, database migrations and the Render deploy are later tasks. The frozen API is `contracts/openapi-hybrid.yaml`. FastAPI's generated `/docs` page is only a local view of the routes this process actually serves.

Further reading: [FastAPI first steps](https://fastapi.tiangolo.com/tutorial/first-steps/), [settings](https://fastapi.tiangolo.com/advanced/settings/), [bigger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/), [uv projects](https://docs.astral.sh/uv/concepts/projects/overview/), [Ruff](https://docs.astral.sh/ruff/), [Pyright configuration](https://microsoft.github.io/pyright/#/configuration).
