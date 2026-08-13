# Imagen Docker combinada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the FastAPI backend and the built Angular frontend into a single Docker image that serves both from one process on port 8100, and publish it to Docker Hub automatically from GitHub Actions on every push to `main`.

**Architecture:** A multi-stage `Dockerfile` builds the Angular app in a Node stage and copies its static output into a Python runtime stage; a new `mount_frontend()` function in `apps/api/app/main.py` serves those static files and falls back to `index.html` for any non-`/api` path (SPA routing), registered after all API routers so `/api/*` always wins the route match. A `docker-entrypoint.sh` runs `alembic upgrade head` before starting `uvicorn`, so a failed migration stops the container instead of serving a stale schema. A GitHub Actions workflow builds and pushes the same image on every push to `main`.

**Tech Stack:** Docker (multi-stage build), Python 3.11-slim, Node 24-alpine, FastAPI/Starlette, GitHub Actions (`docker/build-push-action`).

**Spec:** `docs/superpowers/specs/2026-08-13-docker-imagen-combinada-design.md`

## Global Constraints

- **Never run `git commit`, `git push`, or `git merge`.** At the end of every task, leave changed files as-is (staged or not) and report which files changed plus a suggested commit message — the user commits everything themselves. This applies whether the task is run by a human, by the controlling session, or by a dispatched subagent.
- Docker is available and the daemon is running in this environment (verified: `docker info` succeeds) — Tasks 2 and 3 include real `docker build`/`docker run` verification steps, not just descriptions of what to run.
- The Angular production build emits to `apps/web/dist/web/browser/` (verified with a real build — not `apps/web/dist/web/` directly).
- The built `index.html` uses `<base href="/">` and references its JS/CSS/favicon with root-relative paths (e.g. `main-E6OEXQYK.js`, resolved against `/`) — verified by inspecting a real build's `index.html`. Static assets must be served from the same root the SPA fallback uses, not under a sub-path like `/static/...`.
- `apps/web/src/environments/environment.ts` already sets `apiUrl: '/api'` (relative) — no frontend code changes are needed for same-origin deployment.
- Backend requires Python `>=3.11` (`apps/api/pyproject.toml`); Angular CLI 22 requires Node `^22.22.3 || ^24.15.0 || >=26.0.0` (`node_modules/@angular/cli/package.json`) — use `python:3.11-slim` and `node:24-alpine`.
- Backend tests run with `cd apps/api && .venv/bin/pytest <path> -v` (real Postgres DB via `apps/api/tests/conftest.py` fixtures, no mocking).
- Docker image name and tags: `jptorresdota/icm-loja:1.0.0` and `jptorresdota/icm-loja:latest`.
- Container listens on port **8100** (`uvicorn --host 0.0.0.0 --port 8100`).
- No `docker-compose.yml` — explicitly out of scope per the spec.

---

### Task 1: Backend serves the built frontend (`mount_frontend`)

**Files:**
- Modify: `apps/api/app/config.py`
- Modify: `apps/api/app/main.py`
- Create: `apps/api/tests/test_main.py`

**Interfaces:**
- Produces: `Settings.static_dir: str` (new field, default `"static"`), `app.main.mount_frontend(app: FastAPI, static_dir: Path) -> None` — registers a catch-all `GET /{full_path:path}` route that serves an exact file from `static_dir` if one exists at that path, otherwise serves `static_dir/index.html`; does nothing if `static_dir` doesn't exist. Consumed by Task 2 (the Dockerfile copies the Angular build into the path this setting points at inside the image).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_main.py`:

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import mount_frontend


def _build_app(static_dir: Path) -> FastAPI:
    app = FastAPI()
    mount_frontend(app, static_dir)
    return app


