# Reporte de Impugnaciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real report in the app — a paginated, filterable, exportable "Impugnaciones" report over `axis.axis_impugnaciones` (99,788 rows already migrated), replacing the `ReportesComponent` placeholder, and turn "Reportes" into an expandable sidebar submenu ready for future sibling reports.

**Architecture:** FastAPI endpoints under `/api/reportes/impugnaciones*` query `axis.axis_impugnaciones` via a hand-declared SQLAlchemy Core `Table` (separate `MetaData`, not tied to the app's Alembic-managed `Base.metadata`, since this table is owned and populated by the `axis-loja-migracion` skill, not this app's migrations). The Angular frontend adds an `ImpugnacionesService` + `ImpugnacionesComponent` following the app's established zoneless `BehaviorSubject` + `AsyncPipe` pattern, and the sidebar gains its first expandable submenu.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async Core (no ORM for this table), asyncpg, openpyxl (new), pytest + pytest-asyncio + httpx; Angular 22 standalone components, zoneless change detection, ReactiveFormsModule, vitest (`@angular/build:unit-test`).

## Global Constraints

- Endpoints live in a new `apps/api/app/routers/reportes.py`, prefix `/api/reportes`, tag `reportes`, protected with the existing `get_current_user` dependency from `app/routers/auth.py` — no role restriction (any authenticated user).
- Page size is fixed at **50**, never configurable via query param.
- Date filters (`fecha_desde`, `fecha_hasta`) are **required** on both list and export; `estado` is optional. Both must satisfy: same calendar month/year, and `fecha_desde <= fecha_hasta`. Violation → `400` on the server (client blocks it before the request is even sent).
- List ordering is always `ORDER BY fecha_registro DESC, id DESC` (stable pagination).
- Export endpoint returns the **full filtered result, unpaginated** (no `page` param), as a file download (`Content-Disposition: attachment`), in `csv` or `xlsx` — column headers are the Spanish labels below, never raw DB column names.
- The 10 report columns (DB → Spanish header), used identically on screen and in exports:
  `registro`→Registro, `fecha_registro`→Fecha de Registro, `fecha_acta`→Fecha de Acta, `estado`→Estado, `codigo_infraccion_axis`→Código de Infracción AXIS, `contravencion`→Contravención, `tipo_acta`→Tipo de Acta, `articulo_original`→Artículo Original, `monto_capital_original`→Monto Capital Original, `observacion`→Observación.
- Frontend data loading (list results, estados dropdown, export triggers) **must** use the `BehaviorSubject` (private) + public `readonly xxx$` observable + `AsyncPipe` in the template pattern established in this session (`AdministracionUsuariosComponent`, `LoginComponent`). A `.subscribe(v => this.field = v)` assigning a plain field is a defect under this app's zoneless change detection — never do it.
- Async-timing tests for any new Angular data-loading behavior must use a `Subject` (not `of(...)`) to emit *after* the first `detectChanges()`, and assert the DOM update via `await fixture.whenStable()` — never a second manual `detectChanges()` — exactly as done in `administracion-usuarios.component.spec.ts`.
- No new dependency on PostgREST; no new role/permission gate; no filters beyond `estado` + `fecha_registro`.

---

## File Structure

