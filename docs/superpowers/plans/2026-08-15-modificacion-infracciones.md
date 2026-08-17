# Reporte de Modificación de Infracciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete new report for `axis_modificacion_infracciones` (filters, paginated table, CSV/Excel export), showing 100% of its real columns (except `id` and `deleted_at`) with the official AXIS Cloud/Yoveri labels, mirroring the existing Pagos report exactly (including its `_select_column`/`DATE_ONLY_COLUMNS` date-truncation pattern).

**Architecture:** Same file layout and pattern as the Pagos report: a FastAPI router under `/api/reportes/modificacion-infracciones` (+ `/export`) that truncates the one real `timestamp` column (`fecha_registro`) to date-only via `cast(column, Date)`, a `ModificacionInfraccionItem`/`ModificacionInfraccionListResponse` Pydantic schema, and an Angular `ModificacionInfraccionesComponent` (filters + table + downloads) wired into the app's routes and the "Reportes" sidebar submenu.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Show/export all 10 real named columns of `axis_modificacion_infracciones` (`id` and `deleted_at` are excluded from every report per this session's standing rule).
- The source AXIS Cloud/Yoveri document labels two different real columns identically ("Código de la Infracción"). Per agreement with the user, label `codigo_infraccion_original` as **"Código de la Infracción (Original)"** and `codigo_infraccion_acta` as **"Código de la Infracción (Acta)"**.
- `fecha_registro` is a real `timestamp` column — select it via `cast(fecha_registro, Date).label("fecha_registro")` (same pattern as `reportes.py`/`infracciones.py`/`pagos.py`) and type the schema field `date`, not `datetime`. `fecha_generacion` is already `date` and `hora_generacion` is already `time` — neither needs truncation.
- Date-range filter is on `fecha_registro`, truncated to date via `cast(..., Date).between(...)`. Exclude soft-deleted rows (`deleted_at IS NULL`). No estado filter (this table has no `estado` column). Order by the full-precision `fecha_registro DESC, id DESC` — never the truncated/aliased column. Page size 50.
- No foreign keys anywhere in this table — no persona seeding needed in tests, unlike Juicios/Títulos de Crédito.

---

### Task 1: Backend — Modificación de Infracciones report endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py:184-189` (replace the minimal `axis_modificacion_infracciones` Table with the full real column set)
- Create: `apps/api/app/routers/modificacion_infracciones.py`
- Modify: `apps/api/app/schemas.py` (add `ModificacionInfraccionItem`, `ModificacionInfraccionListResponse`)
- Modify: `apps/api/app/main.py` (register the new router)
- Create: `apps/api/tests/test_modificacion_infracciones_routes.py`

**Interfaces:**
- Consumes: none (self-contained; independent of Task 2).
- Produces: `GET /api/reportes/modificacion-infracciones` and `GET /api/reportes/modificacion-infracciones/export`, both requiring auth via `require_active_user`. `ModificacionInfraccionItem` has 11 fields (`id` + 10 named). Frontend (Task 2) consumes these exact field names and the exact `COLUMN_HEADERS` label strings below.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_modificacion_infracciones_routes.py`:

```python
import csv
import io
from datetime import date, datetime, time

