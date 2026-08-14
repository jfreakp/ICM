# Reporte de Pagos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth report, Pagos, over the real read-only table `axis.axis_pagos`, following the exact same architecture as Impugnaciones/Infracciones/Juicios: paginated search, CSV/XLSX export, audit logging, and a sidebar entry.

**Architecture:** A new FastAPI router (`pagos.py`) exposes `GET /api/reportes/pagos` (paginated list) and `GET /api/reportes/pagos/export` (CSV/XLSX), reading from `axis_pagos` — a table already partially defined (minimally, for the Dashboard feature) in `axis_tables.py`, which this plan upgrades to its full real column set. A new Angular component (`PagosComponent`) mirrors `JuiciosComponent`'s structure (no estado filter). New sidebar entry and audit-action-catalog entries wire it into existing navigation and the audit trail.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- No "Estado" filter or column — `axis.axis_pagos` has no status column.
- Date-range filter is on `fecha_transaccion` (a `timestamp` column, not `date` — requires `cast(..., Date).between(...)`, same technique `infracciones.py` already uses for its own `timestamp`-typed date-range column), with only an order check (`fecha_desde <= fecha_hasta`) — no calendar-month restriction.
- The list and export queries always exclude soft-deleted rows: `WHERE deleted_at IS NULL`.
- Exactly 15 named columns are shown/exported (`COLUMN_HEADERS`/`COLUMN_NAMES`) plus `id` handled separately = 16 columns total in list/export output, out of the table's 20 real columns. Excluded: `deleted_at` (internal) and the 3 `*_catalogo_item_id` columns (`tipo_documento_catalogo_item_id`, `tipo_recaudador_catalogo_item_id`, `tipo_servicio_catalogo_item_id` — redundant with `tipo_documento`/`tipo_recaudador`/`tipo_servicio`, which already carry the readable text value).
- `axis.axis_pagos` has NO foreign key to `axis.personas` — unlike Juicios/Títulos, tests do not need to seed any related table.
- `axis_pagos` already has a **minimal** table definition in `axis_tables.py` (`id`, `deleted_at` only), added by the Dashboard feature. This plan replaces it with the full 20-column definition — a purely additive change (the Dashboard's `GET /api/dashboard/resumen` endpoint only ever references `id`/`deleted_at`, both still present, so it keeps working unchanged).
- Audit actions: `reportes.pagos.search` (details: `fecha_desde`, `fecha_hasta`, `page`, `total`), `reportes.pagos.export` (details: `fecha_desde`, `fecha_hasta`, `formato`, `filas_exportadas`).
- List/export endpoints require only `require_active_user` — not admin-only.

---

### Task 1: Backend — table definition, schemas, list endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py`
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/routers/pagos.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_pagos_routes.py` (new)

**Interfaces:**
- Consumes: `require_active_user`, `get_client_ip` (from `app.routers.auth`), `registrar_evento` (from `app.audit`), `get_db` (from `app.database`).
- Produces: full `axis_pagos` table object (importable as `from app.axis_tables import axis_pagos`). `PagoItem`/`PagoListResponse` schemas. `COLUMN_HEADERS`/`COLUMN_NAMES` (15 entries) and `_validate_date_range`/`_date_range_conditions` in `pagos.py`, consumed by Task 2's export endpoint in the same file.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_pagos_routes.py`:

```python
from datetime import date, datetime, time

import pytest
import pytest_asyncio
from decimal import Decimal
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
    INSERT INTO axis.axis_pagos
        (registro, hora_generacion, tipo_recaudador, recaudador, comprobante_pago_interno,
         comprobante_pago_recaudador, tipo_servicio, tipo_documento, numero_documento,
         fecha_generacion, fecha_operacion, fecha_transaccion, monto_recaudado,
         monto_cuenta_1, monto_cuenta_2)
    VALUES
        (:registro, :hora_generacion, :tipo_recaudador, :recaudador, :comprobante_pago_interno,
         :comprobante_pago_recaudador, :tipo_servicio, :tipo_documento, :numero_documento,
         :fecha_generacion, :fecha_operacion, :fecha_transaccion, :monto_recaudado,
         :monto_cuenta_1, :monto_cuenta_2)
    RETURNING id
    """
)


def _row(registro, fecha_transaccion, **overrides):
    base = {
        "registro": registro,
        "hora_generacion": time(10, 30, 0),
        "tipo_recaudador": "BAP",
        "recaudador": "BANCO DEL PACIFICO",
        "comprobante_pago_interno": f"INT-{registro}",
        "comprobante_pago_recaudador": f"REC-{registro}",
        "tipo_servicio": "CDP",
        "tipo_documento": "CON",
        "numero_documento": f"DOC-{registro}",
        "fecha_generacion": fecha_transaccion.date(),
        "fecha_operacion": fecha_transaccion,
        "fecha_transaccion": fecha_transaccion,
        "monto_recaudado": Decimal("119.00"),
        "monto_cuenta_1": Decimal("119.00"),
        "monto_cuenta_2": Decimal("0.00"),
    }
    base.update(overrides)
    return base


async def _seed_pagos(db_session, rows):
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_pagos(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_pagos WHERE registro LIKE 'TEST-PAG-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(
        db_session,
        [
            _row("TEST-PAG-101", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-PAG-102", datetime(2031, 6, 15, 9, 0, 0)),
            _row("TEST-PAG-103", datetime(2031, 6, 25, 9, 0, 0)),
        ],
    )

    response = await client.get(
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-PAG-103", "TEST-PAG-102", "TEST-PAG-101"]
    first = body["items"][0]
    assert first["recaudador"] == "BANCO DEL PACIFICO"
    assert first["monto_recaudado"] == 119.0
    assert "deleted_at" not in first
    assert "tipo_documento_catalogo_item_id" not in first


@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-15", "fecha_hasta": "2031-07-05"},
        headers=headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-20", "fecha_hasta": "2031-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(
        db_session,
        [
            _row("TEST-PAG-201", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-PAG-202", datetime(2031, 6, 6, 9, 0, 0)),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_pagos SET deleted_at = now() WHERE registro = 'TEST-PAG-202'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-PAG-201"


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 5, 1, 8, 0, 0)
    rows = [_row(f"TEST-PAG-p-{i:03d}", base.replace(day=1 + i % 28)) for i in range(55)]
    await _seed_pagos(db_session, rows)

    response = await client.get(
        "/api/reportes/pagos",
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
    await _seed_pagos(db_session, [_row("TEST-PAG-301", datetime(2031, 6, 5, 9, 0, 0))])

    response = await client.get(
        "/api/reportes/pagos",
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
        "/api/reportes/pagos",
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
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
```

Note: `test_list_pagination_page_two_offset` uses `base.replace(day=1 + i % 28)` (28-day wrap, staying within May/June 2031) purely to get 55 distinct-enough timestamps without crossing into July — the exact day distribution doesn't matter for this test since it only checks `total`/`page`/`items` length, not specific ordering (unlike Task 1's other tests, which do check exact `registro` order).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: all FAIL — `404 Not Found` (the route doesn't exist yet) or a column-mismatch error from `INSERT_SQL` (the real table has more columns than the current minimal `axis_pagos` definition expects, but this raw-SQL insert doesn't go through that Python object, so it should fail with 404 from the missing route, not a DB error).

