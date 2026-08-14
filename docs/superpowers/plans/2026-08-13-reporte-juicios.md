# Reporte de Juicios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third report, Juicios, over the real read-only table `axis.axis_juicios`, following the exact same architecture as the existing Impugnaciones/Infracciones reports: paginated search, CSV/XLSX export, audit logging, and a sidebar entry.

**Architecture:** A new FastAPI router (`juicios.py`) exposes `GET /api/reportes/juicios` (paginated list) and `GET /api/reportes/juicios/export` (CSV/XLSX), both reading from a new SQLAlchemy Core table definition (`axis_juicios` in `axis_tables.py`, read-only, no ORM). A new Angular component (`JuiciosComponent`) mirrors `InfraccionesComponent`'s structure minus the estado filter (this report has no status column). New sidebar entry and audit-action-catalog entries wire it into the existing navigation and audit trail.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- No "Estado" filter or column — `axis.axis_juicios` has no status column, and none is derived from its lifecycle date columns in this version.
- Date-range filter is on `fecha_registro`, with only an order check (`fecha_desde <= fecha_hasta`) — no calendar-month restriction, consistent with the other two reports today.
- The list and export queries always exclude soft-deleted rows: `WHERE deleted_at IS NULL`.
- Exactly 26 named columns are shown/exported (`COLUMN_HEADERS`/`COLUMN_NAMES`, 26 entries) plus `id` handled separately (same pattern as the other two reports) = 27 columns total in list/export output, out of the table's 29 real columns. Excluded: `deleted_at` (internal, used only for the WHERE filter) and `tipo_identificacion_catalogo_item_id` (redundant with `tipo_identificacion`, which already carries "CED"/"RUC").
- `axis_juicios.identificacion` has a real foreign key to `axis.personas.identificacion` — any test that inserts a juicio row must first insert a matching persona row (same requirement Infracciones already has).
- `axis_juicios.tipo_identificacion_catalogo_item_id` has a real foreign key to `axis.catalogo_items.id` — real reference rows already exist in the shared dev database (`id=67` → "CED", `id=68` → "RUC"); tests use `67` directly, no new catalog rows need to be inserted.
- Audit actions: `reportes.juicios.search` (details: `fecha_desde`, `fecha_hasta`, `page`, `total` — no `estado` key), `reportes.juicios.export` (details: `fecha_desde`, `fecha_hasta`, `formato`, `filas_exportadas` — no `estado` key).
- List/export endpoints require only `require_active_user` (any authenticated user whose password isn't pending a mandatory change) — not admin-only, same as the other two reports.

---

### Task 1: Backend — table definition, schemas, list endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py`
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/routers/juicios.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_juicios_routes.py` (new)

**Interfaces:**
- Consumes: `require_active_user`, `get_client_ip` (from `app.routers.auth`), `registrar_evento` (from `app.audit`), `get_db` (from `app.database`).
- Produces: `axis_juicios` table object (importable as `from app.axis_tables import axis_juicios`). `JuicioItem`/`JuicioListResponse` schemas. `COLUMN_HEADERS`/`COLUMN_NAMES` (26 entries) and `_validate_date_range`/`_date_range_conditions` in `juicios.py`, consumed by Task 2's export endpoint in the same file.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_juicios_routes.py`:

```python
from datetime import date, time, timedelta

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


INSERT_PERSONA_SQL = text(
    """
    INSERT INTO axis.personas (identificacion, tipo_identificacion, nombre)
    VALUES (:identificacion, :tipo_identificacion, :nombre)
    ON CONFLICT (identificacion) DO NOTHING
    """
)

INSERT_SQL = text(
    """
    INSERT INTO axis.axis_juicios
        (registro, hora_generacion, codigo, tipo_identificacion, identificacion, nombre_completo,
         gestor_responsable, gestor_secretario, gestor_anulacion, gestor_suspension,
         gestor_reactivacion, motivo_anulacion, fecha_generacion, fecha_registro,
         fecha_inicio_juicio, fecha_notificacion, fecha_pago, fecha_fin, fecha_anulacion,
         fecha_suspension, fecha_reactivacion, valor_capital, valor_interes, valor_multas,
         valor_costas, valor_total, tipo_identificacion_catalogo_item_id)
    VALUES
        (:registro, :hora_generacion, :codigo, :tipo_identificacion, :identificacion, :nombre_completo,
         :gestor_responsable, :gestor_secretario, :gestor_anulacion, :gestor_suspension,
         :gestor_reactivacion, :motivo_anulacion, :fecha_generacion, :fecha_registro,
         :fecha_inicio_juicio, :fecha_notificacion, :fecha_pago, :fecha_fin, :fecha_anulacion,
         :fecha_suspension, :fecha_reactivacion, :valor_capital, :valor_interes, :valor_multas,
         :valor_costas, :valor_total, :tipo_identificacion_catalogo_item_id)
    RETURNING id
    """
)


def _row(registro, fecha_registro, identificacion="TEST-JUI-CED-0001", **overrides):
    base = {
        "registro": registro,
        "hora_generacion": time(10, 30, 0),
        "codigo": f"COD-{registro}",
        "tipo_identificacion": "CED",
        "identificacion": identificacion,
        "nombre_completo": "Deudor de Prueba",
        "gestor_responsable": "Gestor Responsable",
        "gestor_secretario": "Gestor Secretario",
        "gestor_anulacion": None,
        "gestor_suspension": None,
        "gestor_reactivacion": None,
        "motivo_anulacion": None,
        "fecha_generacion": fecha_registro,
        "fecha_registro": fecha_registro,
        "fecha_inicio_juicio": fecha_registro,
        "fecha_notificacion": fecha_registro,
        "fecha_pago": None,
        "fecha_fin": None,
        "fecha_anulacion": None,
        "fecha_suspension": None,
        "fecha_reactivacion": None,
        "valor_capital": Decimal("40.00"),
        "valor_interes": Decimal("0.48"),
        "valor_multas": Decimal("40.00"),
        "valor_costas": Decimal("30.63"),
        "valor_total": Decimal("80.48"),
        "tipo_identificacion_catalogo_item_id": 67,
    }
    base.update(overrides)
    return base


async def _seed_personas(db_session, identificaciones):
    for ident in identificaciones:
        await db_session.execute(
            INSERT_PERSONA_SQL,
            {"identificacion": ident, "tipo_identificacion": "CED", "nombre": f"Persona {ident}"},
        )
    await db_session.commit()


async def _seed_juicios(db_session, rows):
    personas = {row["identificacion"] for row in rows}
    await _seed_personas(db_session, personas)
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_juicios(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_juicios WHERE registro LIKE 'TEST-JUI-%'"))
    await db_session.execute(text("DELETE FROM axis.personas WHERE identificacion LIKE 'TEST-JUI-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(
        db_session,
        [
            _row("TEST-JUI-101", date(2031, 6, 5), identificacion="TEST-JUI-CED-0001"),
            _row("TEST-JUI-102", date(2031, 6, 15), identificacion="TEST-JUI-CED-0002"),
            _row("TEST-JUI-103", date(2031, 6, 25), identificacion="TEST-JUI-CED-0003"),
        ],
    )

    response = await client.get(
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-JUI-103", "TEST-JUI-102", "TEST-JUI-101"]
    first = body["items"][0]
    assert first["nombre_completo"] == "Deudor de Prueba"
    assert first["valor_total"] == 80.48
    assert "deleted_at" not in first
    assert "tipo_identificacion_catalogo_item_id" not in first


@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-06-15", "fecha_hasta": "2031-07-05"},
        headers=headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-06-20", "fecha_hasta": "2031-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(
        db_session,
        [
            _row("TEST-JUI-201", date(2031, 6, 5), identificacion="TEST-JUI-CED-0004"),
            _row("TEST-JUI-202", date(2031, 6, 6), identificacion="TEST-JUI-CED-0005"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_juicios SET deleted_at = now() WHERE registro = 'TEST-JUI-202'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-JUI-201"


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 5, 1)
    rows = [
        _row(f"TEST-JUI-p-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-JUI-CED-p{i:03d}")
        for i in range(55)
    ]
    await _seed_juicios(db_session, rows)

    response = await client.get(
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-05-01", "fecha_hasta": "2031-06-25", "page": 2},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 55
    assert body["page"] == 2
    assert len(body["items"]) == 5
    assert body["items"][0]["registro"] == "TEST-JUI-p-004"
    assert body["items"][-1]["registro"] == "TEST-JUI-p-000"


@pytest.mark.asyncio
async def test_list_out_of_range_page_returns_empty(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(db_session, [_row("TEST-JUI-301", date(2031, 6, 5))])

    response = await client.get(
        "/api/reportes/juicios",
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
        "/api/reportes/juicios",
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
        "/api/reportes/juicios",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v`
Expected: all FAIL with `404 Not Found` (the route doesn't exist yet) or import errors — this is expected, the router doesn't exist.

- [ ] **Step 3: Add the table definition**

In `apps/api/app/axis_tables.py`, change the import line:

```python
from sqlalchemy import BigInteger, Column, DateTime, MetaData, Numeric, Table, Text
```

to:

```python
from sqlalchemy import BigInteger, Column, Date, DateTime, Integer, MetaData, Numeric, Table, Text, Time
```

Then append at the end of the file (after `axis_infracciones`):

```python
axis_juicios = Table(
    "axis_juicios",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("codigo", Text),
    Column("tipo_identificacion", Text),
    Column("identificacion", Text),
    Column("nombre_completo", Text),
    Column("gestor_responsable", Text),
    Column("gestor_secretario", Text),
    Column("gestor_anulacion", Text),
    Column("gestor_suspension", Text),
    Column("gestor_reactivacion", Text),
    Column("motivo_anulacion", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_registro", Date),
    Column("fecha_inicio_juicio", Date),
    Column("fecha_notificacion", Date),
    Column("fecha_pago", Date),
    Column("fecha_fin", Date),
    Column("fecha_anulacion", Date),
    Column("fecha_suspension", Date),
    Column("fecha_reactivacion", Date),
    Column("valor_capital", Numeric(14, 2)),
    Column("valor_interes", Numeric(14, 2)),
    Column("valor_multas", Numeric(14, 2)),
    Column("valor_costas", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
    Column("tipo_identificacion_catalogo_item_id", Integer),
)
```

- [ ] **Step 4: Add the schemas**

In `apps/api/app/schemas.py`, change the top import line:

```python
from datetime import datetime
```

to:

```python
from datetime import date, datetime, time
```

Then append at the end of the file:

```python
class JuicioItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo: str | None
    tipo_identificacion: str | None
    identificacion: str | None
    nombre_completo: str | None
    gestor_responsable: str | None
    gestor_secretario: str | None
    gestor_anulacion: str | None
    gestor_suspension: str | None
    gestor_reactivacion: str | None
    motivo_anulacion: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_inicio_juicio: date | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_fin: date | None
    fecha_anulacion: date | None
    fecha_suspension: date | None
    fecha_reactivacion: date | None
    valor_capital: float | None
    valor_interes: float | None
    valor_multas: float | None
    valor_costas: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class JuicioListResponse(BaseModel):
    items: list[JuicioItem]
    total: int
    page: int
    page_size: int
```

- [ ] **Step 5: Create the router with the list endpoint**

Create `apps/api/app/routers/juicios.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import registrar_evento
from app.axis_tables import axis_juicios
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import JuicioItem, JuicioListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "codigo": "Código",
    "hora_generacion": "Hora de Generación",
    "tipo_identificacion": "Tipo de Identificación",
    "identificacion": "Identificación",
    "nombre_completo": "Nombre Completo",
    "gestor_responsable": "Gestor Responsable",
    "gestor_secretario": "Gestor Secretario",
    "gestor_anulacion": "Gestor de Anulación",
    "gestor_suspension": "Gestor de Suspensión",
    "gestor_reactivacion": "Gestor de Reactivación",
    "motivo_anulacion": "Motivo de Anulación",
    "fecha_generacion": "Fecha de Generación",
    "fecha_registro": "Fecha de Registro",
    "fecha_inicio_juicio": "Fecha de Inicio de Juicio",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_fin": "Fecha de Fin",
    "fecha_anulacion": "Fecha de Anulación",
    "fecha_suspension": "Fecha de Suspensión",
    "fecha_reactivacion": "Fecha de Reactivación",
    "valor_capital": "Valor Capital",
    "valor_interes": "Valor Interés",
    "valor_multas": "Valor Multas",
    "valor_costas": "Valor Costas",
    "valor_total": "Valor Total",
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
        axis_juicios.c.fecha_registro.between(fecha_desde, fecha_hasta),
        axis_juicios.c.deleted_at.is_(None),
    ]


@router.get("/juicios", response_model=JuicioListResponse)
async def list_juicios(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> JuicioListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_juicios).where(and_(*conditions)))

    columns = [axis_juicios.c.id] + [axis_juicios.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_juicios.c.fecha_registro.desc(), axis_juicios.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [JuicioItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.juicios.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return JuicioListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

- [ ] **Step 6: Register the router in `main.py`**

In `apps/api/app/main.py`, change:

```python
from app.routers.infracciones import router as infracciones_router
from app.routers.reportes import router as reportes_router
```

to:

```python
from app.routers.infracciones import router as infracciones_router
from app.routers.juicios import router as juicios_router
from app.routers.reportes import router as reportes_router
```

and change:

```python
app.include_router(auth_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(auditoria_router)
```

to:

```python
app.include_router(auth_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(juicios_router)
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v`
Expected: `8 passed`

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (a pre-existing, unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail independently of this change).

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/schemas.py apps/api/app/routers/juicios.py apps/api/app/main.py apps/api/tests/test_juicios_routes.py
git commit -m "feat(api): add GET /api/reportes/juicios search endpoint"
```

---

### Task 2: Backend — export endpoint

**Files:**
- Modify: `apps/api/app/routers/juicios.py`
- Test: `apps/api/tests/test_juicios_routes.py`

**Interfaces:**
- Consumes: `COLUMN_HEADERS`, `COLUMN_NAMES`, `_validate_date_range`, `_date_range_conditions` (Task 1, same file).
- Produces: `GET /api/reportes/juicios/export?fecha_desde=...&fecha_hasta=...&formato=csv|xlsx`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_juicios_routes.py`:

```python
import csv
import io

from openpyxl import load_workbook

EXPECTED_HEADERS = [
    "Registro",
    "Código",
    "Hora de Generación",
    "Tipo de Identificación",
    "Identificación",
    "Nombre Completo",
    "Gestor Responsable",
    "Gestor Secretario",
    "Gestor de Anulación",
    "Gestor de Suspensión",
    "Gestor de Reactivación",
    "Motivo de Anulación",
    "Fecha de Generación",
    "Fecha de Registro",
    "Fecha de Inicio de Juicio",
    "Fecha de Notificación",
    "Fecha de Pago",
    "Fecha de Fin",
    "Fecha de Anulación",
    "Fecha de Suspensión",
    "Fecha de Reactivación",
    "Valor Capital",
    "Valor Interés",
    "Valor Multas",
    "Valor Costas",
    "Valor Total",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 8, 1)
    rows = [
        _row(f"TEST-JUI-e-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-JUI-CED-e{i:03d}")
        for i in range(31)
    ]
    await _seed_juicios(db_session, rows)

    response = await client.get(
        "/api/reportes/juicios/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "juicios_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 26
    assert len(lines) - 1 == 31

    data_row = parsed_rows[1]
    assert len(data_row) == 26
    assert data_row[0].startswith("TEST-JUI-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 9, 1)
    rows = [
        _row(f"TEST-JUI-x-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-JUI-CED-x{i:03d}")
        for i in range(30)
    ]
    await _seed_juicios(db_session, rows)

    response = await client.get(
        "/api/reportes/juicios/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "juicios_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 27)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 30

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 27)]
    assert data_row[0].startswith("TEST-JUI-x-")


@pytest.mark.asyncio
async def test_export_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(
        db_session,
        [
            _row("TEST-JUI-501", date(2031, 6, 5), identificacion="TEST-JUI-CED-0006"),
            _row("TEST-JUI-502", date(2031, 6, 6), identificacion="TEST-JUI-CED-0007"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_juicios SET deleted_at = now() WHERE registro = 'TEST-JUI-502'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/juicios/export",
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
        "/api/reportes/juicios/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -k export -v`
Expected: all FAIL with `404 Not Found` (the export route doesn't exist yet).

- [ ] **Step 3: Add the export endpoint**

In `apps/api/app/routers/juicios.py`, replace the entire top import block (everything before `router = APIRouter(...)`) with:

```python
import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from openpyxl import Workbook
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.audit import registrar_evento
from app.axis_tables import axis_juicios
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import JuicioItem, JuicioListResponse
```

Then append at the end of the file:

```python
def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/juicios/export")
async def export_juicios(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [axis_juicios.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_juicios.c.fecha_registro.desc(), axis_juicios.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"juicios_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.juicios.export",
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

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v`
Expected: `12 passed`

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (aside from the pre-existing unrelated flake).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routers/juicios.py apps/api/tests/test_juicios_routes.py
git commit -m "feat(api): add GET /api/reportes/juicios/export endpoint"
```

---

### Task 3: Frontend — model and service

**Files:**
- Create: `apps/web/src/app/core/models/juicio.model.ts`
- Create: `apps/web/src/app/core/juicios.service.ts`
- Test: `apps/web/src/app/core/juicios.service.spec.ts` (new)

**Interfaces:**
- Produces: `JuicioItem`, `JuicioListResponse`, `JuicioFilters` (in `juicio.model.ts`); `JuiciosService.listJuicios(filters, page)`, `JuiciosService.exportJuicios(filters, formato)` (in `juicios.service.ts`), consumed by Task 5's component.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/juicios.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { JuiciosService } from './juicios.service';
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { environment } from '../../environments/environment';

describe('JuiciosService', () => {
  let service: JuiciosService;
  let httpMock: HttpTestingController;

  const filters: JuicioFilters = { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [JuiciosService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(JuiciosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists juicios with fecha_desde, fecha_hasta and page params', () => {
    const resultado: JuicioListResponse = { items: [], total: 0, page: 1, page_size: 50 };

    service.listJuicios(filters, 1).subscribe((res) => expect(res).toEqual(resultado));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/juicios`
    );
    expect(req.request.params.get('fecha_desde')).toBe('2031-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2031-06-30');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(resultado);
  });

  it('exports juicios as a blob with the formato param', () => {
    const blob = new Blob(['data']);

    service.exportJuicios(filters, 'xlsx').subscribe((res) => expect(res).toEqual(blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/juicios/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/juicios.service.spec.ts"`
Expected: FAIL — `Cannot find module './juicios.service'`

- [ ] **Step 3: Create the model**

Create `apps/web/src/app/core/models/juicio.model.ts`:

```ts
export interface JuicioItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo: string | null;
  tipo_identificacion: string | null;
  identificacion: string | null;
  nombre_completo: string | null;
  gestor_responsable: string | null;
  gestor_secretario: string | null;
  gestor_anulacion: string | null;
  gestor_suspension: string | null;
  gestor_reactivacion: string | null;
  motivo_anulacion: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_inicio_juicio: string | null;
  fecha_notificacion: string | null;
  fecha_pago: string | null;
  fecha_fin: string | null;
  fecha_anulacion: string | null;
  fecha_suspension: string | null;
  fecha_reactivacion: string | null;
  valor_capital: number | null;
  valor_interes: number | null;
  valor_multas: number | null;
  valor_costas: number | null;
  valor_total: number | null;
}

export interface JuicioListResponse {
  items: JuicioItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface JuicioFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
```

- [ ] **Step 4: Create the service**

Create `apps/web/src/app/core/juicios.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: JuicioFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class JuiciosService {
  private readonly http = inject(HttpClient);

  listJuicios(filters: JuicioFilters, page: number): Observable<JuicioListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<JuicioListResponse>(`${environment.apiUrl}/reportes/juicios`, { params });
  }

  exportJuicios(filters: JuicioFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/juicios/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/juicios.service.spec.ts"`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/core/models/juicio.model.ts apps/web/src/app/core/juicios.service.ts apps/web/src/app/core/juicios.service.spec.ts
git commit -m "feat(web): add JuicioItem model and JuiciosService"
```

---

### Task 4: Frontend — sidebar entry

**Files:**
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`
- Test: `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`

**Interfaces:**
- Produces: `AppShellRoute` gains `'juicios'` as a valid value, consumed by Task 5's component (`activeRoute="juicios"`).

- [ ] **Step 1: Write the failing tests**

Append to the `describe('submenu de Reportes', ...)` block in `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`:

```ts
    it('shows the Juicios link once the Reportes submenu is expanded', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="reportes-toggle"]');
      toggle.click();
      fixture.detectChanges();

      const juiciosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/juicios"]'
      );
      expect(juiciosLink).not.toBeNull();
    });

    it('auto-expands and highlights Juicios when activeRoute is juicios', () => {
      createComponent('juicios');

      const juiciosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/juicios"]'
      );
      expect(juiciosLink).not.toBeNull();
      expect(juiciosLink!.classList.contains('text-secondary-fixed-dim')).toBe(true);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: FAIL — `'juicios'` is not assignable to type `AppShellRoute` (compile error), and the link can't be found.

- [ ] **Step 3: Add `'juicios'` to the route type and auto-expand condition**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'usuarios' | 'auditoria';
```

to:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'usuarios' | 'auditoria';
```

and change:

```ts
    if (this.activeRoute === 'impugnaciones' || this.activeRoute === 'infracciones') {
      this.reportesExpanded = true;
    }
```

to:

```ts
    if (this.activeRoute === 'impugnaciones' || this.activeRoute === 'infracciones' || this.activeRoute === 'juicios') {
      this.reportesExpanded = true;
    }
```

- [ ] **Step 4: Add the nav link**

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, change:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/infracciones" [class]="navLinkClass('infracciones')">
                  <span class="font-body-sm text-body-sm">Infracciones</span>
                </a>
              </li>
            </ul>
```

to:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/infracciones" [class]="navLinkClass('infracciones')">
                  <span class="font-body-sm text-body-sm">Infracciones</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/juicios" [class]="navLinkClass('juicios')">
                  <span class="font-body-sm text-body-sm">Juicios</span>
                </a>
              </li>
            </ul>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/shared/app-shell/app-shell.component.spec.ts"`
Expected: `14 passed`

- [ ] **Step 6: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html apps/web/src/app/shared/app-shell/app-shell.component.spec.ts
git commit -m "feat(web): add Juicios entry to the Reportes sidebar submenu"
```

---

### Task 5: Frontend — JuiciosComponent, route, and audit catalog

**Files:**
- Create: `apps/web/src/app/features/reportes/juicios/juicios.component.ts`
- Create: `apps/web/src/app/features/reportes/juicios/juicios.component.html`
- Create: `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/features/auditoria/auditoria.component.ts`

**Interfaces:**
- Consumes: `JuiciosService` (Task 3), `AppShellComponent` with `activeRoute="juicios"` (Task 4).

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { JuiciosComponent, COLUMNAS } from './juicios.component';
import { AuthService } from '../../../core/auth.service';
import { JuiciosService } from '../../../core/juicios.service';
import { JuicioItem, JuicioListResponse } from '../../../core/models/juicio.model';

describe('JuiciosComponent', () => {
  let fixture: ComponentFixture<JuiciosComponent>;
  let juiciosService: {
    listJuicios: ReturnType<typeof vi.fn>;
    exportJuicios: ReturnType<typeof vi.fn>;
  };

  const item: JuicioItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '10:30:00',
    codigo: 'COD-001',
    tipo_identificacion: 'CED',
    identificacion: '1103456789',
    nombre_completo: 'Deudor de Prueba',
    gestor_responsable: 'Gestor Responsable',
    gestor_secretario: 'Gestor Secretario',
    gestor_anulacion: null,
    gestor_suspension: null,
    gestor_reactivacion: null,
    motivo_anulacion: null,
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_inicio_juicio: '2031-06-05',
    fecha_notificacion: '2031-06-05',
    fecha_pago: null,
    fecha_fin: null,
    fecha_anulacion: null,
    fecha_suspension: null,
    fecha_reactivacion: null,
    valor_capital: 40,
    valor_interes: 0.48,
    valor_multas: 40,
    valor_costas: 30.63,
    valor_total: 80.48,
  };

  const resultado: JuicioListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    juiciosService = {
      listJuicios: vi.fn().mockReturnValue(of(resultado)),
      exportJuicios: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [JuiciosComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: JuiciosService, useValue: juiciosService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JuiciosComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(juiciosService.listJuicios).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 26 columns in the defined order', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(26);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(26);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[25]).toBe('80.48');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay juicios para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los juicios. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    juiciosService.listJuicios.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(juiciosService.listJuicios).toHaveBeenLastCalledWith(
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

      expect(juiciosService.exportJuicios).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      juiciosService.listJuicios.mockReturnValue(
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: FAIL — `Cannot find module './juicios.component'`

- [ ] **Step 3: Create the component**

Create `apps/web/src/app/features/reportes/juicios/juicios.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { JuiciosService } from '../../../core/juicios.service';
import { JuicioFilters, JuicioItem, JuicioListResponse } from '../../../core/models/juicio.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los juicios. Intenta de nuevo.';

export interface ColumnaJuicio {
  clave: keyof JuicioItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaJuicio[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'codigo', encabezado: 'Código' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación' },
  { clave: 'tipo_identificacion', encabezado: 'Tipo de Identificación' },
  { clave: 'identificacion', encabezado: 'Identificación' },
  { clave: 'nombre_completo', encabezado: 'Nombre Completo' },
  { clave: 'gestor_responsable', encabezado: 'Gestor Responsable' },
  { clave: 'gestor_secretario', encabezado: 'Gestor Secretario' },
  { clave: 'gestor_anulacion', encabezado: 'Gestor de Anulación' },
  { clave: 'gestor_suspension', encabezado: 'Gestor de Suspensión' },
  { clave: 'gestor_reactivacion', encabezado: 'Gestor de Reactivación' },
  { clave: 'motivo_anulacion', encabezado: 'Motivo de Anulación' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_inicio_juicio', encabezado: 'Fecha de Inicio de Juicio' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_fin', encabezado: 'Fecha de Fin' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'fecha_suspension', encabezado: 'Fecha de Suspensión' },
  { clave: 'fecha_reactivacion', encabezado: 'Fecha de Reactivación' },
  { clave: 'valor_capital', encabezado: 'Valor Capital' },
  { clave: 'valor_interes', encabezado: 'Valor Interés' },
  { clave: 'valor_multas', encabezado: 'Valor Multas' },
  { clave: 'valor_costas', encabezado: 'Valor Costas' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
];

@Component({
  selector: 'app-juicios',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './juicios.component.html',
})
export class JuiciosComponent {
  private readonly juiciosService = inject(JuiciosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<JuicioListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: JuicioFilters | null = null;

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
    this.juiciosService.exportJuicios(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: JuicioFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `juicios_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.juiciosService.listJuicios(this.filtrosVigentes, page).subscribe({
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

Create `apps/web/src/app/features/reportes/juicios/juicios.component.html`:

```html
<app-shell activeRoute="juicios">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Juicios</h2>
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
        <p class="p-md text-on-surface-variant text-body-sm">No hay juicios para estos filtros</p>
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: `8 passed`

- [ ] **Step 6: Add the route**

In `apps/web/src/app/app.routes.ts`, add the import:

```ts
import { JuiciosComponent } from './features/reportes/juicios/juicios.component';
```

and add this route (after the `reportes/infracciones` route):

```ts
  { path: 'reportes/juicios', component: JuiciosComponent, canActivate: [authGuard] },
```

- [ ] **Step 7: Add the audit-action catalog entries**

In `apps/web/src/app/features/auditoria/auditoria.component.ts`, change:

```ts
  { value: 'reportes.infracciones.search', label: 'Búsqueda de infracciones' },
  { value: 'reportes.infracciones.export', label: 'Descarga de infracciones' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];
```

to:

```ts
  { value: 'reportes.infracciones.search', label: 'Búsqueda de infracciones' },
  { value: 'reportes.infracciones.export', label: 'Descarga de infracciones' },
  { value: 'reportes.juicios.search', label: 'Búsqueda de juicios' },
  { value: 'reportes.juicios.export', label: 'Descarga de juicios' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];
```

No `detalle()` switch case is added for these two actions — `reportes.infracciones.search`/`.export` don't have one either (they fall back to the `default: return '—';` case), so this matches the existing, accepted level of completeness for that pattern rather than introducing an inconsistency.

- [ ] **Step 8: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/features/reportes/juicios apps/web/src/app/app.routes.ts apps/web/src/app/features/auditoria/auditoria.component.ts
git commit -m "feat(web): add JuiciosComponent, route, and audit catalog entries"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: log in, expand the Reportes submenu, click Juicios, search a date range, confirm the table renders with 26 columns, download CSV and XLSX, confirm both open correctly and match the row count shown on screen.