import pytest
import pytest_asyncio
from openpyxl import load_workbook
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
    INSERT INTO axis.axis_modificacion_infracciones
        (registro, hora_generacion, codigo_infraccion_original, contravencion, observacion,
         codigo_infraccion_acta, codigo_usuario_modifica, numero_credito, fecha_generacion,
         fecha_registro)
    VALUES
        (:registro, :hora_generacion, :codigo_infraccion_original, :contravencion, :observacion,
         :codigo_infraccion_acta, :codigo_usuario_modifica, :numero_credito, :fecha_generacion,
         :fecha_registro)
    RETURNING id
    """
)


def _row(registro, fecha_registro, **overrides):
    base = {
        "registro": registro,
        "hora_generacion": time(11, 20, 0),
        "codigo_infraccion_original": f"ORIG-{registro}",
        "contravencion": "CONT-001",
        "observacion": "Observación de prueba",
        "codigo_infraccion_acta": f"ACTA-{registro}",
        "codigo_usuario_modifica": "USR-MOD-01",
        "numero_credito": "CRED-001",
        "fecha_generacion": fecha_registro.date(),
        "fecha_registro": fecha_registro,
    }
    base.update(overrides)
    return base


async def _seed_modificaciones(db_session, rows):
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_modificaciones(db_session):
    yield
    await db_session.execute(
        text("DELETE FROM axis.axis_modificacion_infracciones WHERE registro LIKE 'TEST-MOD-%'")
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(
        db_session,
        [
            _row("TEST-MOD-101", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-MOD-102", datetime(2031, 6, 15, 9, 0, 0)),
            _row("TEST-MOD-103", datetime(2031, 6, 25, 9, 0, 0)),
        ],
    )

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-MOD-103", "TEST-MOD-102", "TEST-MOD-101"]
    first = body["items"][0]
    assert first["codigo_usuario_modifica"] == "USR-MOD-01"
    assert first["numero_credito"] == "CRED-001"
    assert first["codigo_infraccion_original"] == "ORIG-TEST-MOD-103"
    assert first["codigo_infraccion_acta"] == "ACTA-TEST-MOD-103"


@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-15", "fecha_hasta": "2031-07-05"},
        headers=headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-20", "fecha_hasta": "2031-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(
        db_session,
        [
            _row("TEST-MOD-201", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-MOD-202", datetime(2031, 6, 6, 9, 0, 0)),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_modificacion_infracciones SET deleted_at = now() WHERE registro = 'TEST-MOD-202'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-MOD-201"


@pytest.mark.asyncio
async def test_list_includes_rows_at_the_end_of_the_last_day(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(
        db_session,
        [
            _row("TEST-MOD-601", datetime(2031, 6, 30, 23, 59, 59)),
            _row("TEST-MOD-602", datetime(2031, 7, 1, 0, 0, 0)),
        ],
    )

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    registros = [item["registro"] for item in body["items"]]
    assert "TEST-MOD-601" in registros
    assert "TEST-MOD-602" not in registros


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 5, 1, 8, 0, 0)
    rows = [_row(f"TEST-MOD-p-{i:03d}", base.replace(day=1 + i % 28)) for i in range(55)]
    await _seed_modificaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-05-01", "fecha_hasta": "2031-06-25", "page": 2},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 55
    assert body["page"] == 2
    assert len(body["items"]) == 5


@pytest.mark.asyncio
async def test_list_out_of_range_page_returns_empty(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(db_session, [_row("TEST-MOD-301", datetime(2031, 6, 5, 9, 0, 0))])

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
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
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_blocked_when_must_change_password_is_true(client, db_session):
    user = User(
        email="pendiente@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Usuario Pendiente",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"


EXPECTED_HEADERS = [
    "Registro",
    "Hora de Generación del Registro",
    "Código de la Infracción (Original)",
    "Contravención",
    "Observación",
    "Código de la Infracción (Acta)",
    "Código de Usuario que Modifica",
    "Número de Crédito",
    "Fecha de Generación del Registro",
    "Fecha de Registro",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-MOD-e-{i:03d}", datetime(2031, 8, 1 + i, 9, 0, 0))
        for i in range(28)
    ]
    await _seed_modificaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/modificacion-infracciones/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "modificacion-infracciones_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 10
    assert len(lines) - 1 == 28

    data_row = parsed_rows[1]
    assert len(data_row) == 10
    assert data_row[0].startswith("TEST-MOD-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-MOD-x-{i:03d}", datetime(2031, 9, 1 + i, 9, 0, 0))
        for i in range(29)
    ]
    await _seed_modificaciones(db_session, rows)

    response = await client.get(
        "/api/reportes/modificacion-infracciones/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "modificacion-infracciones_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 11)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 29

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 11)]
    assert data_row[0].startswith("TEST-MOD-x-")


@pytest.mark.asyncio
async def test_export_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(
        db_session,
        [
            _row("TEST-MOD-501", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-MOD-502", datetime(2031, 6, 6, 9, 0, 0)),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_modificacion_infracciones SET deleted_at = now() WHERE registro = 'TEST-MOD-502'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/modificacion-infracciones/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    assert len(lines) - 1 == 1


@pytest.mark.asyncio
async def test_export_without_token_returns_401(client, db_session):
    response = await client.get(
        "/api/reportes/modificacion-infracciones/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(db_session, [_row("TEST-MOD-TRUNC-001", datetime(2031, 6, 5, 14, 35, 0))])

    response = await client.get(
        "/api/reportes/modificacion-infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["fecha_generacion"] == "2031-06-05"
    assert first["fecha_registro"] == "2031-06-05"


@pytest.mark.asyncio
async def test_export_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(db_session, [_row("TEST-MOD-TRUNC-002", datetime(2031, 6, 6, 14, 35, 0))])

    response = await client.get(
        "/api/reportes/modificacion-infracciones/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    data_row = parsed_rows[-1]
    assert data_row[8] == "2031-06-06"
    assert data_row[9] == "2031-06-06"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_modificacion_infracciones_routes.py -v`
Expected: FAIL — `404` for `/api/reportes/modificacion-infracciones` (the router doesn't exist yet) and errors inserting the columns not yet on the `axis_modificacion_infracciones` Table object.

- [ ] **Step 3: Extend the `axis_modificacion_infracciones` Table definition**

In `apps/api/app/axis_tables.py`, change:

```python
axis_modificacion_infracciones = Table(
    "axis_modificacion_infracciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)
```

to:

```python
axis_modificacion_infracciones = Table(
    "axis_modificacion_infracciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("codigo_infraccion_original", Text),
    Column("contravencion", Text),
    Column("observacion", Text),
    Column("codigo_infraccion_acta", Text),
    Column("codigo_usuario_modifica", Text),
    Column("numero_credito", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_registro", DateTime),
)
```

All of `BigInteger`, `Column`, `Date`, `DateTime`, `Table`, `Text`, `Time` are already imported at the top of the file.

- [ ] **Step 4: Add the schema**

In `apps/api/app/schemas.py`, add at the end of the file, after `TituloListResponse`:

```python
class ModificacionInfraccionItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_infraccion_original: str | None
    contravencion: str | None
    observacion: str | None
    codigo_infraccion_acta: str | None
    codigo_usuario_modifica: str | None
    numero_credito: str | None
    fecha_generacion: date | None
    fecha_registro: date | None

    model_config = {"from_attributes": True}


class ModificacionInfraccionListResponse(BaseModel):
    items: list[ModificacionInfraccionItem]
    total: int
    page: int
    page_size: int
```

`date` and `time` are already imported at the top of `schemas.py`.

- [ ] **Step 5: Create the router**

Create `apps/api/app/routers/modificacion_infracciones.py`:

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
from starlette.concurrency import run_in_threadpool

from app.audit import registrar_evento
from app.axis_tables import axis_modificacion_infracciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import ModificacionInfraccionItem, ModificacionInfraccionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_infraccion_original": "Código de la Infracción (Original)",
    "contravencion": "Contravención",
    "observacion": "Observación",
    "codigo_infraccion_acta": "Código de la Infracción (Acta)",
    "codigo_usuario_modifica": "Código de Usuario que Modifica",
    "numero_credito": "Número de Crédito",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
}
COLUMN_NAMES = list(COLUMN_HEADERS)

DATE_ONLY_COLUMNS = {"fecha_registro"}


def _select_column(name: str):
    column = axis_modificacion_infracciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date):
    return [
        cast(axis_modificacion_infracciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta),
        axis_modificacion_infracciones.c.deleted_at.is_(None),
    ]


@router.get("/modificacion-infracciones", response_model=ModificacionInfraccionListResponse)
async def list_modificacion_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> ModificacionInfraccionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(
        select(func.count()).select_from(axis_modificacion_infracciones).where(and_(*conditions))
    )

    columns = [axis_modificacion_infracciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_modificacion_infracciones.c.fecha_registro.desc(), axis_modificacion_infracciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ModificacionInfraccionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.modificacion_infracciones.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return ModificacionInfraccionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/modificacion-infracciones/export")
async def export_modificacion_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_modificacion_infracciones.c.fecha_registro.desc(), axis_modificacion_infracciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"modificacion-infracciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.modificacion_infracciones.export",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "formato": formato,
            "filas_exportadas": len(rows),
        },
    )
    await db.commit()

    def _build_csv() -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(list(COLUMN_HEADERS.values()))
        for row in rows:
            writer.writerow([_export_value(row[name]) for name in COLUMN_NAMES])
        return "﻿" + buffer.getvalue()

    def _build_xlsx() -> bytes:
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet()
        sheet.append(list(COLUMN_HEADERS.values()))
        for row in rows:
            sheet.append([_export_value(row[name]) for name in COLUMN_NAMES])
        xlsx_buffer = io.BytesIO()
        workbook.save(xlsx_buffer)
        return xlsx_buffer.getvalue()

    if formato == "csv":
        content = await run_in_threadpool(_build_csv)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    content = await run_in_threadpool(_build_xlsx)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

- [ ] **Step 6: Register the router**

In `apps/api/app/main.py`, change:

```python
from app.routers.juicios import router as juicios_router
from app.routers.pagos import router as pagos_router
```

to:

```python
from app.routers.juicios import router as juicios_router
from app.routers.modificacion_infracciones import router as modificacion_infracciones_router
from app.routers.pagos import router as pagos_router
```

and change:

```python
app.include_router(pagos_router)
app.include_router(titulos_router)
app.include_router(auditoria_router)
```

to:

```python
app.include_router(pagos_router)
app.include_router(titulos_router)
app.include_router(modificacion_infracciones_router)
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_modificacion_infracciones_routes.py -v`
Expected: all 15 tests pass.

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone — check `ps aux | grep pytest` first; no concurrent run against the shared local DB. A pre-existing unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail on its own — not your concern.)
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/routers/modificacion_infracciones.py apps/api/app/schemas.py apps/api/app/main.py apps/api/tests/test_modificacion_infracciones_routes.py
git commit -m "feat(api): add Modificación de Infracciones report endpoint"
```

---

### Task 2: Frontend — Modificación de Infracciones page

**Files:**
- Create: `apps/web/src/app/core/models/modificacion-infraccion.model.ts`
- Create: `apps/web/src/app/core/modificacion-infracciones.service.ts`
- Create: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts`
- Create: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.html`
- Create: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`

**Interfaces:**
- Consumes: `GET /api/reportes/modificacion-infracciones` and `GET /api/reportes/modificacion-infracciones/export` from Task 1, returning the exact field names and `COLUMN_HEADERS` label strings defined there.
- Produces: route `/reportes/modificacion-infracciones`, sidebar entry "Modificación de Infracciones".

- [ ] **Step 1: Create the model**

Create `apps/web/src/app/core/models/modificacion-infraccion.model.ts`:

```ts
export interface ModificacionInfraccionItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_infraccion_original: string | null;
  contravencion: string | null;
  observacion: string | null;
  codigo_infraccion_acta: string | null;
  codigo_usuario_modifica: string | null;
  numero_credito: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
}

export interface ModificacionInfraccionListResponse {
  items: ModificacionInfraccionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ModificacionInfraccionFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
```

- [ ] **Step 2: Create the service**

Create `apps/web/src/app/core/modificacion-infracciones.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ModificacionInfraccionFilters, ModificacionInfraccionListResponse } from './models/modificacion-infraccion.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: ModificacionInfraccionFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class ModificacionInfraccionesService {
  private readonly http = inject(HttpClient);

  listModificacionInfracciones(
    filters: ModificacionInfraccionFilters,
    page: number
  ): Observable<ModificacionInfraccionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<ModificacionInfraccionListResponse>(
      `${environment.apiUrl}/reportes/modificacion-infracciones`,
      { params }
    );
  }

  exportModificacionInfracciones(
    filters: ModificacionInfraccionFilters,
    formato: 'csv' | 'xlsx'
  ): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/modificacion-infracciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ModificacionInfraccionesComponent, COLUMNAS } from './modificacion-infracciones.component';
import { AuthService } from '../../../core/auth.service';
import { ModificacionInfraccionesService } from '../../../core/modificacion-infracciones.service';
import {
  ModificacionInfraccionItem,
  ModificacionInfraccionListResponse,
} from '../../../core/models/modificacion-infraccion.model';

describe('ModificacionInfraccionesComponent', () => {
  let fixture: ComponentFixture<ModificacionInfraccionesComponent>;
  let modificacionInfraccionesService: {
    listModificacionInfracciones: ReturnType<typeof vi.fn>;
    exportModificacionInfracciones: ReturnType<typeof vi.fn>;
  };

  const item: ModificacionInfraccionItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '11:20:00',
    codigo_infraccion_original: 'ORIG-001',
    contravencion: 'CONT-001',
    observacion: 'Observación de prueba',
    codigo_infraccion_acta: 'ACTA-001',
    codigo_usuario_modifica: 'USR-MOD-01',
    numero_credito: 'CRED-001',
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
  };

  const resultado: ModificacionInfraccionListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    modificacionInfraccionesService = {
      listModificacionInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportModificacionInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [ModificacionInfraccionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: ModificacionInfraccionesService, useValue: modificacionInfraccionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModificacionInfraccionesComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(modificacionInfraccionesService.listModificacionInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2031-06-15', fecha_hasta: '2031-07-05' },
      1
    );
  });

  it('blocks submit when fecha desde is after fecha hasta', () => {
    fillForm('2031-06-20', '2031-06-10');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('La fecha desde no puede ser posterior a la fecha hasta.');
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives, with all 10 columns in the defined order', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
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
      expect(headerTexts.length).toBe(10);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(10);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[5]).toBe('ACTA-001');
      expect(cellTexts[9]).toBe('2031-06-05');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay modificaciones de infracciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las modificaciones de infracciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(modificacionInfraccionesService.listModificacionInfracciones).toHaveBeenLastCalledWith(
      { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
      2
    );
  });

  describe('descargas', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('descarga CSV con los filtros vigentes', () => {
      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      csvButton.click();

      expect(modificacionInfraccionesService.exportModificacionInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(
        of({ items: [], total: 0, page: 1, page_size: 50 })
      );

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      expect(csvButton.disabled).toBe(true);
      expect(excelButton.disabled).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts"`
Expected: FAIL — `modificacion-infracciones.component.ts` doesn't exist yet.

- [ ] **Step 5: Create the component and template**

Create `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { ModificacionInfraccionesService } from '../../../core/modificacion-infracciones.service';
import {
  ModificacionInfraccionFilters,
  ModificacionInfraccionItem,
  ModificacionInfraccionListResponse,
} from '../../../core/models/modificacion-infraccion.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar las modificaciones de infracciones. Intenta de nuevo.';

export interface ColumnaModificacionInfraccion {
  clave: keyof ModificacionInfraccionItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaModificacionInfraccion[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_infraccion_original', encabezado: 'Código de la Infracción (Original)' },
  { clave: 'contravencion', encabezado: 'Contravención' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'codigo_infraccion_acta', encabezado: 'Código de la Infracción (Acta)' },
  { clave: 'codigo_usuario_modifica', encabezado: 'Código de Usuario que Modifica' },
  { clave: 'numero_credito', encabezado: 'Número de Crédito' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
];

@Component({
  selector: 'app-modificacion-infracciones',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './modificacion-infracciones.component.html',
})
export class ModificacionInfraccionesComponent {
  private readonly modificacionInfraccionesService = inject(ModificacionInfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<ModificacionInfraccionListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: ModificacionInfraccionFilters | null = null;

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
    this.rangeErrorSubject.next(null);
    return true;
  }

  buscar(): void {
    if (this.form.invalid) {
      return;
    }
    const { fechaDesde, fechaHasta } = this.form.getRawValue();
    if (!this.rangoValido(fechaDesde, fechaHasta)) {
      return;
    }
    this.filtrosVigentes = { fecha_desde: fechaDesde, fecha_hasta: fechaHasta };
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
    this.modificacionInfraccionesService.exportModificacionInfracciones(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: ModificacionInfraccionFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `modificacion-infracciones_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.modificacionInfraccionesService.listModificacionInfracciones(this.filtrosVigentes, page).subscribe({
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

Create `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.html`:

```html
<app-shell activeRoute="modificacion-infracciones">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Modificación de Infracciones</h2>
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
        <p class="p-md text-on-surface-variant text-body-sm">No hay modificaciones de infracciones para estos filtros</p>
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

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 7: Wire up the route**

In `apps/web/src/app/app.routes.ts`, change:

```ts
import { TitulosComponent } from './features/reportes/titulos/titulos.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

to:

```ts
import { TitulosComponent } from './features/reportes/titulos/titulos.component';
import { ModificacionInfraccionesComponent } from './features/reportes/modificacion-infracciones/modificacion-infracciones.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

and change:

```ts
  { path: 'reportes/titulos', component: TitulosComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

to:

```ts
  { path: 'reportes/titulos', component: TitulosComponent, canActivate: [authGuard] },
  { path: 'reportes/modificacion-infracciones', component: ModificacionInfraccionesComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

- [ ] **Step 8: Add the sidebar entry**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'titulos' | 'usuarios' | 'auditoria';
```

to:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'titulos' | 'modificacion-infracciones' | 'usuarios' | 'auditoria';
```

and change:

```ts
    if (
      this.activeRoute === 'impugnaciones' ||
      this.activeRoute === 'infracciones' ||
      this.activeRoute === 'juicios' ||
      this.activeRoute === 'pagos' ||
      this.activeRoute === 'titulos'
    ) {
      this.reportesExpanded = true;
    }
```

to:

```ts
    if (
      this.activeRoute === 'impugnaciones' ||
      this.activeRoute === 'infracciones' ||
      this.activeRoute === 'juicios' ||
      this.activeRoute === 'pagos' ||
      this.activeRoute === 'titulos' ||
      this.activeRoute === 'modificacion-infracciones'
    ) {
      this.reportesExpanded = true;
    }
```

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, change:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/titulos" [class]="navLinkClass('titulos')">
                  <span class="font-body-sm text-body-sm">Títulos de Crédito</span>
                </a>
              </li>
            </ul>
```

to:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/titulos" [class]="navLinkClass('titulos')">
                  <span class="font-body-sm text-body-sm">Títulos de Crédito</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/modificacion-infracciones" [class]="navLinkClass('modificacion-infracciones')">
                  <span class="font-body-sm text-body-sm">Modificación de Infracciones</span>
                </a>
              </li>
            </ul>
```

- [ ] **Step 9: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass. `app-shell.component.spec.ts` tests specific routes one at a time rather than enumerating the full `AppShellRoute` union, so adding `'modificacion-infracciones'` to the type does not require changes there.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/core/models/modificacion-infraccion.model.ts apps/web/src/app/core/modificacion-infracciones.service.ts apps/web/src/app/features/reportes/modificacion-infracciones apps/web/src/app/app.routes.ts apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html
git commit -m "feat(web): add Modificación de Infracciones report page"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: navigate to `/reportes/modificacion-infracciones`, confirm the sidebar entry, filter by date, confirm all 10 columns render with the official labels (including the two disambiguated "Código de la Infracción (Original)"/"(Acta)" columns), and download both CSV and XLSX to confirm they match the on-screen columns.