- [ ] **Step 3: Replace the minimal table definition with the full one**

In `apps/api/app/axis_tables.py`, the import line currently reads:

```python
from sqlalchemy import BigInteger, Column, Date, DateTime, Integer, MetaData, Numeric, Table, Text, Time
```

Leave it as-is — every type this task needs (`BigInteger`, `Column`, `Date`, `DateTime`, `Integer`, `Numeric`, `Table`, `Text`, `Time`) is already imported.

Replace:

```python
axis_pagos = Table(
    "axis_pagos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)
```

with:

```python
axis_pagos = Table(
    "axis_pagos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("tipo_recaudador", Text),
    Column("recaudador", Text),
    Column("comprobante_pago_interno", Text),
    Column("comprobante_pago_recaudador", Text),
    Column("tipo_servicio", Text),
    Column("tipo_documento", Text),
    Column("numero_documento", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_operacion", DateTime),
    Column("fecha_transaccion", DateTime),
    Column("monto_recaudado", Numeric(14, 2)),
    Column("monto_cuenta_1", Numeric(14, 2)),
    Column("monto_cuenta_2", Numeric(14, 2)),
    Column("tipo_documento_catalogo_item_id", Integer),
    Column("tipo_recaudador_catalogo_item_id", Integer),
    Column("tipo_servicio_catalogo_item_id", Integer),
)
```

- [ ] **Step 4: Add the schemas**

Append at the end of `apps/api/app/schemas.py`:

```python
class PagoItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    tipo_recaudador: str | None
    recaudador: str | None
    comprobante_pago_interno: str | None
    comprobante_pago_recaudador: str | None
    tipo_servicio: str | None
    tipo_documento: str | None
    numero_documento: str | None
    fecha_generacion: date | None
    fecha_operacion: datetime | None
    fecha_transaccion: datetime | None
    monto_recaudado: float | None
    monto_cuenta_1: float | None
    monto_cuenta_2: float | None

    model_config = {"from_attributes": True}


class PagoListResponse(BaseModel):
    items: list[PagoItem]
    total: int
    page: int
    page_size: int
```

`date`, `datetime`, and `time` are already imported at the top of `schemas.py` (`from datetime import date, datetime, time`, added when the Juicios report was built) — no import changes needed here.

- [ ] **Step 5: Create the router with the list endpoint**

Create `apps/api/app/routers/pagos.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import registrar_evento
from app.axis_tables import axis_pagos
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import PagoItem, PagoListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación",
    "tipo_recaudador": "Tipo de Recaudador",
    "recaudador": "Recaudador",
    "comprobante_pago_interno": "Comprobante de Pago Interno",
    "comprobante_pago_recaudador": "Comprobante de Pago del Recaudador",
    "tipo_servicio": "Tipo de Servicio",
    "tipo_documento": "Tipo de Documento",
    "numero_documento": "Número de Documento",
    "fecha_generacion": "Fecha de Generación",
    "fecha_operacion": "Fecha de Operación",
    "fecha_transaccion": "Fecha de Transacción",
    "monto_recaudado": "Monto Recaudado",
    "monto_cuenta_1": "Monto Cuenta 1",
    "monto_cuenta_2": "Monto Cuenta 2",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date):
    return [
        cast(axis_pagos.c.fecha_transaccion, Date).between(fecha_desde, fecha_hasta),
        axis_pagos.c.deleted_at.is_(None),
    ]


@router.get("/pagos", response_model=PagoListResponse)
async def list_pagos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> PagoListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_pagos).where(and_(*conditions)))

    columns = [axis_pagos.c.id] + [axis_pagos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_pagos.c.fecha_transaccion.desc(), axis_pagos.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [PagoItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.pagos.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return PagoListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

- [ ] **Step 6: Register the router in `main.py`**

In `apps/api/app/main.py`, change:

```python
from app.routers.dashboard import router as dashboard_router
from app.routers.infracciones import router as infracciones_router
from app.routers.juicios import router as juicios_router
from app.routers.reportes import router as reportes_router
```

to:

```python
from app.routers.dashboard import router as dashboard_router
from app.routers.infracciones import router as infracciones_router
from app.routers.juicios import router as juicios_router
from app.routers.pagos import router as pagos_router
from app.routers.reportes import router as reportes_router
```

and change:

```python
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(juicios_router)
app.include_router(auditoria_router)
```

to:

```python
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(juicios_router)
app.include_router(pagos_router)
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: `8 passed`

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (a pre-existing, unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail independently of this change). Run this alone, not concurrently with any other pytest process against the same local dev database, or you may see unrelated spurious `InvalidRequestError: Could not refresh instance` failures — a known false-positive from concurrent `TRUNCATE TABLE app.users` cleanup, not a real regression.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/schemas.py apps/api/app/routers/pagos.py apps/api/app/main.py apps/api/tests/test_pagos_routes.py
git commit -m "feat(api): add GET /api/reportes/pagos search endpoint"
```

---

### Task 2: Backend — export endpoint

**Files:**
- Modify: `apps/api/app/routers/pagos.py`
- Test: `apps/api/tests/test_pagos_routes.py`

**Interfaces:**
- Consumes: `COLUMN_HEADERS`, `COLUMN_NAMES`, `_validate_date_range`, `_date_range_conditions` (Task 1, same file).
- Produces: `GET /api/reportes/pagos/export?fecha_desde=...&fecha_hasta=...&formato=csv|xlsx`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_pagos_routes.py`:

```python
import csv
import io

from openpyxl import load_workbook

EXPECTED_HEADERS = [
    "Registro",
    "Hora de Generación",
    "Tipo de Recaudador",
    "Recaudador",
    "Comprobante de Pago Interno",
    "Comprobante de Pago del Recaudador",
    "Tipo de Servicio",
    "Tipo de Documento",
    "Número de Documento",
    "Fecha de Generación",
    "Fecha de Operación",
    "Fecha de Transacción",
    "Monto Recaudado",
    "Monto Cuenta 1",
    "Monto Cuenta 2",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-PAG-e-{i:03d}", datetime(2031, 8, 1 + i, 9, 0, 0))
        for i in range(28)
    ]
    await _seed_pagos(db_session, rows)

    response = await client.get(
        "/api/reportes/pagos/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "pagos_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 15
    assert len(lines) - 1 == 28

    data_row = parsed_rows[1]
    assert len(data_row) == 15
    assert data_row[0].startswith("TEST-PAG-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-PAG-x-{i:03d}", datetime(2031, 9, 1 + i, 9, 0, 0))
        for i in range(29)
    ]
    await _seed_pagos(db_session, rows)

    response = await client.get(
        "/api/reportes/pagos/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "pagos_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 16)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 29

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 16)]
    assert data_row[0].startswith("TEST-PAG-x-")


@pytest.mark.asyncio
async def test_export_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(
        db_session,
        [
            _row("TEST-PAG-501", datetime(2031, 6, 5, 9, 0, 0)),
            _row("TEST-PAG-502", datetime(2031, 6, 6, 9, 0, 0)),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_pagos SET deleted_at = now() WHERE registro = 'TEST-PAG-502'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/pagos/export",
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
        "/api/reportes/pagos/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -k export -v`