def test_serves_index_html_at_root(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    client = TestClient(_build_app(tmp_path))

    response = client.get("/")

    assert response.status_code == 200
    assert response.text == "<html>SPA</html>"


def test_serves_existing_asset_file_directly(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    (tmp_path / "main-ABC123.js").write_text("console.log('hi');")
    client = TestClient(_build_app(tmp_path))

    response = client.get("/main-ABC123.js")

    assert response.status_code == 200
    assert response.text == "console.log('hi');"


def test_falls_back_to_index_html_for_unknown_spa_route(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    client = TestClient(_build_app(tmp_path))

    response = client.get("/reportes/infracciones")

    assert response.status_code == 200
    assert response.text == "<html>SPA</html>"


def test_does_not_mount_when_static_dir_missing(tmp_path):
    missing_dir = tmp_path / "does-not-exist"
    client = TestClient(_build_app(missing_dir))

    response = client.get("/")

    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_main.py -v`
Expected: FAIL with `ImportError: cannot import name 'mount_frontend' from 'app.main'`

- [ ] **Step 3: Add the `static_dir` setting**

In `apps/api/app/config.py`, add a field to the `Settings` class (after `cors_origins`):

```python
    cors_origins: str = "http://localhost:4200"
    static_dir: str = "static"
```

- [ ] **Step 4: Implement `mount_frontend` and wire it into `main.py`**

Replace the full contents of `apps/api/app/main.py` with:

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import settings
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.infracciones import router as infracciones_router
from app.routers.reportes import router as reportes_router

app = FastAPI(title="Matriculación API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(auditoria_router)


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    if not static_dir.is_dir():
        return
    index_file = static_dir / "index.html"

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str) -> FileResponse:
        candidate = static_dir / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


mount_frontend(app, Path(settings.static_dir))
```

(This must be registered **after** all four `app.include_router(...)` calls — the catch-all route only ever serves requests that don't match an already-registered `/api/*` route, because Starlette matches routes in registration order.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_main.py -v`
Expected: PASS (4 passed)

Then run the full backend suite to confirm nothing else broke (the new catch-all route is a no-op in this environment since `apps/api/static` doesn't exist, so no existing route should be affected):

Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests)

- [ ] **Step 6: Report your changes (do not commit)**

Files changed: `apps/api/app/config.py`, `apps/api/app/main.py`, `apps/api/tests/test_main.py`. Suggested commit message: `feat(api): serve the built Angular frontend with SPA fallback routing`. Do not run `git add` or `git commit`.

---

### Task 2: Dockerfile, entrypoint, and `.dockerignore`

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `docker-entrypoint.sh` (repo root)
- Create: `.dockerignore` (repo root)

**Interfaces:**
- Consumes: `Settings.static_dir` default `"static"` (Task 1) — the Dockerfile copies the Angular build to `/app/static` inside the image, which is exactly what `Path(settings.static_dir)` resolves to when the process's working directory is `/app` (the image's `WORKDIR`).
- Produces: a runnable image (verified locally by tag `jptorresdota/icm-loja:1.0.0` in this task, before Task 3 wires up automated publishing).

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore` in the repo root:

```
**/.venv/
**/__pycache__/
**/*.pyc
**/.env
**/.env.local
apps/api/tests/
apps/api/.pytest_cache/
apps/api/matriculacion_api.egg-info/
apps/web/node_modules/
apps/web/dist/
apps/web/.angular/
.git/
.superpowers/
docs/
desing/
```

- [ ] **Step 2: Write the entrypoint script**

Create `docker-entrypoint.sh` in the repo root:

```sh
#!/bin/sh
set -e

alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8100
```

- [ ] **Step 3: Write the Dockerfile**

Create `Dockerfile` in the repo root:

```dockerfile
# ---- Stage 1: build the Angular frontend ----
FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build -- --configuration production

# ---- Stage 2: backend runtime, serving the built frontend ----
FROM python:3.11-slim AS runtime
WORKDIR /app

COPY apps/api/pyproject.toml ./
COPY apps/api/app/ ./app/
RUN pip install --no-cache-dir .

COPY apps/api/alembic/ ./alembic/
COPY apps/api/alembic.ini ./

COPY --from=frontend-build /app/dist/web/browser/ ./static/

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8100

ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 4: Build the image**

Run (from the repo root, `/Users/juanpablotorres/Documents/matriculacion`):
```bash
docker build -t jptorresdota/icm-loja:1.0.0 -f Dockerfile .
```
Expected: build completes successfully, ending in a line like `Successfully tagged jptorresdota/icm-loja:1.0.0` (or the equivalent BuildKit "naming to ... done" output). If it fails, read the failing step's output — the most likely causes are a missing file in a `COPY` (check the path is exactly as declared above) or a `pip install` failure (check `apps/api/pyproject.toml` wasn't accidentally excluded by `.dockerignore`).

- [ ] **Step 5: Run the image against the local Postgres and smoke-test it**

The local dev Postgres runs on the host machine at port 5433 (per `apps/api/.env`'s `DATABASE_URL`). From inside a Docker container on macOS/Docker Desktop, the host is reached via `host.docker.internal`, not `localhost`. Run:

```bash
docker run -d --name icm-loja-smoketest -p 8100:8100 \
  -e DATABASE_URL="postgresql+asyncpg://axis:axis@host.docker.internal:5433/axis_migracion" \
  -e JWT_SECRET="local-smoke-test-secret-do-not-use-in-prod" \
  jptorresdota/icm-loja:1.0.0
```

Wait a few seconds for startup, then check the logs to confirm migrations ran and uvicorn started without errors:
```bash
docker logs icm-loja-smoketest
```
Expected: log lines showing Alembic applying (or already at) `head`, followed by uvicorn's startup lines (`Uvicorn running on http://0.0.0.0:8100`).

Then verify all three routing paths:
```bash
curl -s http://localhost:8100/ | grep -o '<title>[^<]*</title>'
```
Expected: `<title>ICM Loja - Sistema de Multas</title>` (confirms `index.html` is served at root).

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8100/reportes/impugnaciones
```
Expected: `200` (confirms the SPA fallback serves `index.html` for a deep link, not a 404 — this is the check that would have caught a broken catch-all).

```bash
curl -s -X POST http://localhost:8100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"wrong"}'
```
Expected: a JSON body like `{"detail":"Credenciales inválidas"}` with a `401` status (confirms `/api/*` still reaches the real API and is never swallowed by the SPA catch-all).

- [ ] **Step 6: Clean up the smoke-test container**

```bash
docker rm -f icm-loja-smoketest
```

- [ ] **Step 7: Report your changes (do not commit)**

Files changed: `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore` (all new, repo root). Suggested commit message: `feat: add multi-stage Dockerfile combining backend and frontend`. Do not run `git add` or `git commit`.

---

### Task 3: GitHub Actions workflow to build and publish on push to `main`

**Files:**
- Create: `.github/workflows/docker-publish.yml`

**Interfaces:**
- Consumes: `Dockerfile` at the repo root (Task 2) — the workflow builds it with the exact same command proven to work in Task 2.
- Produces: on every push to `main`, a build+push of `jptorresdota/icm-loja:1.0.0` and `jptorresdota/icm-loja:latest` to Docker Hub (once the user configures the two required secrets — see Step 4).

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/docker-publish.yml`:

```yaml
name: Build and publish Docker image

on:
  push:
    branches:
      - main

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            jptorresdota/icm-loja:1.0.0
            jptorresdota/icm-loja:latest
```

- [ ] **Step 2: Validate the YAML syntax**

Run (the project's backend virtualenv already has PyYAML installed as a transitive dependency):
```bash
cd apps/api && .venv/bin/python -c "import yaml; yaml.safe_load(open('../../.github/workflows/docker-publish.yml'))" && echo "YAML OK"
```
Expected: `YAML OK` with no traceback. If this raises a `yaml.YAMLError`, the file has a syntax error (bad indentation is the most common cause) — fix it and re-run.

- [ ] **Step 3: Confirm the build step matches what was already proven**

This workflow's `docker/build-push-action` step builds with `context: .` and `file: ./Dockerfile` — the same context and Dockerfile already built successfully by hand in Task 2, Step 4. There is nothing further to verify locally: GitHub Actions runners aren't available in this environment, and this workflow can only fully execute once it's pushed to a GitHub repository with the secrets below configured.

- [ ] **Step 4: Tell the user how to finish enabling this (manual, on their end)**

This step is informational, not something to execute — report it back to whoever reviews this task's completion:

> To activate this workflow, two repository secrets need to be created in GitHub (Settings → Secrets and variables → Actions → New repository secret):
> - `DOCKERHUB_USERNAME` — the Docker Hub username for `jptorresdota@gmail.com`'s account.
> - `DOCKERHUB_TOKEN` — an Access Token generated at Docker Hub → Account Settings → Security → New Access Token (not the account password).
>
> Once both secrets exist, the next push to `main` will trigger the workflow automatically.

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `.github/workflows/docker-publish.yml` (new). Suggested commit message: `ci: publish Docker image to Docker Hub on push to main`. Do not run `git add` or `git commit`. Remind whoever reads the report that the two Docker Hub secrets described in Step 4 still need to be created in the GitHub repository before this workflow can run successfully.

---

## Final verification

- [ ] Run the full backend suite once more: `cd apps/api && .venv/bin/pytest -v` → all green.
- [ ] Confirm no container named `icm-loja-smoketest` was left running: `docker ps -a --filter name=icm-loja-smoketest` → empty.
- [ ] Confirm the three new top-level files exist and nothing else changed outside the files named in this plan: `git status --short` should show only `apps/api/app/config.py`, `apps/api/app/main.py`, `apps/api/tests/test_main.py`, `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore`, `.github/workflows/docker-publish.yml` as new/modified (plus whatever pre-existing uncommitted changes were already present before this plan started).