**Backend**
- Create `apps/api/app/axis_tables.py` — SQLAlchemy Core `Table` for `axis.axis_impugnaciones` (own `MetaData`, kept out of Alembic's `Base.metadata`).
- Modify `apps/api/app/schemas.py` — add `ImpugnacionItem`, `ImpugnacionListResponse`.
- Create `apps/api/app/routers/reportes.py` — the three endpoints.
- Modify `apps/api/app/main.py` — register the router.
- Modify `apps/api/pyproject.toml` — add `openpyxl`.
- Create `apps/api/tests/test_reportes_routes.py` — all backend tests.

**Frontend**
- Create `apps/web/src/app/core/models/impugnacion.model.ts` — `ImpugnacionItem`, `ImpugnacionListResponse`, `ImpugnacionFilters`.
- Create `apps/web/src/app/core/impugnaciones.service.ts` + `.spec.ts`.
- Modify `apps/web/src/app/shared/app-shell/app-shell.component.ts` / `.html` / `.spec.ts` — expandable Reportes submenu.
- Delete `apps/web/src/app/features/reportes/reportes.component.ts` / `.html` / `.spec.ts` — placeholder removed.
- Create `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts` / `.html` / `.spec.ts`.
- Modify `apps/web/src/app/app.routes.ts` — replace `/reportes` with `/reportes/impugnaciones`.

---

## Task 1: Backend — Core Table + `/estados` endpoint

**Files:**
- Create: `apps/api/app/axis_tables.py`
- Create: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_reportes_routes.py`

**Interfaces:**
- Produces: `axis_impugnaciones: Table` (module `app.axis_tables`) with columns `id, registro, fecha_registro, fecha_acta, estado, codigo_infraccion_axis, contravencion, tipo_acta, articulo_original, monto_capital_original, observacion`. `router: APIRouter` (module `app.routers.reportes`), prefix `/api/reportes`, exposing `GET /impugnaciones/estados`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_reportes_routes.py`:

```python
from datetime import datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.auth import create_access_token, hash_password
from app.models import User


async def _create_user(db_session, email="user@example.com", password="Sup3rSecret!"):
    user = User(email=email, password_hash=hash_password(password), full_name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _auth_headers(client, db_session):
    await _create_user(db_session)
    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


INSERT_SQL = text(
    """
    INSERT INTO axis.axis_impugnaciones
        (registro, fecha_registro, fecha_acta, estado, codigo_infraccion_axis,
         contravencion, tipo_acta, articulo_original, monto_capital_original, observacion)
    VALUES
        (:registro, :fecha_registro, :fecha_acta, :estado, :codigo_infraccion_axis,
         :contravencion, :tipo_acta, :articulo_original, :monto_capital_original, :observacion)
    RETURNING id
    """
)


async def _seed_impugnaciones(db_session, rows):
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_impugnaciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_impugnaciones WHERE registro LIKE 'TEST-%'"))
    await db_session.commit()


def _row(registro, fecha_registro, estado="A", **overrides):
    base = {
        "registro": registro,
        "fecha_registro": fecha_registro,
        "fecha_acta": fecha_registro,
        "estado": estado,
        "codigo_infraccion_axis": "COD-1",
        "contravencion": "Contravencion de prueba",
        "tipo_acta": "Tipo A",
        "articulo_original": "Art 1",
        "monto_capital_original": Decimal("100.00"),
        "observacion": "Observación de prueba",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_estados_returns_distinct_values(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _row("TEST-001", datetime(2024, 3, 5), estado="A"),
            _row("TEST-002", datetime(2024, 3, 6), estado="B"),
            _row("TEST-003", datetime(2024, 3, 7), estado="A"),
        ],
    )

    response = await client.get("/api/reportes/impugnaciones/estados", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert "A" in body
    assert "B" in body


@pytest.mark.asyncio
async def test_estados_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/impugnaciones/estados")
    assert response.status_code == 401
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: FAIL — `404 Not Found` (`/api/reportes/impugnaciones/estados` doesn't exist yet), since `test_estados_returns_distinct_values` asserts `status_code == 200`.

- [ ] **Step 3: Create the Core Table definition**

Create `apps/api/app/axis_tables.py`:

```python
from sqlalchemy import BigInteger, Column, DateTime, MetaData, Numeric, Table, Text

axis_metadata = MetaData(schema="axis")

axis_impugnaciones = Table(
    "axis_impugnaciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("fecha_registro", DateTime),
    Column("fecha_acta", DateTime),
    Column("estado", Text),
    Column("codigo_infraccion_axis", Text),
    Column("contravencion", Text),
    Column("tipo_acta", Text),
    Column("articulo_original", Text),
    Column("monto_capital_original", Numeric(14, 2)),
    Column("observacion", Text),
)
```

This uses its own `MetaData` instance (not `app.database.Base.metadata`), so Alembic's `target_metadata = Base.metadata` (in `alembic/env.py`) never sees this table — `alembic revision --autogenerate` won't try to manage a table owned by the `axis-loja-migracion` skill.

- [ ] **Step 4: Create the router with the `/estados` endpoint**

Create `apps/api/app/routers/reportes.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/reportes", tags=["reportes"])


@router.get("/impugnaciones/estados", response_model=list[str])
async def list_estados(
    db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[str]:
    stmt = (
        select(axis_impugnaciones.c.estado)
        .where(axis_impugnaciones.c.estado.is_not(None))
        .distinct()
        .order_by(axis_impugnaciones.c.estado)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]
```

- [ ] **Step 5: Register the router in `main.py`**

Modify `apps/api/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.auth import router as auth_router
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/routers/reportes.py apps/api/app/main.py apps/api/tests/test_reportes_routes.py
git commit -m "feat(api): add reportes router with impugnaciones estados endpoint"
```

---

## Task 2: Backend — `/impugnaciones` list endpoint (validation, filters, pagination)

**Files:**
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/routers/reportes.py`
- Test: `apps/api/tests/test_reportes_routes.py`

**Interfaces:**
- Consumes: `axis_impugnaciones` Table from Task 1 (`app.axis_tables`).
- Produces: `ImpugnacionItem`, `ImpugnacionListResponse` (module `app.schemas`), consumed by Task 3's export endpoint and by the frontend's `ImpugnacionListResponse` model (Task 4). `GET /api/reportes/impugnaciones` query params: `fecha_desde: date`, `fecha_hasta: date` (both required), `estado: str | None`, `page: int = 1`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_reportes_routes.py`:

```python
from datetime import timedelta


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _row("TEST-101", datetime(2024, 6, 5), estado="A", observacion="Primera"),
            _row("TEST-102", datetime(2024, 6, 15), estado="A", observacion="Segunda"),
            _row("TEST-103", datetime(2024, 6, 25), estado="A", observacion="Tercera"),
        ],
    )

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-103", "TEST-102", "TEST-101"]
    first = body["items"][0]
    assert first["estado"] == "A"
    assert first["monto_capital_original"] == 100.0
    assert first["observacion"] == "Tercera"


@pytest.mark.asyncio
async def test_list_rejects_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-20", "fecha_hasta": "2024-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_filters_by_estado(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _row("TEST-201", datetime(2024, 6, 5), estado="A"),
            _row("TEST-202", datetime(2024, 6, 6), estado="B"),
        ],
    )

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30", "estado": "B"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-202"


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2024, 5, 1)
    rows = [
        _row(f"TEST-p-{i:03d}", base + timedelta(minutes=30 * i), estado="A")
        for i in range(55)
    ]
    await _seed_impugnaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-05-01", "fecha_hasta": "2024-05-31", "page": 2},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 55
    assert body["page"] == 2
    assert len(body["items"]) == 5
    assert body["items"][0]["registro"] == "TEST-p-004"
    assert body["items"][-1]["registro"] == "TEST-p-000"