Expected: all FAIL with `404 Not Found` (the export route doesn't exist yet).

- [ ] **Step 3: Add the export endpoint**

In `apps/api/app/routers/pagos.py`, replace the entire top import block (everything before `router = APIRouter(...)`) with:

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
from app.axis_tables import axis_pagos
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import PagoItem, PagoListResponse
```

Then append at the end of the file:

```python
def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/pagos/export")
async def export_pagos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [axis_pagos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_pagos.c.fecha_transaccion.desc(), axis_pagos.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"pagos_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.pagos.export",
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: `12 passed`

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (aside from the pre-existing unrelated flake; run alone per the concurrency note in Task 1).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routers/pagos.py apps/api/tests/test_pagos_routes.py
git commit -m "feat(api): add GET /api/reportes/pagos/export endpoint"
```

---

### Task 3: Frontend — model and service

**Files:**
- Create: `apps/web/src/app/core/models/pago.model.ts`
- Create: `apps/web/src/app/core/pagos.service.ts`
- Test: `apps/web/src/app/core/pagos.service.spec.ts` (new)

**Interfaces:**
- Produces: `PagoItem`, `PagoListResponse`, `PagoFilters` (in `pago.model.ts`); `PagosService.listPagos(filters, page)`, `PagosService.exportPagos(filters, formato)` (in `pagos.service.ts`), consumed by Task 5's component.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/pagos.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PagosService } from './pagos.service';
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { environment } from '../../environments/environment';

describe('PagosService', () => {
  let service: PagosService;
  let httpMock: HttpTestingController;

  const filters: PagoFilters = { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PagosService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PagosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists pagos with fecha_desde, fecha_hasta and page params', () => {
    const resultado: PagoListResponse = { items: [], total: 0, page: 1, page_size: 50 };

    service.listPagos(filters, 1).subscribe((res) => expect(res).toEqual(resultado));

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/pagos`);
    expect(req.request.params.get('fecha_desde')).toBe('2031-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2031-06-30');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(resultado);
  });

  it('exports pagos as a blob with the formato param', () => {
    const blob = new Blob(['data']);

    service.exportPagos(filters, 'xlsx').subscribe((res) => expect(res).toEqual(blob));

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/pagos/export`);
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/pagos.service.spec.ts"`
Expected: FAIL — `Cannot find module './pagos.service'`

- [ ] **Step 3: Create the model**

Create `apps/web/src/app/core/models/pago.model.ts`:

```ts
export interface PagoItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  tipo_recaudador: string | null;
  recaudador: string | null;
  comprobante_pago_interno: string | null;
  comprobante_pago_recaudador: string | null;
  tipo_servicio: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  fecha_generacion: string | null;
  fecha_operacion: string | null;
  fecha_transaccion: string | null;
  monto_recaudado: number | null;
  monto_cuenta_1: number | null;
  monto_cuenta_2: number | null;
}

export interface PagoListResponse {
  items: PagoItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface PagoFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
```

- [ ] **Step 4: Create the service**

Create `apps/web/src/app/core/pagos.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: PagoFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class PagosService {
  private readonly http = inject(HttpClient);

  listPagos(filters: PagoFilters, page: number): Observable<PagoListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<PagoListResponse>(`${environment.apiUrl}/reportes/pagos`, { params });
  }

  exportPagos(filters: PagoFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/pagos/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/pagos.service.spec.ts"`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/core/models/pago.model.ts apps/web/src/app/core/pagos.service.ts apps/web/src/app/core/pagos.service.spec.ts
git commit -m "feat(web): add PagoItem model and PagosService"
```

---

### Task 4: Frontend — sidebar entry

**Files:**
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`
- Test: `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`

**Interfaces:**
- Produces: `AppShellRoute` gains `'pagos'` as a valid value, consumed by Task 5's component (`activeRoute="pagos"`).

- [ ] **Step 1: Write the failing tests**

Append to the `describe('submenu de Reportes', ...)` block in `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`:

```ts
    it('shows the Pagos link once the Reportes submenu is expanded', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="reportes-toggle"]');
      toggle.click();
      fixture.detectChanges();

      const pagosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/pagos"]'
      );
      expect(pagosLink).not.toBeNull();
    });

    it('auto-expands and highlights Pagos when activeRoute is pagos', () => {
      createComponent('pagos');

      const pagosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/pagos"]'
      );
      expect(pagosLink).not.toBeNull();
      expect(pagosLink!.classList.contains('text-secondary-fixed-dim')).toBe(true);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: FAIL — `'pagos'` is not assignable to type `AppShellRoute` (compile error), and the link can't be found.

- [ ] **Step 3: Add `'pagos'` to the route type and auto-expand condition**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'usuarios' | 'auditoria';
```

to:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'usuarios' | 'auditoria';
```

and change:

```ts
    if (this.activeRoute === 'impugnaciones' || this.activeRoute === 'infracciones' || this.activeRoute === 'juicios') {
      this.reportesExpanded = true;
    }
```

to:

```ts
    if (
      this.activeRoute === 'impugnaciones' ||
      this.activeRoute === 'infracciones' ||
      this.activeRoute === 'juicios' ||
      this.activeRoute === 'pagos'
    ) {
      this.reportesExpanded = true;
    }
```

- [ ] **Step 4: Add the nav link**

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, change:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/juicios" [class]="navLinkClass('juicios')">
                  <span class="font-body-sm text-body-sm">Juicios</span>
                </a>
              </li>
            </ul>
```

to:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/juicios" [class]="navLinkClass('juicios')">
                  <span class="font-body-sm text-body-sm">Juicios</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/pagos" [class]="navLinkClass('pagos')">
                  <span class="font-body-sm text-body-sm">Pagos</span>
                </a>
              </li>
            </ul>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: `16 passed`

- [ ] **Step 6: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html apps/web/src/app/shared/app-shell/app-shell.component.spec.ts
git commit -m "feat(web): add Pagos entry to the Reportes sidebar submenu"
```

---

### Task 5: Frontend — PagosComponent, route, and audit catalog

**Files:**
- Create: `apps/web/src/app/features/reportes/pagos/pagos.component.ts`
- Create: `apps/web/src/app/features/reportes/pagos/pagos.component.html`
- Create: `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/features/auditoria/auditoria.component.ts`

**Interfaces:**
- Consumes: `PagosService` (Task 3), `AppShellComponent` with `activeRoute="pagos"` (Task 4).

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { PagosComponent, COLUMNAS } from './pagos.component';
import { AuthService } from '../../../core/auth.service';
import { PagosService } from '../../../core/pagos.service';
import { PagoItem, PagoListResponse } from '../../../core/models/pago.model';

describe('PagosComponent', () => {
  let fixture: ComponentFixture<PagosComponent>;
  let pagosService: {
    listPagos: ReturnType<typeof vi.fn>;
    exportPagos: ReturnType<typeof vi.fn>;
  };

  const item: PagoItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '10:30:00',
    tipo_recaudador: 'BAP',
    recaudador: 'BANCO DEL PACIFICO',
    comprobante_pago_interno: 'INT-001',
    comprobante_pago_recaudador: 'REC-001',
    tipo_servicio: 'CDP',
    tipo_documento: 'CON',
    numero_documento: 'DOC-001',
    fecha_generacion: '2031-06-05',
    fecha_operacion: '2031-06-05T09:00:00',
    fecha_transaccion: '2031-06-05T09:00:00',
    monto_recaudado: 119,
    monto_cuenta_1: 119,
    monto_cuenta_2: 0,
  };

  const resultado: PagoListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    pagosService = {
      listPagos: vi.fn().mockReturnValue(of(resultado)),
      exportPagos: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [PagosComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: PagosService, useValue: pagosService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PagosComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(pagosService.listPagos).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 15 columns in the defined order', async () => {
      const resultado$ = new Subject<PagoListResponse>();
      pagosService.listPagos.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(15);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(15);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[3]).toBe('BANCO DEL PACIFICO');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<PagoListResponse>();
      pagosService.listPagos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay pagos para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<PagoListResponse>();
      pagosService.listPagos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los pagos. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    pagosService.listPagos.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(pagosService.listPagos).toHaveBeenLastCalledWith(
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

      expect(pagosService.exportPagos).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      pagosService.listPagos.mockReturnValue(
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: FAIL — `Cannot find module './pagos.component'`

- [ ] **Step 3: Create the component**

Create `apps/web/src/app/features/reportes/pagos/pagos.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { PagosService } from '../../../core/pagos.service';
import { PagoFilters, PagoItem, PagoListResponse } from '../../../core/models/pago.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los pagos. Intenta de nuevo.';

export interface ColumnaPago {
  clave: keyof PagoItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaPago[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación' },
  { clave: 'tipo_recaudador', encabezado: 'Tipo de Recaudador' },
  { clave: 'recaudador', encabezado: 'Recaudador' },
  { clave: 'comprobante_pago_interno', encabezado: 'Comprobante de Pago Interno' },
  { clave: 'comprobante_pago_recaudador', encabezado: 'Comprobante de Pago del Recaudador' },
  { clave: 'tipo_servicio', encabezado: 'Tipo de Servicio' },
  { clave: 'tipo_documento', encabezado: 'Tipo de Documento' },
  { clave: 'numero_documento', encabezado: 'Número de Documento' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación' },
  { clave: 'fecha_operacion', encabezado: 'Fecha de Operación' },
  { clave: 'fecha_transaccion', encabezado: 'Fecha de Transacción' },
  { clave: 'monto_recaudado', encabezado: 'Monto Recaudado' },
  { clave: 'monto_cuenta_1', encabezado: 'Monto Cuenta 1' },
  { clave: 'monto_cuenta_2', encabezado: 'Monto Cuenta 2' },
];

@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './pagos.component.html',
})
export class PagosComponent {
  private readonly pagosService = inject(PagosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<PagoListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: PagoFilters | null = null;

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
    this.pagosService.exportPagos(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: PagoFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `pagos_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.pagosService.listPagos(this.filtrosVigentes, page).subscribe({
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

- [ ] **Step 4: Create the template**

Create `apps/web/src/app/features/reportes/pagos/pagos.component.html`:

```html
<app-shell activeRoute="pagos">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Pagos</h2>
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
        <p class="p-md text-on-surface-variant text-body-sm">No hay pagos para estos filtros</p>
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

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: `8 passed`

- [ ] **Step 6: Add the route**

In `apps/web/src/app/app.routes.ts`, add the import:

```ts
import { PagosComponent } from './features/reportes/pagos/pagos.component';
```

and add this route (after the `reportes/juicios` route):

```ts
  { path: 'reportes/pagos', component: PagosComponent, canActivate: [authGuard] },
```

- [ ] **Step 7: Add the audit-action catalog entries**

In `apps/web/src/app/features/auditoria/auditoria.component.ts`, change:

```ts
  { value: 'reportes.juicios.search', label: 'Búsqueda de juicios' },
  { value: 'reportes.juicios.export', label: 'Descarga de juicios' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];
```

to:

```ts
  { value: 'reportes.juicios.search', label: 'Búsqueda de juicios' },
  { value: 'reportes.juicios.export', label: 'Descarga de juicios' },
  { value: 'reportes.pagos.search', label: 'Búsqueda de pagos' },
  { value: 'reportes.pagos.export', label: 'Descarga de pagos' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];
```

No `detalle()` switch case is added for these two actions — same accepted level of completeness as Infracciones/Juicios (they fall back to `default: return '—';`).

- [ ] **Step 8: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/features/reportes/pagos apps/web/src/app/app.routes.ts apps/web/src/app/features/auditoria/auditoria.component.ts
git commit -m "feat(web): add PagosComponent, route, and audit catalog entries"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: log in, expand the Reportes submenu, click Pagos, search a date range, confirm the table renders with 15 columns, download CSV and XLSX.
- [ ] Confirm the Dashboard's "Pagos" card still shows the correct total (unaffected by the `axis_pagos` table definition upgrade).
