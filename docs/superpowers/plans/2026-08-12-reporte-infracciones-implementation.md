# Reporte de Infracciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second report, "Infracciones", under the existing "Reportes" sidebar submenu — same filter/paginate/download mechanics as the existing Impugnaciones report, over `axis.axis_infracciones` (314,460 rows, 41 curated columns).

**Architecture:** A new isolated backend router (`routers/infracciones.py`, separate from `routers/reportes.py`) exposes `estados`/list/export endpoints over a new `axis_infracciones` SQLAlchemy `Table`, following the exact `COLUMN_HEADERS`/`COLUMN_NAMES` + `registrar_evento` pattern already used for Impugnaciones. The frontend gets a new `InfraccionesComponent` that renders its (much wider, 41-column) table dynamically from a `COLUMNAS` array instead of hand-writing every `<th>`/`<td>`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async, asyncpg) + pytest/pytest-asyncio/httpx (backend); Angular 22 standalone + zoneless change detection + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-12-reporte-infracciones-design.md`

## Global Constraints

- Backend tests run against a real Postgres database via the `client`/`db_session` fixtures in `apps/api/tests/conftest.py` — no DB mocking. Run with `cd apps/api && .venv/bin/pytest <path> -v`.
- Each backend test file defines its **own local** helper functions (no cross-test-file imports) — established convention already used by `test_auth_routes.py`, `test_reportes_routes.py`, and `test_audit_routes.py`.
- `COLUMN_NAMES` must always be derived as `list(COLUMN_HEADERS)`, **never declared as an independent literal** — this is a hard lesson from a real bug fixed in this codebase (the two lists silently desynced when one was reordered but not the other).
- Test data prefixes, to avoid colliding with real migrated data or other tests' fixtures in the shared dev database: `TEST-INF-` for `test_infracciones_routes.py`, `TEST-AUD-INF-` for the infracciones-related rows added to `test_audit_routes.py`. (Already in use: `TEST-` for impugnaciones business tests, `TEST-AUD-` for impugnaciones audit tests.)
- All Angular data loading uses `BehaviorSubject` + `AsyncPipe` (never a bare field mutated inside `.subscribe()`) — this app runs zoneless change detection. Frontend tests that check data arriving after the initial render use a `Subject` + `await fixture.whenStable()`, never a synchronous mock plus a second manual `detectChanges()` call.
- Run frontend tests with `cd apps/web && npx ng test --watch=false --include="<path>"` (focused) or `cd apps/web && npx ng test --watch=false` (full suite). Do **not** run a bare `npx vitest run` — it skips Angular's TestBed setup and fails with `ReferenceError: describe is not defined`. Do not create any `vitest.config.ts`/test-setup files — none are needed.
- **Never run `git commit`, `git push`, or `git merge`.** At the end of every task, leave the changed files as-is (staged or not) and report which files changed plus a suggested commit message — the user commits everything themselves. This applies to every task below, whether run by a human, by the controlling session, or by a dispatched subagent.
- Router URL prefix `/api/reportes` is shared between `routers/reportes.py` (impugnaciones) and the new `routers/infracciones.py` — this is fine, they're two separate `APIRouter` instances registered independently in `main.py`; FastAPI just concatenates each router's own route paths under the shared prefix, and `impugnaciones`/`infracciones` never collide as path segments.

---

## Backend

### Task 1: `axis_infracciones` table, schemas, and `GET /estados` endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py`
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/app/main.py`
- Create: `apps/api/tests/test_infracciones_routes.py`

**Interfaces:**
- Consumes: `app.database.get_db`, `app.routers.auth.get_current_user`.
- Produces: `app.axis_tables.axis_infracciones` (SQLAlchemy `Table`), `app.schemas.InfraccionItem`/`InfraccionListResponse`, `app.routers.infracciones.router` with `COLUMN_HEADERS: dict[str, str]` and `COLUMN_NAMES: list[str]` (41 entries) — consumed by Tasks 2 and 3, which append to this same router file.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_infracciones_routes.py`:

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
    INSERT INTO axis.axis_infracciones
        (registro, fecha_registro, fecha_emision, fecha_aprobacion, fecha_vencimiento, estado,
         codigo_infraccion, codigo_infraccion_ant, contravencion, articulo, literal,
         descripcion_articulo, periodo_fiscal, oficina, origen_registro, tipo_registro_infraccion,
         tipo_emision, tipo_deudor, codigo_usuario_registra, observacion, provincia, localidad,
         lugar_infraccion, canal, placa, tipo_identificacion_infractor,
         numero_identificacion_infractor, nombre_infractor, tipo_identificacion_propietario,
         numero_identificacion_propietario, nombre_propietario, indicador_bloqueada,
         indicador_acta_juzgamiento, indicador_modificada, indicador_calcula_recargo,
         valor_capital, valor_capital_exonerado, valor_recargo, valor_recargo_exonerado,
         valor_intereses, valor_total)
    VALUES
        (:registro, :fecha_registro, :fecha_emision, :fecha_aprobacion, :fecha_vencimiento, :estado,
         :codigo_infraccion, :codigo_infraccion_ant, :contravencion, :articulo, :literal,
         :descripcion_articulo, :periodo_fiscal, :oficina, :origen_registro, :tipo_registro_infraccion,
         :tipo_emision, :tipo_deudor, :codigo_usuario_registra, :observacion, :provincia, :localidad,
         :lugar_infraccion, :canal, :placa, :tipo_identificacion_infractor,
         :numero_identificacion_infractor, :nombre_infractor, :tipo_identificacion_propietario,
         :numero_identificacion_propietario, :nombre_propietario, :indicador_bloqueada,
         :indicador_acta_juzgamiento, :indicador_modificada, :indicador_calcula_recargo,
         :valor_capital, :valor_capital_exonerado, :valor_recargo, :valor_recargo_exonerado,
         :valor_intereses, :valor_total)
    RETURNING id
    """
)


def _row(registro, fecha_registro, estado="EMITIDA", **overrides):
    base = {
        "registro": registro,
        "fecha_registro": fecha_registro,
        "fecha_emision": fecha_registro,
        "fecha_aprobacion": fecha_registro,
        "fecha_vencimiento": fecha_registro,
        "estado": estado,
        "codigo_infraccion": f"COD-{registro}",
        "codigo_infraccion_ant": f"ANT-{registro}",
        "contravencion": f"CONTRA-{registro}",
        "articulo": "139",
        "literal": "1",
        "descripcion_articulo": "Descripción de prueba",
        "periodo_fiscal": "ACTUAL",
        "oficina": "GAD LOJA",
        "origen_registro": "AXIS",
        "tipo_registro_infraccion": "PARTE",
        "tipo_emision": "ACT",
        "tipo_deudor": "CONDUCTOR",
        "codigo_usuario_registra": "USR001",
        "observacion": "Observación de prueba",
        "provincia": "LOJ",
        "localidad": "LOJ",
        "lugar_infraccion": "Av. de prueba",
        "canal": "APP",
        "placa": "ABC1234",
        "tipo_identificacion_infractor": "CED",
        "numero_identificacion_infractor": "1103456789",
        "nombre_infractor": "Infractor de Prueba",
        "tipo_identificacion_propietario": "CED",
        "numero_identificacion_propietario": "1103456789",
        "nombre_propietario": "Propietario de Prueba",
        "indicador_bloqueada": "N",
        "indicador_acta_juzgamiento": "N",
        "indicador_modificada": "N",
        "indicador_calcula_recargo": "S",
        "valor_capital": Decimal("50.00"),
        "valor_capital_exonerado": Decimal("0.00"),
        "valor_recargo": Decimal("5.00"),
        "valor_recargo_exonerado": Decimal("0.00"),
        "valor_intereses": Decimal("1.00"),
        "valor_total": Decimal("56.00"),
    }
    base.update(overrides)
    return base


async def _seed_infracciones(db_session, rows):
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_infracciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_infracciones WHERE registro LIKE 'TEST-INF-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_estados_returns_distinct_values(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session,
        [
            _row("TEST-INF-001", datetime(2024, 3, 5), estado="EMITIDA"),
            _row("TEST-INF-002", datetime(2024, 3, 6), estado="PAGADA"),
            _row("TEST-INF-003", datetime(2024, 3, 7), estado="EMITIDA"),
        ],
    )

    response = await client.get("/api/reportes/infracciones/estados", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert "EMITIDA" in body
    assert "PAGADA" in body


@pytest.mark.asyncio
async def test_estados_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/infracciones/estados")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.routers.infracciones'` (or a `404` once the file exists but the route isn't registered — verify the failure is because the endpoint doesn't exist yet, not a fixture/import error).

- [ ] **Step 3: Add the `axis_infracciones` table**

In `apps/api/app/axis_tables.py`, add after the existing `axis_impugnaciones` definition:

```python
axis_infracciones = Table(
    "axis_infracciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("fecha_registro", DateTime),
    Column("fecha_emision", DateTime),
    Column("fecha_aprobacion", DateTime),
    Column("fecha_vencimiento", DateTime),
    Column("estado", Text),
    Column("codigo_infraccion", Text),
    Column("codigo_infraccion_ant", Text),
    Column("contravencion", Text),
    Column("articulo", Text),
    Column("literal", Text),
    Column("descripcion_articulo", Text),
    Column("periodo_fiscal", Text),
    Column("oficina", Text),
    Column("origen_registro", Text),
    Column("tipo_registro_infraccion", Text),
    Column("tipo_emision", Text),
    Column("tipo_deudor", Text),
    Column("codigo_usuario_registra", Text),
    Column("observacion", Text),
    Column("provincia", Text),
    Column("localidad", Text),
    Column("lugar_infraccion", Text),
    Column("canal", Text),
    Column("placa", Text),
    Column("tipo_identificacion_infractor", Text),
    Column("numero_identificacion_infractor", Text),
    Column("nombre_infractor", Text),
    Column("tipo_identificacion_propietario", Text),
    Column("numero_identificacion_propietario", Text),
    Column("nombre_propietario", Text),
    Column("indicador_bloqueada", Text),
    Column("indicador_acta_juzgamiento", Text),
    Column("indicador_modificada", Text),
    Column("indicador_calcula_recargo", Text),
    Column("valor_capital", Numeric(14, 2)),
    Column("valor_capital_exonerado", Numeric(14, 2)),
    Column("valor_recargo", Numeric(14, 2)),
    Column("valor_recargo_exonerado", Numeric(14, 2)),
    Column("valor_intereses", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
)
```

(The existing `from sqlalchemy import BigInteger, Column, DateTime, MetaData, Numeric, Table, Text` import line already covers every type used here — no new imports needed.)

- [ ] **Step 4: Add the schemas**

In `apps/api/app/schemas.py`, add at the end of the file:

```python
class InfraccionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: datetime | None
    fecha_emision: datetime | None
    fecha_aprobacion: datetime | None
    fecha_vencimiento: datetime | None
    estado: str | None
    codigo_infraccion: str | None
    codigo_infraccion_ant: str | None
    contravencion: str | None
    articulo: str | None
    literal: str | None
    descripcion_articulo: str | None
    periodo_fiscal: str | None
    oficina: str | None
    origen_registro: str | None
    tipo_registro_infraccion: str | None
    tipo_emision: str | None
    tipo_deudor: str | None
    codigo_usuario_registra: str | None
    observacion: str | None
    provincia: str | None
    localidad: str | None
    lugar_infraccion: str | None
    canal: str | None
    placa: str | None
    tipo_identificacion_infractor: str | None
    numero_identificacion_infractor: str | None
    nombre_infractor: str | None
    tipo_identificacion_propietario: str | None
    numero_identificacion_propietario: str | None
    nombre_propietario: str | None
    indicador_bloqueada: str | None
    indicador_acta_juzgamiento: str | None
    indicador_modificada: str | None
    indicador_calcula_recargo: str | None
    valor_capital: float | None
    valor_capital_exonerado: float | None
    valor_recargo: float | None
    valor_recargo_exonerado: float | None
    valor_intereses: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
    items: list[InfraccionItem]
    total: int
    page: int
    page_size: int
```

(All fields are `| None` regardless of how populated the real column is — this matches the existing `ImpugnacionItem`'s style exactly, rather than trying to encode per-column nullability precision that the report display doesn't need.)

- [ ] **Step 5: Create the router with the estados endpoint**

Create `apps/api/app/routers/infracciones.py`:

```python
import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from openpyxl import Workbook
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import registrar_evento
from app.axis_tables import axis_infracciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, get_current_user
from app.schemas import InfraccionItem, InfraccionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_emision": "Fecha de Emisión",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_vencimiento": "Fecha de Vencimiento",
    "estado": "Estado",
    "codigo_infraccion": "Código de Infracción",
    "codigo_infraccion_ant": "Código de Infracción Anterior",
    "contravencion": "Contravención",
    "articulo": "Artículo",
    "literal": "Literal",
    "descripcion_articulo": "Descripción del Artículo",
    "periodo_fiscal": "Período Fiscal",
    "oficina": "Oficina",
    "origen_registro": "Origen de Registro",
    "tipo_registro_infraccion": "Tipo de Registro",
    "tipo_emision": "Tipo de Emisión",
    "tipo_deudor": "Tipo de Deudor",
    "codigo_usuario_registra": "Usuario que Registra",
    "observacion": "Observación",
    "provincia": "Provincia",
    "localidad": "Localidad",
    "lugar_infraccion": "Lugar de Infracción",
    "canal": "Canal",
    "placa": "Placa",
    "tipo_identificacion_infractor": "Tipo de Identificación (Infractor)",
    "numero_identificacion_infractor": "Número de Identificación (Infractor)",
    "nombre_infractor": "Nombre del Infractor",
    "tipo_identificacion_propietario": "Tipo de Identificación (Propietario)",
    "numero_identificacion_propietario": "Número de Identificación (Propietario)",
    "nombre_propietario": "Nombre del Propietario",
    "indicador_bloqueada": "Bloqueada",
    "indicador_acta_juzgamiento": "Acta de Juzgamiento",
    "indicador_modificada": "Modificada",
    "indicador_calcula_recargo": "Calcula Recargo",
    "valor_capital": "Valor Capital",
    "valor_capital_exonerado": "Valor Capital Exonerado",
    "valor_recargo": "Valor Recargo",
    "valor_recargo_exonerado": "Valor Recargo Exonerado",
    "valor_intereses": "Valor Intereses",
    "valor_total": "Valor Total",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


@router.get("/infracciones/estados", response_model=list[str])
async def list_estados_infracciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[str]:
    stmt = (
        select(axis_infracciones.c.estado)
        .where(axis_infracciones.c.estado.is_not(None))
        .distinct()
        .order_by(axis_infracciones.c.estado)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]
```

(The `date`, `datetime`, `Decimal`, `Literal`, `HTTPException`, `Query`, `Request`, `Response`, `status`, `Workbook`, `Date`, `and_`, `cast`, `func`, `registrar_evento`, `get_client_ip`, `csv`, `io` imports are unused until Tasks 2/3 add the search and export endpoints — leave them in now exactly as shown, since Tasks 2 and 3 modify this same file and will use them immediately. Leaving them in Step 5 avoids a spurious "add this import" diff line in the next two tasks.)

- [ ] **Step 6: Register the router**

In `apps/api/app/main.py`, add the import (keep the existing three imports alphabetically sorted, `auditoria` < `auth` < `infracciones` < `reportes`):

```python
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.infracciones import router as infracciones_router
from app.routers.reportes import router as reportes_router
```

And add, after `app.include_router(reportes_router)`:

```python
app.include_router(infracciones_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py -v`
Expected: PASS (2 passed)

Then run the full backend suite to confirm nothing else broke:
Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests)

- [ ] **Step 8: Report your changes (do not commit)**

List the files you changed (`apps/api/app/axis_tables.py`, `apps/api/app/schemas.py`, `apps/api/app/routers/infracciones.py`, `apps/api/app/main.py`, `apps/api/tests/test_infracciones_routes.py`) and suggest this commit message for the user to use themselves: `feat(api): add axis_infracciones table, schemas, and estados endpoint`. Do not run `git add` or `git commit`.

---

### Task 2: `GET /api/reportes/infracciones` search endpoint

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `COLUMN_HEADERS`/`COLUMN_NAMES` (Task 1), `registrar_evento` (existing, `app/audit.py`), `get_client_ip` (existing, `app/routers/auth.py`).
- Produces: `GET /api/reportes/infracciones` — query params `fecha_desde: date`, `fecha_hasta: date` (required), `estado: str | None`, `page: int = 1`; response `InfraccionListResponse`. Records `reportes.infracciones.search` via `registrar_evento`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_infracciones_routes.py` (add `from datetime import timedelta` alongside the existing `from datetime import datetime` import at the top):

```python
@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session,
        [
            _row("TEST-INF-101", datetime(2031, 6, 5), estado="EMITIDA", observacion="Primera"),
            _row("TEST-INF-102", datetime(2031, 6, 15), estado="EMITIDA", observacion="Segunda"),
            _row("TEST-INF-103", datetime(2031, 6, 25), estado="EMITIDA", observacion="Tercera"),
        ],
    )

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-INF-103", "TEST-INF-102", "TEST-INF-101"]
    first = body["items"][0]
    assert first["estado"] == "EMITIDA"
    assert first["observacion"] == "Tercera"
    assert first["valor_total"] == 56.0


@pytest.mark.asyncio
async def test_list_rejects_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2024-06-20", "fecha_hasta": "2024-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_filters_by_estado(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session,
        [
            _row("TEST-INF-201", datetime(2031, 6, 5), estado="EMITIDA"),
            _row("TEST-INF-202", datetime(2031, 6, 6), estado="PAGADA"),
        ],
    )

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "estado": "PAGADA"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-INF-202"


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 5, 1)
    rows = [
        _row(f"TEST-INF-p-{i:03d}", base + timedelta(minutes=30 * i), estado="EMITIDA")
        for i in range(55)
    ]
    await _seed_infracciones(db_session, rows)

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-05-01", "fecha_hasta": "2031-05-31", "page": 2},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 55
    assert body["page"] == 2
    assert len(body["items"]) == 5
    assert body["items"][0]["registro"] == "TEST-INF-p-004"
    assert body["items"][-1]["registro"] == "TEST-INF-p-000"


@pytest.mark.asyncio
async def test_list_out_of_range_page_returns_empty(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(db_session, [_row("TEST-INF-301", datetime(2031, 6, 5))])

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "page": 5},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 1


@pytest.mark.asyncio
async def test_list_without_token_returns_401(client, db_session):
    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30"},
    )
    assert response.status_code == 401
```

Also append to `apps/api/tests/test_audit_routes.py` — this file has its own local helpers and must stay self-contained, so it gets its own minimal seeding helper rather than reusing `test_infracciones_routes.py`'s `_row`/`_seed_infracciones` (matching how the existing impugnaciones audit tests in this same file already duplicate their own `_impugnacion_row`/`_seed_impugnaciones` instead of importing them):

```python
INSERT_INFRACCION_SQL = text(
    """
    INSERT INTO axis.axis_infracciones
        (registro, fecha_registro, estado)
    VALUES
        (:registro, :fecha_registro, :estado)
    RETURNING id
    """
)


def _infraccion_row(registro, fecha_registro, estado="EMITIDA"):
    return {"registro": registro, "fecha_registro": fecha_registro, "estado": estado}


async def _seed_infracciones_audit(db_session, rows):
    for row in rows:
        await db_session.execute(INSERT_INFRACCION_SQL, row)
    await db_session.commit()


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_audit_infracciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_infracciones WHERE registro LIKE 'TEST-AUD-INF-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_infracciones_search_creates_audit_event_with_filters_and_total(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones_audit(
        db_session,
        [
            _infraccion_row("TEST-AUD-INF-001", datetime(2031, 6, 5), estado="EMITIDA"),
            _infraccion_row("TEST-AUD-INF-002", datetime(2031, 6, 6), estado="EMITIDA"),
        ],
    )

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "estado": "EMITIDA"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.infracciones.search")
    assert log is not None
    assert log.details == {
        "fecha_desde": "2031-06-01",
        "fecha_hasta": "2031-06-30",
        "estado": "EMITIDA",
        "page": 1,
        "total": 2,
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py tests/test_audit_routes.py -v -k "list_ or infracciones_search"`
Expected: FAIL — the new tests get `404 Not Found` (route doesn't exist yet).

- [ ] **Step 3: Implement the endpoint**

In `apps/api/app/routers/infracciones.py`, add after the `COLUMN_NAMES = list(COLUMN_HEADERS)` line:

```python
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
    conditions = [cast(axis_infracciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta)]
    if estado is not None:
        conditions.append(axis_infracciones.c.estado == estado)
    return conditions
```

Then add, after the `list_estados_infracciones` endpoint:

```python
@router.get("/infracciones", response_model=InfraccionListResponse)
async def list_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InfraccionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_infracciones).where(and_(*conditions))
    )

    columns = [axis_infracciones.c.id] + [axis_infracciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_infracciones.c.fecha_registro.desc(), axis_infracciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [InfraccionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.infracciones.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return InfraccionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py tests/test_audit_routes.py -v`
Expected: PASS (all tests in both files, including every pre-existing test — the audit test file's new fixture/helpers must not affect the impugnaciones/login/logout/auditoria tests already in that file).

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/api/app/routers/infracciones.py`, `apps/api/tests/test_infracciones_routes.py`, `apps/api/tests/test_audit_routes.py`. Suggested message: `feat(api): add GET /api/reportes/infracciones search endpoint with audit event`. Do not run `git add` or `git commit`.

---

### Task 3: `GET /api/reportes/infracciones/export` endpoint (CSV/XLSX)

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `COLUMN_HEADERS`/`COLUMN_NAMES`, `_validate_date_range`, `_date_range_conditions` (Task 2).
- Produces: `GET /api/reportes/infracciones/export` — same filters as search (no `page`) + `formato: "csv" | "xlsx"`. Records `reportes.infracciones.export`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_infracciones_routes.py` (add these imports at the top of the file, alongside the existing ones):

```python
import csv
import io

from openpyxl import load_workbook

EXPECTED_HEADERS = [
    "Registro",
    "Fecha de Registro",
    "Fecha de Emisión",
    "Fecha de Aprobación",
    "Fecha de Vencimiento",
    "Estado",
    "Código de Infracción",
    "Código de Infracción Anterior",
    "Contravención",
    "Artículo",
    "Literal",
    "Descripción del Artículo",
    "Período Fiscal",
    "Oficina",
    "Origen de Registro",
    "Tipo de Registro",
    "Tipo de Emisión",
    "Tipo de Deudor",
    "Usuario que Registra",
    "Observación",
    "Provincia",
    "Localidad",
    "Lugar de Infracción",
    "Canal",
    "Placa",
    "Tipo de Identificación (Infractor)",
    "Número de Identificación (Infractor)",
    "Nombre del Infractor",
    "Tipo de Identificación (Propietario)",
    "Número de Identificación (Propietario)",
    "Nombre del Propietario",
    "Bloqueada",
    "Acta de Juzgamiento",
    "Modificada",
    "Calcula Recargo",
    "Valor Capital",
    "Valor Capital Exonerado",
    "Valor Recargo",
    "Valor Recargo Exonerado",
    "Valor Intereses",
    "Valor Total",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 8, 1)
    rows = [
        _row(f"TEST-INF-e-{i:03d}", base + timedelta(minutes=30 * i), estado="EMITIDA")
        for i in range(55)
    ]
    await _seed_infracciones(db_session, rows)

    response = await client.get(
        "/api/reportes/infracciones/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "infracciones_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 41
    assert len(lines) - 1 == 55

    data_row = parsed_rows[1]
    assert len(data_row) == 41
    assert data_row[5] == "EMITIDA"
    assert data_row[0].startswith("TEST-INF-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 9, 1)
    rows = [
        _row(f"TEST-INF-x-{i:03d}", base + timedelta(minutes=30 * i), estado="EMITIDA")
        for i in range(55)
    ]
    await _seed_infracciones(db_session, rows)

    response = await client.get(
        "/api/reportes/infracciones/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "infracciones_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 42)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 42)]
    assert data_row[5] == "EMITIDA"
    assert data_row[0].startswith("TEST-INF-x-")


@pytest.mark.asyncio
async def test_export_without_token_returns_401(client, db_session):
    response = await client.get(
        "/api/reportes/infracciones/export",
        params={"fecha_desde": "2024-06-01", "fecha_hasta": "2024-06-30", "formato": "csv"},
    )
    assert response.status_code == 401
```

Also append to `apps/api/tests/test_audit_routes.py`:

```python
@pytest.mark.asyncio
async def test_infracciones_export_creates_audit_event_with_row_count(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones_audit(
        db_session, [_infraccion_row("TEST-AUD-INF-101", datetime(2031, 7, 5), estado="EMITIDA")]
    )

    response = await client.get(
        "/api/reportes/infracciones/export",
        params={"fecha_desde": "2031-07-01", "fecha_hasta": "2031-07-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.infracciones.export")
    assert log is not None
    assert log.details["formato"] == "csv"
    assert log.details["filas_exportadas"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py tests/test_audit_routes.py -v -k "export"`
Expected: FAIL — `404 Not Found` for the new export tests.

- [ ] **Step 3: Implement the endpoint**

In `apps/api/app/routers/infracciones.py`, add after `list_infracciones`:

```python
def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/infracciones/export")
async def export_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    columns = [axis_infracciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_infracciones.c.fecha_registro.desc(), axis_infracciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"infracciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.infracciones.export",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "formato": formato,
            "filas_exportadas": len(rows),
        },
    )
    await db.commit()

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_infracciones_routes.py tests/test_audit_routes.py -v`
Expected: PASS (all tests)

Then run the full backend suite:
Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests). ALL BACKEND TASKS COMPLETE at this point.

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/api/app/routers/infracciones.py`, `apps/api/tests/test_infracciones_routes.py`, `apps/api/tests/test_audit_routes.py`. Suggested message: `feat(api): add GET /api/reportes/infracciones/export endpoint with audit event`. Do not run `git add` or `git commit`.

---

## Frontend

### Task 4: `InfraccionItem` model and `InfraccionesService`

**Files:**
- Create: `apps/web/src/app/core/models/infraccion.model.ts`
- Create: `apps/web/src/app/core/infracciones.service.ts`
- Create: `apps/web/src/app/core/infracciones.service.spec.ts`

**Interfaces:**
- Produces:
  - `InfraccionItem` — 41 report fields + `id` (matches `InfraccionItem` from Task 1's backend schema field-for-field).
  - `InfraccionListResponse { items: InfraccionItem[], total, page, page_size }`.
  - `InfraccionFilters { fecha_desde: string, fecha_hasta: string, estado: string | null }`.
  - `InfraccionesService.getEstados(): Observable<string[]>`, `.listInfracciones(filters, page): Observable<InfraccionListResponse>`, `.exportInfracciones(filters, formato): Observable<Blob>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/models/infraccion.model.ts`:

```ts
export interface InfraccionItem {
  id: number;
  registro: string | null;
  fecha_registro: string | null;
  fecha_emision: string | null;
  fecha_aprobacion: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  codigo_infraccion: string | null;
  codigo_infraccion_ant: string | null;
  contravencion: string | null;
  articulo: string | null;
  literal: string | null;
  descripcion_articulo: string | null;
  periodo_fiscal: string | null;
  oficina: string | null;
  origen_registro: string | null;
  tipo_registro_infraccion: string | null;
  tipo_emision: string | null;
  tipo_deudor: string | null;
  codigo_usuario_registra: string | null;
  observacion: string | null;
  provincia: string | null;
  localidad: string | null;
  lugar_infraccion: string | null;
  canal: string | null;
  placa: string | null;
  tipo_identificacion_infractor: string | null;
  numero_identificacion_infractor: string | null;
  nombre_infractor: string | null;
  tipo_identificacion_propietario: string | null;
  numero_identificacion_propietario: string | null;
  nombre_propietario: string | null;
  indicador_bloqueada: string | null;
  indicador_acta_juzgamiento: string | null;
  indicador_modificada: string | null;
  indicador_calcula_recargo: string | null;
  valor_capital: number | null;
  valor_capital_exonerado: number | null;
  valor_recargo: number | null;
  valor_recargo_exonerado: number | null;
  valor_intereses: number | null;
  valor_total: number | null;
}

export interface InfraccionListResponse {
  items: InfraccionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface InfraccionFilters {
  fecha_desde: string;
  fecha_hasta: string;
  estado: string | null;
}
```

Create `apps/web/src/app/core/infracciones.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { InfraccionesService } from './infracciones.service';
import { InfraccionListResponse } from './models/infraccion.model';
import { environment } from '../../environments/environment';

describe('InfraccionesService', () => {
  let service: InfraccionesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [InfraccionesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InfraccionesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getEstados fetches the list of distinct estados', () => {
    let result: string[] | undefined;
    service.getEstados().subscribe((estados) => (result = estados));

    const req = httpMock.expectOne(`${environment.apiUrl}/reportes/infracciones/estados`);
    expect(req.request.method).toBe('GET');
    req.flush(['EMITIDA', 'PAGADA']);

    expect(result).toEqual(['EMITIDA', 'PAGADA']);
  });

  it('listInfracciones sends fecha_desde, fecha_hasta, page and omits estado when not set', () => {
    const response: InfraccionListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service
      .listInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 1)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/infracciones`);
    expect(req.request.params.get('fecha_desde')).toBe('2024-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2024-06-30');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('estado')).toBe(false);
    req.flush(response);
  });

  it('listInfracciones includes estado when set', () => {
    service
      .listInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: 'PAGADA' }, 2)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/infracciones`);
    expect(req.request.params.get('estado')).toBe('PAGADA');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('exportInfracciones requests a blob with the formato param', () => {
    let result: Blob | undefined;
    service
      .exportInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 'xlsx')
      .subscribe((blob) => (result = blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/infracciones/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['data']);
    req.flush(blob);

    expect(result).toBe(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/infracciones.service.spec.ts"`
Expected: FAIL with a module resolution error (`./infracciones.service` doesn't exist).

- [ ] **Step 3: Implement the service**

Create `apps/web/src/app/core/infracciones.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InfraccionFilters, InfraccionListResponse } from './models/infraccion.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: InfraccionFilters): HttpParams {
  let params = new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
  if (filters.estado) {
    params = params.set('estado', filters.estado);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class InfraccionesService {
  private readonly http = inject(HttpClient);

  getEstados(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/reportes/infracciones/estados`);
  }

  listInfracciones(filters: InfraccionFilters, page: number): Observable<InfraccionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<InfraccionListResponse>(`${environment.apiUrl}/reportes/infracciones`, {
      params,
    });
  }

  exportInfracciones(filters: InfraccionFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/infracciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/infracciones.service.spec.ts"`
Expected: PASS (4 passed)

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/core/models/infraccion.model.ts`, `apps/web/src/app/core/infracciones.service.ts`, `apps/web/src/app/core/infracciones.service.spec.ts`. Suggested message: `feat(web): add InfraccionItem model and InfraccionesService`. Do not run `git add` or `git commit`.

---

### Task 5: Sidebar link to "Infracciones" (second Reportes sub-item)

**Files:**
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`

**Interfaces:**
- Produces: `AppShellRoute` now includes `'infracciones'`. `<app-shell activeRoute="infracciones">` is now a valid usage (needed by Task 6). The Reportes submenu auto-expands and highlights correctly for both `'impugnaciones'` and `'infracciones'`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('submenu de Reportes', ...)` block inside `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts` (nest these next to the existing `'expands the Reportes submenu...'` and `'auto-expands and highlights Impugnaciones...'` tests):

```ts
    it('shows the Infracciones link once the Reportes submenu is expanded', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="reportes-toggle"]');
      toggle.click();
      fixture.detectChanges();

      const infraccionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/infracciones"]'
      );
      expect(infraccionesLink).not.toBeNull();
    });

    it('auto-expands and highlights Infracciones when activeRoute is infracciones', () => {
      createComponent('infracciones');

      const infraccionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/infracciones"]'
      );
      expect(infraccionesLink).not.toBeNull();
      expect(infraccionesLink!.classList.contains('text-secondary-fixed-dim')).toBe(true);

      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).not.toBeNull();
      expect(impugnacionesLink!.classList.contains('text-secondary-fixed-dim')).toBe(false);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: FAIL — both new tests find no `a[href="/reportes/infracciones"]`; the second test also fails TypeScript compilation isn't affected (string literal `'infracciones'` isn't yet part of `AppShellRoute`, but `createComponent()`'s parameter type is `AppShellRoute = 'dashboard'` — Step 2 may fail to even compile until Step 3 lands the type change. If so, that's the expected RED state: note in your test run that the failure is a type error naming `'infracciones'` is not assignable to `AppShellRoute`, and proceed to Step 3).

- [ ] **Step 3: Add the route type, auto-expand condition, and sidebar link**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:
```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'usuarios' | 'auditoria';
```
to:
```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'usuarios' | 'auditoria';
```

And change:
```ts
  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
    if (this.activeRoute === 'impugnaciones') {
      this.reportesExpanded = true;
    }
  }
```
to:
```ts
  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
    if (this.activeRoute === 'impugnaciones' || this.activeRoute === 'infracciones') {
      this.reportesExpanded = true;
    }
  }
```

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, replace:
```html
          @if (reportesExpanded) {
            <ul class="flex flex-col gap-xs">
              <li class="pl-xl">
                <a routerLink="/reportes/impugnaciones" [class]="navLinkClass('impugnaciones')">
                  <span class="font-body-sm text-body-sm">Impugnaciones</span>
                </a>
              </li>
            </ul>
          }
```
with:
```html
          @if (reportesExpanded) {
            <ul class="flex flex-col gap-xs">
              <li class="pl-xl">
                <a routerLink="/reportes/impugnaciones" [class]="navLinkClass('impugnaciones')">
                  <span class="font-body-sm text-body-sm">Impugnaciones</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/infracciones" [class]="navLinkClass('infracciones')">
                  <span class="font-body-sm text-body-sm">Infracciones</span>
                </a>
              </li>
            </ul>
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: PASS (all tests in the file, including every pre-existing one)

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/shared/app-shell/app-shell.component.ts`, `apps/web/src/app/shared/app-shell/app-shell.component.html`, `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`. Suggested message: `feat(web): add Infracciones link to the Reportes sidebar submenu`. Do not run `git add` or `git commit`.

---

### Task 6: `InfraccionesComponent` (dynamic 41-column table) and route

**Files:**
- Create: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`
- Create: `apps/web/src/app/features/reportes/infracciones/infracciones.component.html`
- Create: `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `InfraccionesService` (Task 4), `InfraccionItem`/`InfraccionListResponse`/`InfraccionFilters` (Task 4), `AppShellComponent` with `activeRoute="infracciones"` (Task 5).
- Produces: `COLUMNAS: { clave: keyof InfraccionItem; encabezado: string }[]` (41 entries, exported for the spec test to assert against), `InfraccionesComponent`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { InfraccionesComponent, COLUMNAS } from './infracciones.component';
import { AuthService } from '../../../core/auth.service';
import { InfraccionesService } from '../../../core/infracciones.service';
import { InfraccionItem, InfraccionListResponse } from '../../../core/models/infraccion.model';

describe('InfraccionesComponent', () => {
  let fixture: ComponentFixture<InfraccionesComponent>;
  let infraccionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listInfracciones: ReturnType<typeof vi.fn>;
    exportInfracciones: ReturnType<typeof vi.fn>;
  };

  const item: InfraccionItem = {
    id: 1,
    registro: 'REG-001',
    fecha_registro: '2024-06-05T00:00:00',
    fecha_emision: '2024-06-05T00:00:00',
    fecha_aprobacion: '2024-06-05T00:00:00',
    fecha_vencimiento: '2024-06-15T00:00:00',
    estado: 'EMITIDA',
    codigo_infraccion: 'COD-001',
    codigo_infraccion_ant: 'ANT-001',
    contravencion: 'CONTRA-001',
    articulo: '139',
    literal: '1',
    descripcion_articulo: 'Descripción de prueba',
    periodo_fiscal: 'ACTUAL',
    oficina: 'GAD LOJA',
    origen_registro: 'AXIS',
    tipo_registro_infraccion: 'PARTE',
    tipo_emision: 'ACT',
    tipo_deudor: 'CONDUCTOR',
    codigo_usuario_registra: 'USR001',
    observacion: 'Observación de prueba',
    provincia: 'LOJ',
    localidad: 'LOJ',
    lugar_infraccion: 'Av. de prueba',
    canal: 'APP',
    placa: 'ABC1234',
    tipo_identificacion_infractor: 'CED',
    numero_identificacion_infractor: '1103456789',
    nombre_infractor: 'Infractor de Prueba',
    tipo_identificacion_propietario: 'CED',
    numero_identificacion_propietario: '1103456789',
    nombre_propietario: 'Propietario de Prueba',
    indicador_bloqueada: 'N',
    indicador_acta_juzgamiento: 'N',
    indicador_modificada: 'N',
    indicador_calcula_recargo: 'S',
    valor_capital: 50,
    valor_capital_exonerado: 0,
    valor_recargo: 5,
    valor_recargo_exonerado: 0,
    valor_intereses: 1,
    valor_total: 56,
  };

  const resultado: InfraccionListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    infraccionesService = {
      getEstados: vi.fn().mockReturnValue(of(['EMITIDA', 'PAGADA'])),
      listInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [InfraccionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: InfraccionesService, useValue: infraccionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InfraccionesComponent);
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

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      1
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives, with all 41 columns in the defined order', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('Cargando...');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);

      resultado$.next(resultado);
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Cargando...');
      expect(text).toContain('REG-001');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);

      const headerCells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('thead th');
      const headerTexts = Array.from(headerCells).map((th) => th.textContent?.trim());
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(41);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(41);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[6]).toBe('COD-001');
      expect(cellTexts[40]).toBe('56');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay infracciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las infracciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    infraccionesService.listInfracciones.mockReturnValue(of({ ...resultado, total: 60 }));

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

    expect(infraccionesService.listInfracciones).toHaveBeenLastCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      2
    );
  });

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

      expect(infraccionesService.exportInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'csv'
      );
    });

    it('descarga Excel con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      excelButton.click();

      expect(infraccionesService.exportInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'xlsx'
      );
    });

    it('disables the download buttons when there are no results', () => {
      infraccionesService.listInfracciones.mockReturnValue(
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: FAIL with a module resolution error (`./infracciones.component` doesn't exist).

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { InfraccionesService } from '../../../core/infracciones.service';
import { InfraccionFilters, InfraccionItem, InfraccionListResponse } from '../../../core/models/infraccion.model';

const RANGE_ERROR_MESSAGE = 'El rango de fechas debe estar dentro del mismo mes calendario.';
const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar las infracciones. Intenta de nuevo.';

export interface ColumnaInfraccion {
  clave: keyof InfraccionItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaInfraccion[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_emision', encabezado: 'Fecha de Emisión' },
  { clave: 'fecha_aprobacion', encabezado: 'Fecha de Aprobación' },
  { clave: 'fecha_vencimiento', encabezado: 'Fecha de Vencimiento' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_infraccion', encabezado: 'Código de Infracción' },
  { clave: 'codigo_infraccion_ant', encabezado: 'Código de Infracción Anterior' },
  { clave: 'contravencion', encabezado: 'Contravención' },
  { clave: 'articulo', encabezado: 'Artículo' },
  { clave: 'literal', encabezado: 'Literal' },
  { clave: 'descripcion_articulo', encabezado: 'Descripción del Artículo' },
  { clave: 'periodo_fiscal', encabezado: 'Período Fiscal' },
  { clave: 'oficina', encabezado: 'Oficina' },
  { clave: 'origen_registro', encabezado: 'Origen de Registro' },
  { clave: 'tipo_registro_infraccion', encabezado: 'Tipo de Registro' },
  { clave: 'tipo_emision', encabezado: 'Tipo de Emisión' },
  { clave: 'tipo_deudor', encabezado: 'Tipo de Deudor' },
  { clave: 'codigo_usuario_registra', encabezado: 'Usuario que Registra' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'provincia', encabezado: 'Provincia' },
  { clave: 'localidad', encabezado: 'Localidad' },
  { clave: 'lugar_infraccion', encabezado: 'Lugar de Infracción' },
  { clave: 'canal', encabezado: 'Canal' },
  { clave: 'placa', encabezado: 'Placa' },
  { clave: 'tipo_identificacion_infractor', encabezado: 'Tipo de Identificación (Infractor)' },
  { clave: 'numero_identificacion_infractor', encabezado: 'Número de Identificación (Infractor)' },
  { clave: 'nombre_infractor', encabezado: 'Nombre del Infractor' },
  { clave: 'tipo_identificacion_propietario', encabezado: 'Tipo de Identificación (Propietario)' },
  { clave: 'numero_identificacion_propietario', encabezado: 'Número de Identificación (Propietario)' },
  { clave: 'nombre_propietario', encabezado: 'Nombre del Propietario' },
  { clave: 'indicador_bloqueada', encabezado: 'Bloqueada' },
  { clave: 'indicador_acta_juzgamiento', encabezado: 'Acta de Juzgamiento' },
  { clave: 'indicador_modificada', encabezado: 'Modificada' },
  { clave: 'indicador_calcula_recargo', encabezado: 'Calcula Recargo' },
  { clave: 'valor_capital', encabezado: 'Valor Capital' },
  { clave: 'valor_capital_exonerado', encabezado: 'Valor Capital Exonerado' },
  { clave: 'valor_recargo', encabezado: 'Valor Recargo' },
  { clave: 'valor_recargo_exonerado', encabezado: 'Valor Recargo Exonerado' },
  { clave: 'valor_intereses', encabezado: 'Valor Intereses' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
];

@Component({
  selector: 'app-infracciones',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './infracciones.component.html',
})
export class InfraccionesComponent implements OnInit {
  private readonly infraccionesService = inject(InfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
    estado: [''],
  });

  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();

  private readonly resultadoSubject = new BehaviorSubject<InfraccionListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: InfraccionFilters | null = null;

  ngOnInit(): void {
    this.infraccionesService.getEstados().subscribe({
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

  descargar(formato: 'csv' | 'xlsx'): void {
    if (!this.filtrosVigentes) {
      return;
    }
    const filtros = this.filtrosVigentes;
    this.infraccionesService.exportInfracciones(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: InfraccionFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `infracciones_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private cargarPagina(page: number): void {
    if (!this.filtrosVigentes) {
      return;
    }
    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.infraccionesService.listInfracciones(this.filtrosVigentes, page).subscribe({
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

Create `apps/web/src/app/features/reportes/infracciones/infracciones.component.html`:

```html
<app-shell activeRoute="infracciones">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Infracciones</h2>
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
      <div class="p-md border-b border-outline-variant flex justify-end gap-sm bg-surface-bright">
        <button type="button" data-testid="descargar-csv" [disabled]="resultado.total === 0" (click)="descargar('csv')" class="text-primary hover:underline font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">Descargar CSV</button>
        <button type="button" data-testid="descargar-excel" [disabled]="resultado.total === 0" (click)="descargar('xlsx')" class="text-primary hover:underline font-body-sm text-body-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">Descargar Excel</button>
      </div>
      @if (resultado.total === 0) {
        <p class="p-md text-on-surface-variant text-body-sm">No hay infracciones para estos filtros</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low border-b border-outline-variant">
              <tr>
                @for (columna of columnas; track columna.clave) {
                  <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant whitespace-nowrap">{{ columna.encabezado }}</th>
                }
              </tr>
            </thead>
            <tbody class="font-body-sm text-body-sm divide-y divide-outline-variant/50">
              @for (item of resultado.items; track item.id) {
                <tr class="hover:bg-surface-container-lowest/50 transition-colors">
                  @for (columna of columnas; track columna.clave) {
                    <td class="py-3 px-md text-on-surface-variant whitespace-nowrap">{{ item[columna.clave] }}</td>
                  }
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

- [ ] **Step 4: Register the route**

In `apps/web/src/app/app.routes.ts`, add the import:
```ts
import { InfraccionesComponent } from './features/reportes/infracciones/infracciones.component';
```
and add, after the `reportes/impugnaciones` route:
```ts
  { path: 'reportes/infracciones', component: InfraccionesComponent, canActivate: [authGuard] },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: PASS (all tests in the file)

Then run the full frontend suite to confirm zero regressions:
Run: `cd apps/web && npx ng test --watch=false`
Expected: PASS (all tests). ALL FRONTEND TASKS COMPLETE at this point.

- [ ] **Step 6: Report your changes (do not commit)**

Files changed: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`, `apps/web/src/app/features/reportes/infracciones/infracciones.component.html`, `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`, `apps/web/src/app/app.routes.ts`. Suggested message: `feat(web): add Infracciones report screen with dynamic 41-column table`. Do not run `git add` or `git commit`.

---

## Final verification

- [ ] Run the full backend suite: `cd apps/api && .venv/bin/pytest -v` → all green.
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` → all green.
- [ ] Manually smoke-test: log in, open "Reportes" in the sidebar, confirm both "Impugnaciones" and "Infracciones" are listed and the active one highlights correctly; open Infracciones, pick a real month with a large row count (e.g. 2017-09), filter by an `estado`, page through results, download both CSV and Excel and confirm all 41 columns/headers are present and readable, then try a date range that crosses a month boundary and confirm it's blocked client-side.