@pytest.mark.asyncio
async def test_list_out_of_range_page_returns_empty(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(db_session, [_row("TEST-301", datetime(2024, 6, 5))])

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30", "page": 5},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 1


@pytest.mark.asyncio
async def test_list_without_token_returns_401(client, db_session):
    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30"},
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: FAIL — `404 Not Found` on all new tests (`GET /api/reportes/impugnaciones` doesn't exist yet).

- [ ] **Step 3: Add response schemas**

Modify `apps/api/app/schemas.py` — add `datetime` import and the two new models at the end of the file:

```python
from datetime import datetime

from pydantic import BaseModel, EmailStr
```

```python
class ImpugnacionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: datetime | None
    fecha_acta: datetime | None
    estado: str | None
    codigo_infraccion_axis: str | None
    contravencion: str | None
    tipo_acta: str | None
    articulo_original: str | None
    monto_capital_original: float | None
    observacion: str | None

    model_config = {"from_attributes": True}


class ImpugnacionListResponse(BaseModel):
    items: list[ImpugnacionItem]
    total: int
    page: int
    page_size: int
```

- [ ] **Step 4: Implement the list endpoint**

Modify `apps/api/app/routers/reportes.py` to the full version:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user
from app.schemas import ImpugnacionItem, ImpugnacionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_NAMES = [
    "registro",
    "fecha_registro",
    "fecha_acta",
    "estado",
    "codigo_infraccion_axis",
    "contravencion",
    "tipo_acta",
    "articulo_original",
    "monto_capital_original",
    "observacion",
]


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
    if (fecha_desde.year, fecha_desde.month) != (fecha_hasta.year, fecha_hasta.month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El rango de fechas debe estar dentro del mismo mes calendario",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date, estado: str | None):
    conditions = [cast(axis_impugnaciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta)]
    if estado is not None:
        conditions.append(axis_impugnaciones.c.estado == estado)
    return conditions


@router.get("/impugnaciones/estados", response_model=list[str])
async def list_estados(
    db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[str]:
    stmt = (
        select(axis_impugnaciones.c.estado)
        .where(axis_impugnaciones.c.estado.is_not(None))
        .distinct()
        .order_by(axis_impugnaciones.c.estado)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]


@router.get("/impugnaciones", response_model=ImpugnacionListResponse)
async def list_impugnaciones(
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ImpugnacionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_impugnaciones).where(and_(*conditions))
    )

    columns = [axis_impugnaciones.c.id] + [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ImpugnacionItem(**row) for row in rows]
    return ImpugnacionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/schemas.py apps/api/app/routers/reportes.py apps/api/tests/test_reportes_routes.py
git commit -m "feat(api): add paginated impugnaciones list endpoint with date/estado filters"
```

---

## Task 3: Backend — `/impugnaciones/export` endpoint (CSV + XLSX)

**Files:**
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/app/routers/reportes.py`
- Test: `apps/api/tests/test_reportes_routes.py`

**Interfaces:**
- Consumes: `_validate_date_range`, `_date_range_conditions`, `COLUMN_NAMES`, `axis_impugnaciones` from Task 2.
- Produces: `GET /api/reportes/impugnaciones/export` — query params `fecha_desde`, `fecha_hasta`, `estado`, `formato: "csv" | "xlsx"` (required). Returns a file download.

- [ ] **Step 1: Add the `openpyxl` dependency**

Modify `apps/api/pyproject.toml` — add to `dependencies`:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0",
    "greenlet>=3.0",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "bcrypt>=4.1",
    "pyjwt>=2.8",
    "email-validator>=2.1",
    "openpyxl>=3.1",
]
```

Run: `cd apps/api && .venv/bin/pip install -e ".[dev]"`
Expected: `openpyxl` installs successfully.

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/tests/test_reportes_routes.py`:

```python
import io

from openpyxl import load_workbook


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2024, 8, 1)
    rows = [
        _row(f"TEST-e-{i:03d}", base + timedelta(minutes=30 * i), estado="A")
        for i in range(55)
    ]
    await _seed_impugnaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2024-08-01", "fecha_hasta": "2024-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "impugnaciones_2024-08-01_2024-08-31.csv" in response.headers["content-disposition"]

    text = response.content.decode("utf-8-sig")
    lines = [line for line in text.splitlines() if line]
    assert lines[0].split(",")[0] == "Registro"
    assert len(lines) - 1 == 55


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2024, 9, 1)
    rows = [
        _row(f"TEST-x-{i:03d}", base + timedelta(minutes=30 * i), estado="A")
        for i in range(55)
    ]
    await _seed_impugnaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2024-09-01", "fecha_hasta": "2024-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "impugnaciones_2024-09-01_2024-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    assert sheet.cell(row=1, column=1).value == "Registro"
    assert sheet.max_row - 1 == 55


@pytest.mark.asyncio
async def test_export_without_token_returns_401(client, db_session):
    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30", "formato": "csv"},
    )
    assert response.status_code == 401
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: FAIL — `404 Not Found` (export endpoint doesn't exist yet).

- [ ] **Step 4: Implement the export endpoint**

Modify `apps/api/app/routers/reportes.py` — add imports and the new endpoint at the end of the file:

```python
import csv
import io
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import Response
from openpyxl import Workbook
```

```python
COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_acta": "Fecha de Acta",
    "estado": "Estado",
    "codigo_infraccion_axis": "Código de Infracción AXIS",
    "contravencion": "Contravención",
    "tipo_acta": "Tipo de Acta",
    "articulo_original": "Artículo Original",
    "monto_capital_original": "Monto Capital Original",
    "observacion": "Observación",
}


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/impugnaciones/export")
async def export_impugnaciones(
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    columns = [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"impugnaciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    if formato == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(list(COLUMN_HEADERS.values()))
        for row in rows:
            writer.writerow([_export_value(row[name]) for name in COLUMN_NAMES])
        content = "﻿" + buffer.getvalue()
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(list(COLUMN_HEADERS.values()))
    for row in rows:
        sheet.append([_export_value(row[name]) for name in COLUMN_NAMES])
    xlsx_buffer = io.BytesIO()
    workbook.save(xlsx_buffer)
    return Response(
        content=xlsx_buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_reportes_routes.py -v`
Expected: PASS (12 tests)

- [ ] **Step 6: Run the full backend test suite**

Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests, including `test_auth_routes.py` and `test_auth_utils.py`, unaffected)

- [ ] **Step 7: Commit**

```bash
git add apps/api/pyproject.toml apps/api/app/routers/reportes.py apps/api/tests/test_reportes_routes.py
git commit -m "feat(api): add CSV/XLSX export endpoint for impugnaciones report"
```

---

## Task 4: Frontend — `ImpugnacionesService`

**Files:**
- Create: `apps/web/src/app/core/models/impugnacion.model.ts`
- Create: `apps/web/src/app/core/impugnaciones.service.ts`
- Test: `apps/web/src/app/core/impugnaciones.service.spec.ts`

**Interfaces:**
- Produces: `ImpugnacionItem`, `ImpugnacionListResponse`, `ImpugnacionFilters` (module `core/models/impugnacion.model`); `ImpugnacionesService` with `getEstados(): Observable<string[]>`, `listImpugnaciones(filters: ImpugnacionFilters, page: number): Observable<ImpugnacionListResponse>`, `exportImpugnaciones(filters: ImpugnacionFilters, formato: 'csv' | 'xlsx'): Observable<Blob>` — consumed by `ImpugnacionesComponent` (Tasks 6-7).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/models/impugnacion.model.ts`:

```typescript
export interface ImpugnacionItem {
  id: number;
  registro: string | null;
  fecha_registro: string | null;
  fecha_acta: string | null;
  estado: string | null;
  codigo_infraccion_axis: string | null;
  contravencion: string | null;
  tipo_acta: string | null;
  articulo_original: string | null;
  monto_capital_original: number | null;
  observacion: string | null;
}

export interface ImpugnacionListResponse {
  items: ImpugnacionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ImpugnacionFilters {
  fecha_desde: string;
  fecha_hasta: string;
  estado: string | null;
}
```

Create `apps/web/src/app/core/impugnaciones.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ImpugnacionesService } from './impugnaciones.service';
import { ImpugnacionListResponse } from './models/impugnacion.model';
import { environment } from '../../environments/environment';

describe('ImpugnacionesService', () => {
  let service: ImpugnacionesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ImpugnacionesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ImpugnacionesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getEstados fetches the list of distinct estados', () => {
    let result: string[] | undefined;
    service.getEstados().subscribe((estados) => (result = estados));

    const req = httpMock.expectOne(`${environment.apiUrl}/reportes/impugnaciones/estados`);
    expect(req.request.method).toBe('GET');
    req.flush(['A', 'B']);

    expect(result).toEqual(['A', 'B']);
  });

  it('listImpugnaciones sends fecha_desde, fecha_hasta, page and omits estado when not set', () => {
    const response: ImpugnacionListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service
      .listImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 1)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/impugnaciones`);
    expect(req.request.params.get('fecha_desde')).toBe('2024-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2024-06-30');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('estado')).toBe(false);
    req.flush(response);
  });

  it('listImpugnaciones includes estado when set', () => {
    service
      .listImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: 'A' }, 2)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/impugnaciones`);
    expect(req.request.params.get('estado')).toBe('A');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('exportImpugnaciones requests a blob with the formato param', () => {
    let result: Blob | undefined;
    service
      .exportImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 'xlsx')
      .subscribe((blob) => (result = blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/impugnaciones/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['data']);
    req.flush(blob);

    expect(result).toBe(blob);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.service.spec.ts'`
Expected: FAIL — cannot find module `./impugnaciones.service` (doesn't exist yet).

- [ ] **Step 3: Implement the service**

Create `apps/web/src/app/core/impugnaciones.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ImpugnacionFilters, ImpugnacionListResponse } from './models/impugnacion.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: ImpugnacionFilters): HttpParams {
  let params = new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
  if (filters.estado) {
    params = params.set('estado', filters.estado);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ImpugnacionesService {
  private readonly http = inject(HttpClient);

  getEstados(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/reportes/impugnaciones/estados`);
  }

  listImpugnaciones(filters: ImpugnacionFilters, page: number): Observable<ImpugnacionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<ImpugnacionListResponse>(`${environment.apiUrl}/reportes/impugnaciones`, {
      params,
    });
  }

  exportImpugnaciones(filters: ImpugnacionFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/impugnaciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.service.spec.ts'`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/models/impugnacion.model.ts apps/web/src/app/core/impugnaciones.service.ts apps/web/src/app/core/impugnaciones.service.spec.ts
git commit -m "feat(web): add ImpugnacionesService for the impugnaciones report"
```

---

## Task 5: Frontend — expandable "Reportes" submenu in `AppShellComponent`

**Files:**
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`
- Test: `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`

**Interfaces:**
- Produces: `AppShellRoute = 'dashboard' | 'impugnaciones' | 'usuarios'` (replaces `'reportes'`) — consumed by `ImpugnacionesComponent` (Task 6), which will pass `activeRoute="impugnaciones"`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { AppShellComponent, AppShellRoute } from './app-shell.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

const ADMIN_USER: User = { id: 1, email: 'admin@icmloja.gob.ec', full_name: 'Admin User', is_admin: true };
const NON_ADMIN_USER: User = { id: 2, email: 'user@icmloja.gob.ec', full_name: 'Regular User', is_admin: false };

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let authService: {
    logout: ReturnType<typeof vi.fn>;
    loadCurrentUser: ReturnType<typeof vi.fn>;
    currentUser$: Observable<User | null>;
  };
  let router: Router;

  function createComponent(activeRoute: AppShellRoute = 'dashboard'): void {
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.componentInstance.activeRoute = activeRoute;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    authService = {
      logout: vi.fn(),
      loadCurrentUser: vi.fn().mockReturnValue(of(null)),
      currentUser$: of(ADMIN_USER),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    createComponent();
  });

  it('highlights the Dashboard link when activeRoute is dashboard', () => {
    const dashboardLink: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href="/home"]');
    expect(dashboardLink.classList.contains('text-secondary-fixed-dim')).toBe(true);
  });

  it('logs out and navigates to /login when the logout link is clicked', () => {
    const button: HTMLElement = fixture.nativeElement.querySelector('[data-testid="logout-btn"]');
    button.click();

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('validates the session on init by calling loadCurrentUser', () => {
    expect(authService.loadCurrentUser).toHaveBeenCalled();
  });

  it('shows the Administración de Usuarios link when the current user is an admin', () => {
    authService.currentUser$ = of(ADMIN_USER);
    createComponent();

    const usuariosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/usuarios"]');
    expect(usuariosLink).not.toBeNull();
  });

  it('hides the Administración de Usuarios link when the current user is not an admin', () => {
    authService.currentUser$ = of(NON_ADMIN_USER);
    createComponent();

    const usuariosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/usuarios"]');
    expect(usuariosLink).toBeNull();
  });

  describe('submenu de Reportes', () => {
    it('collapses the Reportes submenu by default when activeRoute is dashboard', () => {
      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).toBeNull();
    });

    it('expands the Reportes submenu when the toggle is clicked', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="reportes-toggle"]');
      toggle.click();
      fixture.detectChanges();

      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).not.toBeNull();
    });

    it('auto-expands and highlights Impugnaciones when activeRoute is impugnaciones', () => {
      createComponent('impugnaciones');

      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).not.toBeNull();
      expect(impugnacionesLink!.classList.contains('text-secondary-fixed-dim')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --include='**/app-shell.component.spec.ts'`
Expected: FAIL — `data-testid="reportes-toggle"` and `/reportes/impugnaciones` link don't exist yet; `AppShellRoute` doesn't accept `'impugnaciones'`.

- [ ] **Step 3: Update the component class**

Modify `apps/web/src/app/shared/app-shell/app-shell.component.ts`:

```typescript
import { Component, inject, Input, OnInit } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'usuarios';

const ACTIVE_LINK_CLASS =
  'flex items-center gap-sm px-md py-sm text-secondary-fixed-dim border-l-4 border-secondary-fixed font-bold transition-colors duration-200';
const INACTIVE_LINK_CLASS =
  'flex items-center gap-sm px-md py-sm text-on-primary/70 hover:text-on-primary hover:bg-primary-container transition-colors duration-200';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, AsyncPipe],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent implements OnInit {
  @Input({ required: true }) activeRoute!: AppShellRoute;

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly currentUser$ = this.authService.currentUser$;

  reportesExpanded = false;

  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
    if (this.activeRoute === 'impugnaciones') {
      this.reportesExpanded = true;
    }
  }

  toggleReportes(): void {
    this.reportesExpanded = !this.reportesExpanded;
  }

  navLinkClass(route: AppShellRoute): string {
    return route === this.activeRoute ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS;
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
```

- [ ] **Step 4: Update the template**

Modify `apps/web/src/app/shared/app-shell/app-shell.component.html` — replace the Reportes `<li>` (lines 20-25 of the current file):

```html
<li>
  <button
    type="button"
    data-testid="reportes-toggle"
    (click)="toggleReportes()"
    class="w-full flex items-center justify-between gap-sm px-md py-sm text-on-primary/70 hover:text-on-primary hover:bg-primary-container transition-colors duration-200"
  >
    <span class="flex items-center gap-sm">
      <span class="material-symbols-outlined text-[20px]">assessment</span>
      <span class="font-body-sm text-body-sm">Reportes</span>
    </span>
    <span class="material-symbols-outlined text-[18px]">{{ reportesExpanded ? 'expand_less' : 'expand_more' }}</span>
  </button>
  @if (reportesExpanded) {
    <ul class="flex flex-col gap-xs">
      <li class="pl-xl">
        <a routerLink="/reportes/impugnaciones" [class]="navLinkClass('impugnaciones')">
          <span class="font-body-sm text-body-sm">Impugnaciones</span>
        </a>
      </li>
    </ul>
  }
</li>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --include='**/app-shell.component.spec.ts'`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html apps/web/src/app/shared/app-shell/app-shell.component.spec.ts
git commit -m "feat(web): turn Reportes sidebar item into an expandable submenu"
```

---

## Task 6: Frontend — `ImpugnacionesComponent` (filters, validation, table, pagination, states)

**Files:**
- Create: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`
- Create: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`
- Test: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`

**Interfaces:**
- Consumes: `ImpugnacionesService` (Task 4), `AppShellComponent` with `activeRoute="impugnaciones"` (Task 5).
- Produces: `ImpugnacionesComponent` with public method `cambiarPagina(page: number): void` and template `data-testid`s `pagina-anterior` / `pagina-siguiente` — consumed by Task 7 (download buttons added to the same class/template).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ImpugnacionesComponent } from './impugnaciones.component';
import { AuthService } from '../../../core/auth.service';
import { ImpugnacionesService } from '../../../core/impugnaciones.service';
import { ImpugnacionListResponse } from '../../../core/models/impugnacion.model';

describe('ImpugnacionesComponent', () => {
  let fixture: ComponentFixture<ImpugnacionesComponent>;
  let impugnacionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listImpugnaciones: ReturnType<typeof vi.fn>;
  };

  const resultado: ImpugnacionListResponse = {
    items: [
      {
        id: 1,
        registro: 'REG-1',
        fecha_registro: '2024-06-10T00:00:00',
        fecha_acta: '2024-06-09T00:00:00',
        estado: 'A',
        codigo_infraccion_axis: 'COD-1',
        contravencion: 'Contravencion 1',
        tipo_acta: 'Tipo 1',
        articulo_original: 'Art 1',
        monto_capital_original: 100,
        observacion: 'Obs 1',
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  };

  function fillForm(fechaDesde: string, fechaHasta: string): void {
    const desdeInput: HTMLInputElement = fixture.nativeElement.querySelector('#fecha-desde');
    const hastaInput: HTMLInputElement = fixture.nativeElement.querySelector('#fecha-hasta');
    desdeInput.value = fechaDesde;
    desdeInput.dispatchEvent(new Event('input'));
    desdeInput.dispatchEvent(new Event('change'));
    hastaInput.value = fechaHasta;
    hastaInput.dispatchEvent(new Event('input'));
    hastaInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function submitForm(): void {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    impugnacionesService = {
      getEstados: vi.fn().mockReturnValue(of(['A', 'B'])),
      listImpugnaciones: vi.fn().mockReturnValue(of(resultado)),
    };

    await TestBed.configureTestingModule({
      imports: [ImpugnacionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: ImpugnacionesService, useValue: impugnacionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpugnacionesComponent);
    fixture.detectChanges();
  });

  it('blocks submit when the date range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('El rango de fechas debe estar dentro del mismo mes calendario.');
    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });

  it('blocks submit when fecha desde is after fecha hasta in the same month', () => {
    fillForm('2024-03-20', '2024-03-10');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('La fecha desde no puede ser posterior a la fecha hasta.');
  });

  it('allows submit and requests page 1 when the range is within the same month', () => {
    fillForm('2024-06-01', '2024-06-30');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(impugnacionesService.listImpugnaciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      1
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('Cargando...');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);

      resultado$.next(resultado);
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Cargando...');
      expect(text).toContain('REG-1');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay impugnaciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las impugnaciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    impugnacionesService.listImpugnaciones.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2024-06-01', '2024-06-30');
    submitForm();

    const anteriorButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-anterior"]'
    );
    expect(anteriorButton.disabled).toBe(true);

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(impugnacionesService.listImpugnaciones).toHaveBeenLastCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      2
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.component.spec.ts'`
Expected: FAIL — cannot find module `./impugnaciones.component` (doesn't exist yet).

- [ ] **Step 3: Delete the placeholder `ReportesComponent`**

```bash
rm apps/web/src/app/features/reportes/reportes.component.ts apps/web/src/app/features/reportes/reportes.component.html apps/web/src/app/features/reportes/reportes.component.spec.ts
```

- [ ] **Step 4: Implement the component class**

Create `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { ImpugnacionesService } from '../../../core/impugnaciones.service';
import { ImpugnacionFilters, ImpugnacionListResponse } from '../../../core/models/impugnacion.model';

const RANGE_ERROR_MESSAGE = 'El rango de fechas debe estar dentro del mismo mes calendario.';
const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar las impugnaciones. Intenta de nuevo.';

@Component({
  selector: 'app-impugnaciones',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './impugnaciones.component.html',
})
export class ImpugnacionesComponent implements OnInit {
  private readonly impugnacionesService = inject(ImpugnacionesService);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
    estado: [''],
  });

  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();

  private readonly resultadoSubject = new BehaviorSubject<ImpugnacionListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: ImpugnacionFilters | null = null;

  ngOnInit(): void {
    this.impugnacionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
  }

  onFechaChange(): void {
    const { fechaDesde, fechaHasta } = this.form.getRawValue();
    if (fechaDesde && fechaHasta) {
      this.rangoValido(fechaDesde, fechaHasta);
    } else {
      this.rangeErrorSubject.next(null);
    }
  }

  private rangoValido(fechaDesde: string, fechaHasta: string): boolean {
    const desde = new Date(fechaDesde);
    const hasta = new Date(fechaHasta);
    if (desde.getTime() > hasta.getTime()) {
      this.rangeErrorSubject.next(ORDER_ERROR_MESSAGE);
      return false;
    }
    if (desde.getUTCFullYear() !== hasta.getUTCFullYear() || desde.getUTCMonth() !== hasta.getUTCMonth()) {
      this.rangeErrorSubject.next(RANGE_ERROR_MESSAGE);
      return false;
    }
    this.rangeErrorSubject.next(null);
    return true;
  }

  buscar(): void {
    if (this.form.invalid) {
      return;
    }
    const { fechaDesde, fechaHasta, estado } = this.form.getRawValue();
    if (!this.rangoValido(fechaDesde, fechaHasta)) {
      return;
    }
    this.filtrosVigentes = { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, estado: estado || null };
    this.cargarPagina(1);
  }

  cambiarPagina(page: number): void {
    this.cargarPagina(page);
  }

  private cargarPagina(page: number): void {
    if (!this.filtrosVigentes) {
      return;
    }
    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.impugnacionesService.listImpugnaciones(this.filtrosVigentes, page).subscribe({
      next: (resultado) => {
        this.resultadoSubject.next(resultado);
        this.loadingSubject.next(false);
      },
      error: () => {
        this.errorSubject.next(LOAD_ERROR_MESSAGE);
        this.loadingSubject.next(false);
      },
    });
  }
}
```

- [ ] **Step 5: Implement the template**

Create `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`:

```html
<app-shell activeRoute="impugnaciones">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Impugnaciones</h2>
  </div>

  <form [formGroup]="form" (ngSubmit)="buscar()" class="bg-surface-container-lowest border border-outline-variant rounded-lg p-md mb-lg flex flex-wrap items-end gap-md">
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="fecha-desde">Fecha desde</label>
      <input id="fecha-desde" type="date" formControlName="fechaDesde" (change)="onFechaChange()" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
    </div>
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="fecha-hasta">Fecha hasta</label>
      <input id="fecha-hasta" type="date" formControlName="fechaHasta" (change)="onFechaChange()" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
    </div>
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="estado">Estado</label>
      <select id="estado" formControlName="estado" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm">
        <option value="">Todos</option>
        @for (estado of (estados$ | async); track estado) {
          <option [value]="estado">{{ estado }}</option>
        }
      </select>
    </div>
    <button type="submit" [disabled]="form.invalid || !!(rangeError$ | async)" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
      Filtrar
    </button>
  </form>

  @if (rangeError$ | async; as rangeError) {
    <p class="text-error text-body-sm mb-md">{{ rangeError }}</p>
  }
  @if (error$ | async; as error) {
    <p class="text-error text-body-sm mb-md">{{ error }}</p>
  }

  @if (loading$ | async) {
    <p class="text-on-surface-variant text-body-sm">Cargando...</p>
  } @else if (resultado$ | async; as resultado) {
    <div class="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
      @if (resultado.total === 0) {
        <p class="p-md text-on-surface-variant text-body-sm">No hay impugnaciones para estos filtros</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Registro</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Registro</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Acta</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Estado</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código de Infracción AXIS</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Contravención</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Tipo de Acta</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Artículo Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Monto Capital Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Observación</th>
              </tr>
            </thead>
            <tbody class="font-body-sm text-body-sm divide-y divide-outline-variant/50">
              @for (item of resultado.items; track item.id) {
                <tr class="hover:bg-surface-container-lowest/50 transition-colors">
                  <td class="py-3 px-md text-on-surface">{{ item.registro }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_registro }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_acta }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.estado }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_infraccion_axis }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.contravencion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.tipo_acta }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.articulo_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.monto_capital_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.observacion }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="p-md border-t border-outline-variant flex items-center justify-between bg-surface-bright">
          <span class="font-body-sm text-body-sm text-on-surface-variant">Página {{ resultado.page }} — {{ resultado.total }} resultados</span>
          <div class="flex gap-sm">
            <button type="button" data-testid="pagina-anterior" [disabled]="resultado.page <= 1" (click)="cambiarPagina(resultado.page - 1)" class="px-3 py-1 border border-outline-variant rounded-DEFAULT font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed">Anterior</button>
            <button type="button" data-testid="pagina-siguiente" [disabled]="resultado.page * resultado.page_size >= resultado.total" (click)="cambiarPagina(resultado.page + 1)" class="px-3 py-1 border border-outline-variant rounded-DEFAULT font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed">Siguiente</button>
          </div>
        </div>
      }
    </div>
  }
</app-shell>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.component.spec.ts'`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/reportes/impugnaciones apps/web/src/app/features/reportes/reportes.component.ts apps/web/src/app/features/reportes/reportes.component.html apps/web/src/app/features/reportes/reportes.component.spec.ts
git commit -m "feat(web): add ImpugnacionesComponent with filters, validation, table and pagination"
```

Note: `git add` on the deleted `reportes.component.*` paths stages the deletion; git records it correctly alongside the new `impugnaciones/` folder.

---

## Task 7: Frontend — CSV/Excel download buttons

**Files:**
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`
- Test: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`

**Interfaces:**
- Consumes: `ImpugnacionesService.exportImpugnaciones` (Task 4), `filtrosVigentes` and `resultado$` from Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`, updating the `impugnacionesService` mock type and adding a `descargas` describe block:

Update the `impugnacionesService` declaration and initialization near the top of the file:

```typescript
  let impugnacionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listImpugnaciones: ReturnType<typeof vi.fn>;
    exportImpugnaciones: ReturnType<typeof vi.fn>;
  };
```

```typescript
    impugnacionesService = {
      getEstados: vi.fn().mockReturnValue(of(['A', 'B'])),
      listImpugnaciones: vi.fn().mockReturnValue(of(resultado)),
      exportImpugnaciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

Add at the end of the `describe('ImpugnacionesComponent', ...)` block, before the closing `});`:

```typescript
  describe('descargas', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('descarga CSV con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      csvButton.click();

      expect(impugnacionesService.exportImpugnaciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'csv'
      );
    });

    it('descarga Excel con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      excelButton.click();

      expect(impugnacionesService.exportImpugnaciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'xlsx'
      );
    });

    it('disables the download buttons when there are no results', () => {
      impugnacionesService.listImpugnaciones.mockReturnValue(
        of({ items: [], total: 0, page: 1, page_size: 50 })
      );

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      expect(csvButton.disabled).toBe(true);
      expect(excelButton.disabled).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.component.spec.ts'`
Expected: FAIL — `data-testid="descargar-csv"` / `descargar-excel` don't exist yet (`querySelector` returns `null`, `.click()` throws).

- [ ] **Step 3: Add the download methods**

Modify `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts` — add at the end of the class, after `cambiarPagina`:

```typescript
  descargar(formato: 'csv' | 'xlsx'): void {
    if (!this.filtrosVigentes) {
      return;
    }
    const filtros = this.filtrosVigentes;
    this.impugnacionesService.exportImpugnaciones(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: ImpugnacionFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `impugnaciones_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
```

- [ ] **Step 4: Add the download buttons to the template**

Modify `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html` — insert right after the opening `<div class="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.02)]">` (before the `@if (resultado.total === 0)` block):

```html
      <div class="p-md border-b border-outline-variant flex justify-end gap-sm bg-surface-bright">
        <button type="button" data-testid="descargar-csv" [disabled]="resultado.total === 0" (click)="descargar('csv')" class="text-primary hover:underline font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">Descargar CSV</button>
        <button type="button" data-testid="descargar-excel" [disabled]="resultado.total === 0" (click)="descargar('xlsx')" class="text-primary hover:underline font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">Descargar Excel</button>
      </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --include='**/impugnaciones.component.spec.ts'`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts
git commit -m "feat(web): add CSV/Excel download buttons to impugnaciones report"
```

---

## Task 8: Frontend — wire the `/reportes/impugnaciones` route

**Files:**
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ImpugnacionesComponent` (Task 6).

- [ ] **Step 1: Update the routes**

Modify `apps/web/src/app/app.routes.ts`:

```typescript
import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './features/login/login.component';
import { HomeComponent } from './features/home/home.component';
import { ImpugnacionesComponent } from './features/reportes/impugnaciones/impugnaciones.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'reportes/impugnaciones', component: ImpugnacionesComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];
```

- [ ] **Step 2: Confirm no dangling references to the deleted `ReportesComponent`**

Run: `cd /Users/juanpablotorres/Documents/matriculacion && grep -rl "ReportesComponent" apps/web/src --include="*.ts"`
Expected: no output (only `app.routes.ts` referenced it, and that reference is now replaced).

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd apps/web && npm test`
Expected: PASS (all specs, including `app-shell`, `impugnaciones.service`, `impugnaciones.component`, `administracion-usuarios`, `login`, `auth.interceptor`)

- [ ] **Step 4: Run the full backend test suite**

Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests)

- [ ] **Step 5: Manual smoke check**

Start both servers and verify in the browser:
- `cd apps/api && .venv/bin/uvicorn app.main:app --reload` and `cd apps/web && npm start`.
- Log in, click "Reportes" in the sidebar → it expands to show "Impugnaciones" (no navigation yet).
- Click "Impugnaciones" → navigates to `/reportes/impugnaciones`, sidebar auto-expanded and highlighted.
- Filter a real month (data is known to exist around `2026-07`, e.g. try a few months from the current migrated data) with a valid same-month range → table renders, pagination controls work.
- Try a cross-month range → client blocks the submit with the inline message, no request sent (check Network tab).
- Click "Descargar CSV" and "Descargar Excel" → files download with the correct filenames and open correctly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/app.routes.ts
git commit -m "feat(web): route /reportes/impugnaciones to ImpugnacionesComponent"
```

---

## Spec coverage check

- Paginated list endpoint with required date filter + optional estado → Task 2.
- CSV/Excel export, unpaginated → Task 3.
- `/estados` auxiliary endpoint → Task 1.
- `Impugnaciones` page under a "Reportes" submenu → Tasks 5, 6, 8.
- Same-calendar-month validation, client + server → Task 2 (server), Task 6 (client).
- 10-column table with exact Spanish headers, identical on screen and in exports → Task 2/3 (backend), Task 6 (frontend).
- Loading / empty / error states, disabled download buttons → Task 6, Task 7.
- Stable pagination ordering, out-of-range page → Task 2.
- Zoneless `BehaviorSubject` + `AsyncPipe` pattern everywhere data is loaded → Tasks 4, 6, 7 (service returns observables; component never assigns a plain field from a `.subscribe()` callback).
- `openpyxl` dependency → Task 3.
- All backend + frontend tests listed in the spec's Testing section → Tasks 1-7 (see inline mapping in each task's tests).
