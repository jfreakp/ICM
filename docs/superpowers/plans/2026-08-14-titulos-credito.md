# Reporte de Títulos de Crédito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete new report for `axis_titulos` (filters, paginated table, CSV/Excel export), showing 100% of its real columns (except `id` and `deleted_at`) with the official AXIS Cloud/Yoveri labels, mirroring the existing Juicios report exactly.

**Architecture:** Same file layout and pattern as the Juicios report: a FastAPI router under `/api/reportes/titulos` (+ `/export`), a `TituloItem`/`TituloListResponse` Pydantic schema, and an Angular `TitulosComponent` (filters + table + downloads) wired into the app's routes and the "Reportes" sidebar submenu.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Show/export all 29 real columns of `axis_titulos` except `id` and `deleted_at` (`deleted_at` is excluded from every report per this session's standing rule; `id` was never displayed in any report).
- Use the exact official labels from the AXIS Cloud/Yoveri field-description document, listed in the spec — do not paraphrase.
- No date truncation needed anywhere in this report: every `fecha_*` column in the real `axis_titulos` table is already `date` (not `timestamp`), and `hora_generacion` is already `time`.
- Date-range filter is on `fecha_registro`. Exclude soft-deleted rows (`deleted_at IS NULL`). No estado filter. Order by `fecha_registro DESC, id DESC`. Page size 50 — all matching the Juicios report exactly.
- No join to `catalogo_items` for the three `*_catalogo_item_id` columns — show the raw numeric ID, labeled `"ID de Catálogo (<concepto>)"`.
- `identificacion` has a real foreign key to `axis.personas.identificacion` — any test row that sets a value for it must first seed a matching persona.

---

### Task 1: Backend — Títulos de Crédito report endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py:216-221` (replace the minimal `axis_titulos` Table with the full real column set)
- Create: `apps/api/app/routers/titulos.py`
- Modify: `apps/api/app/schemas.py` (add `TituloItem`, `TituloListResponse`)
- Modify: `apps/api/app/main.py` (register the new router)
- Create: `apps/api/tests/test_titulos_routes.py`

**Interfaces:**
- Consumes: none (self-contained; independent of Task 2).
- Produces: `GET /api/reportes/titulos` and `GET /api/reportes/titulos/export`, both requiring auth via `require_active_user` (same dependency as every other report router). `TituloItem` has 30 fields (`id` + 29 named). Frontend (Task 2) consumes these exact field names and the exact `COLUMN_HEADERS` label strings below.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_titulos_routes.py`:

```python
import csv
import io
from datetime import date, time, timedelta

import pytest
import pytest_asyncio
from decimal import Decimal
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


INSERT_PERSONA_SQL = text(
    """
    INSERT INTO axis.personas (identificacion, tipo_identificacion, nombre)
    VALUES (:identificacion, :tipo_identificacion, :nombre)
    ON CONFLICT (identificacion) DO NOTHING
    """
)

INSERT_SQL = text(
    """
    INSERT INTO axis.axis_titulos
        (registro, hora_generacion, codigo_titulo_credito, tipo_identificacion, identificacion,
         nombre_completo, etapa_cobranza, estado, codigo_referencia, concepto,
         nombre_elabora_titulo, nombre_solicita, nombre_aprobacion, motivo_anulacion,
         fecha_generacion, fecha_registro, fecha_elaboracion, fecha_solicitud, fecha_aprobacion,
         fecha_notificacion, fecha_pago, fecha_anulacion, valor, multas, interes, valor_total,
         estado_catalogo_item_id, etapa_cobranza_catalogo_item_id, tipo_identificacion_catalogo_item_id)
    VALUES
        (:registro, :hora_generacion, :codigo_titulo_credito, :tipo_identificacion, :identificacion,
         :nombre_completo, :etapa_cobranza, :estado, :codigo_referencia, :concepto,
         :nombre_elabora_titulo, :nombre_solicita, :nombre_aprobacion, :motivo_anulacion,
         :fecha_generacion, :fecha_registro, :fecha_elaboracion, :fecha_solicitud, :fecha_aprobacion,
         :fecha_notificacion, :fecha_pago, :fecha_anulacion, :valor, :multas, :interes, :valor_total,
         :estado_catalogo_item_id, :etapa_cobranza_catalogo_item_id, :tipo_identificacion_catalogo_item_id)
    RETURNING id
    """
)


def _row(registro, fecha_registro, identificacion="TEST-TIT-CED-0001", **overrides):
    base = {
        "registro": registro,
        "hora_generacion": time(9, 15, 0),
        "codigo_titulo_credito": f"TC-{registro}",
        "tipo_identificacion": "CED",
        "identificacion": identificacion,
        "nombre_completo": "Deudor de Prueba",
        "etapa_cobranza": "NOTIFICACION",
        "estado": "ACTIVO",
        "codigo_referencia": "REF-001",
        "concepto": "Concepto de prueba",
        "nombre_elabora_titulo": "Elaborador de Prueba",
        "nombre_solicita": "Solicitante de Prueba",
        "nombre_aprobacion": "Aprobador de Prueba",
        "motivo_anulacion": None,
        "fecha_generacion": fecha_registro,
        "fecha_registro": fecha_registro,
        "fecha_elaboracion": fecha_registro,
        "fecha_solicitud": fecha_registro,
        "fecha_aprobacion": None,
        "fecha_notificacion": None,
        "fecha_pago": None,
        "fecha_anulacion": None,
        "valor": Decimal("150.00"),
        "multas": Decimal("10.00"),
        "interes": Decimal("2.50"),
        "valor_total": Decimal("162.50"),
        "estado_catalogo_item_id": 12,
        "etapa_cobranza_catalogo_item_id": 5,
        "tipo_identificacion_catalogo_item_id": 3,
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


async def _seed_titulos(db_session, rows):
    personas = {row["identificacion"] for row in rows}
    await _seed_personas(db_session, personas)
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_titulos(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_titulos WHERE registro LIKE 'TEST-TIT-%'"))
    await db_session.execute(text("DELETE FROM axis.personas WHERE identificacion LIKE 'TEST-TIT-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(
        db_session,
        [
            _row("TEST-TIT-101", date(2031, 6, 5), identificacion="TEST-TIT-CED-0001"),
            _row("TEST-TIT-102", date(2031, 6, 15), identificacion="TEST-TIT-CED-0002"),
            _row("TEST-TIT-103", date(2031, 6, 25), identificacion="TEST-TIT-CED-0003"),
        ],
    )

    response = await client.get(
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-TIT-103", "TEST-TIT-102", "TEST-TIT-101"]
    first = body["items"][0]
    assert first["nombre_completo"] == "Deudor de Prueba"
    assert first["valor_total"] == 162.5
    assert first["estado_catalogo_item_id"] == 12
    assert first["fecha_registro"] == "2031-06-25"


@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-06-15", "fecha_hasta": "2031-07-05"},
        headers=headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-06-20", "fecha_hasta": "2031-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(
        db_session,
        [
            _row("TEST-TIT-201", date(2031, 6, 5), identificacion="TEST-TIT-CED-0004"),
            _row("TEST-TIT-202", date(2031, 6, 6), identificacion="TEST-TIT-CED-0005"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_titulos SET deleted_at = now() WHERE registro = 'TEST-TIT-202'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-TIT-201"


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 5, 1)
    rows = [
        _row(f"TEST-TIT-p-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-TIT-CED-p{i:03d}")
        for i in range(55)
    ]
    await _seed_titulos(db_session, rows)

    response = await client.get(
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-05-01", "fecha_hasta": "2031-06-25", "page": 2},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 55
    assert body["page"] == 2
    assert len(body["items"]) == 5
    assert body["items"][0]["registro"] == "TEST-TIT-p-004"
    assert body["items"][-1]["registro"] == "TEST-TIT-p-000"


@pytest.mark.asyncio
async def test_list_out_of_range_page_returns_empty(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(db_session, [_row("TEST-TIT-301", date(2031, 6, 5))])

    response = await client.get(
        "/api/reportes/titulos",
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
        "/api/reportes/titulos",
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
        "/api/reportes/titulos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"


EXPECTED_HEADERS = [
    "Registro",
    "Hora de Generación del Registro",
    "Código Título Crédito",
    "Tipo de Identificación",
    "Identificación",
    "Nombre Completo",
    "Etapa Cobranza",
    "Estado",
    "Código de Referencia",
    "Concepto",
    "Nombre Elabora Título de Crédito",
    "Nombre que Solicita",
    "Nombre de Aprobación",
    "Motivo de Anulación",
    "Fecha de Generación del Registro",
    "Fecha de Registro",
    "Fecha de Elaboración",
    "Fecha de Solicitud",
    "Fecha de Aprobación",
    "Fecha de Notificación",
    "Fecha de Pago",
    "Fecha de Anulación",
    "Valor",
    "Multas",
    "Interés",
    "Valor Total",
    "ID de Catálogo (Estado)",
    "ID de Catálogo (Etapa de Cobranza)",
    "ID de Catálogo (Tipo de Identificación)",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 8, 1)
    rows = [
        _row(f"TEST-TIT-e-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-TIT-CED-e{i:03d}")
        for i in range(31)
    ]
    await _seed_titulos(db_session, rows)

    response = await client.get(
        "/api/reportes/titulos/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "titulos_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 29
    assert len(lines) - 1 == 31

    data_row = parsed_rows[1]
    assert len(data_row) == 29
    assert data_row[0].startswith("TEST-TIT-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = date(2031, 9, 1)
    rows = [
        _row(f"TEST-TIT-x-{i:03d}", base + timedelta(days=i), identificacion=f"TEST-TIT-CED-x{i:03d}")
        for i in range(30)
    ]
    await _seed_titulos(db_session, rows)

    response = await client.get(
        "/api/reportes/titulos/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "titulos_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 30)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 30

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 30)]
    assert data_row[0].startswith("TEST-TIT-x-")


@pytest.mark.asyncio
async def test_export_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(
        db_session,
        [
            _row("TEST-TIT-501", date(2031, 6, 5), identificacion="TEST-TIT-CED-0006"),
            _row("TEST-TIT-502", date(2031, 6, 6), identificacion="TEST-TIT-CED-0007"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_titulos SET deleted_at = now() WHERE registro = 'TEST-TIT-502'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/titulos/export",
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
        "/api/reportes/titulos/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_titulos_routes.py -v`
Expected: FAIL — `ModuleNotFoundError` or `404` for `/api/reportes/titulos` (the router doesn't exist yet) and `KeyError`/insert errors for the columns not yet on the `axis_titulos` Table object.

- [ ] **Step 3: Extend the `axis_titulos` Table definition**

In `apps/api/app/axis_tables.py`, change:

```python
axis_titulos = Table(
    "axis_titulos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)
```

to:

```python
axis_titulos = Table(
    "axis_titulos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("codigo_titulo_credito", Text),
    Column("tipo_identificacion", Text),
    Column("identificacion", Text),
    Column("nombre_completo", Text),
    Column("etapa_cobranza", Text),
    Column("estado", Text),
    Column("codigo_referencia", Text),
    Column("concepto", Text),
    Column("nombre_elabora_titulo", Text),
    Column("nombre_solicita", Text),
    Column("nombre_aprobacion", Text),
    Column("motivo_anulacion", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_registro", Date),
    Column("fecha_elaboracion", Date),
    Column("fecha_solicitud", Date),
    Column("fecha_aprobacion", Date),
    Column("fecha_notificacion", Date),
    Column("fecha_pago", Date),
    Column("fecha_anulacion", Date),
    Column("valor", Numeric(14, 2)),
    Column("multas", Numeric(14, 2)),
    Column("interes", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
    Column("estado_catalogo_item_id", Integer),
    Column("etapa_cobranza_catalogo_item_id", Integer),
    Column("tipo_identificacion_catalogo_item_id", Integer),
)
```

All of `BigInteger`, `Column`, `Date`, `DateTime`, `Integer`, `Numeric`, `Table`, `Text`, `Time` are already imported at the top of the file.

- [ ] **Step 4: Add the schema**

In `apps/api/app/schemas.py`, add after the `PagoListResponse` class (end of file):

```python
class TituloItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_titulo_credito: str | None
    tipo_identificacion: str | None
    identificacion: str | None
    nombre_completo: str | None
    etapa_cobranza: str | None
    estado: str | None
    codigo_referencia: str | None
    concepto: str | None
    nombre_elabora_titulo: str | None
    nombre_solicita: str | None
    nombre_aprobacion: str | None
    motivo_anulacion: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_elaboracion: date | None
    fecha_solicitud: date | None
    fecha_aprobacion: date | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_anulacion: date | None
    valor: float | None
    multas: float | None
    interes: float | None
    valor_total: float | None
    estado_catalogo_item_id: int | None
    etapa_cobranza_catalogo_item_id: int | None
    tipo_identificacion_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class TituloListResponse(BaseModel):
    items: list[TituloItem]
    total: int
    page: int
    page_size: int
```

`date` and `time` are already imported at the top of `schemas.py`.

- [ ] **Step 5: Create the router**

Create `apps/api/app/routers/titulos.py`:

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
from app.axis_tables import axis_titulos
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import TituloItem, TituloListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_titulo_credito": "Código Título Crédito",
    "tipo_identificacion": "Tipo de Identificación",
    "identificacion": "Identificación",
    "nombre_completo": "Nombre Completo",
    "etapa_cobranza": "Etapa Cobranza",
    "estado": "Estado",
    "codigo_referencia": "Código de Referencia",
    "concepto": "Concepto",
    "nombre_elabora_titulo": "Nombre Elabora Título de Crédito",
    "nombre_solicita": "Nombre que Solicita",
    "nombre_aprobacion": "Nombre de Aprobación",
    "motivo_anulacion": "Motivo de Anulación",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_elaboracion": "Fecha de Elaboración",
    "fecha_solicitud": "Fecha de Solicitud",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_anulacion": "Fecha de Anulación",
    "valor": "Valor",
    "multas": "Multas",
    "interes": "Interés",
    "valor_total": "Valor Total",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "etapa_cobranza_catalogo_item_id": "ID de Catálogo (Etapa de Cobranza)",
    "tipo_identificacion_catalogo_item_id": "ID de Catálogo (Tipo de Identificación)",
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
        axis_titulos.c.fecha_registro.between(fecha_desde, fecha_hasta),
        axis_titulos.c.deleted_at.is_(None),
    ]


@router.get("/titulos", response_model=TituloListResponse)
async def list_titulos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> TituloListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_titulos).where(and_(*conditions)))

    columns = [axis_titulos.c.id] + [axis_titulos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_titulos.c.fecha_registro.desc(), axis_titulos.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [TituloItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.titulos.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return TituloListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/titulos/export")
async def export_titulos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [axis_titulos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_titulos.c.fecha_registro.desc(), axis_titulos.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"titulos_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.titulos.export",
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
from app.routers.pagos import router as pagos_router
from app.routers.reportes import router as reportes_router
```

to:

```python
from app.routers.pagos import router as pagos_router
from app.routers.reportes import router as reportes_router
from app.routers.titulos import router as titulos_router
```

and change:

```python
app.include_router(juicios_router)
app.include_router(pagos_router)
app.include_router(auditoria_router)
```

to:

```python
app.include_router(juicios_router)
app.include_router(pagos_router)
app.include_router(titulos_router)
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_titulos_routes.py -v`
Expected: all 13 tests pass.

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone — check `ps aux | grep pytest` first; no concurrent run against the shared local DB. A pre-existing unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail on its own — not your concern.)
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/routers/titulos.py apps/api/app/schemas.py apps/api/app/main.py apps/api/tests/test_titulos_routes.py
git commit -m "feat(api): add Títulos de Crédito report endpoint"
```

---

### Task 2: Frontend — Títulos de Crédito page

**Files:**
- Create: `apps/web/src/app/core/models/titulo.model.ts`
- Create: `apps/web/src/app/core/titulos.service.ts`
- Create: `apps/web/src/app/features/reportes/titulos/titulos.component.ts`
- Create: `apps/web/src/app/features/reportes/titulos/titulos.component.html`
- Create: `apps/web/src/app/features/reportes/titulos/titulos.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`

**Interfaces:**
- Consumes: `GET /api/reportes/titulos` and `GET /api/reportes/titulos/export` from Task 1, returning the exact field names and `COLUMN_HEADERS` label strings defined there.
- Produces: route `/reportes/titulos`, sidebar entry "Títulos de Crédito".

- [ ] **Step 1: Create the model**

Create `apps/web/src/app/core/models/titulo.model.ts`:

```ts
export interface TituloItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_titulo_credito: string | null;
  tipo_identificacion: string | null;
  identificacion: string | null;
  nombre_completo: string | null;
  etapa_cobranza: string | null;
  estado: string | null;
  codigo_referencia: string | null;
  concepto: string | null;
  nombre_elabora_titulo: string | null;
  nombre_solicita: string | null;
  nombre_aprobacion: string | null;
  motivo_anulacion: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_elaboracion: string | null;
  fecha_solicitud: string | null;
  fecha_aprobacion: string | null;
  fecha_notificacion: string | null;
  fecha_pago: string | null;
  fecha_anulacion: string | null;
  valor: number | null;
  multas: number | null;
  interes: number | null;
  valor_total: number | null;
  estado_catalogo_item_id: number | null;
  etapa_cobranza_catalogo_item_id: number | null;
  tipo_identificacion_catalogo_item_id: number | null;
}

export interface TituloListResponse {
  items: TituloItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface TituloFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
```

- [ ] **Step 2: Create the service**

Create `apps/web/src/app/core/titulos.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TituloFilters, TituloListResponse } from './models/titulo.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: TituloFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class TitulosService {
  private readonly http = inject(HttpClient);

  listTitulos(filters: TituloFilters, page: number): Observable<TituloListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<TituloListResponse>(`${environment.apiUrl}/reportes/titulos`, { params });
  }

  exportTitulos(filters: TituloFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/titulos/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/src/app/features/reportes/titulos/titulos.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { TitulosComponent, COLUMNAS } from './titulos.component';
import { AuthService } from '../../../core/auth.service';
import { TitulosService } from '../../../core/titulos.service';
import { TituloItem, TituloListResponse } from '../../../core/models/titulo.model';

describe('TitulosComponent', () => {
  let fixture: ComponentFixture<TitulosComponent>;
  let titulosService: {
    listTitulos: ReturnType<typeof vi.fn>;
    exportTitulos: ReturnType<typeof vi.fn>;
  };

  const item: TituloItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '09:15:00',
    codigo_titulo_credito: 'TC-001',
    tipo_identificacion: 'CED',
    identificacion: '1103456789',
    nombre_completo: 'Deudor de Prueba',
    etapa_cobranza: 'NOTIFICACION',
    estado: 'ACTIVO',
    codigo_referencia: 'REF-001',
    concepto: 'Concepto de prueba',
    nombre_elabora_titulo: 'Elaborador de Prueba',
    nombre_solicita: 'Solicitante de Prueba',
    nombre_aprobacion: 'Aprobador de Prueba',
    motivo_anulacion: null,
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_elaboracion: '2031-06-05',
    fecha_solicitud: '2031-06-05',
    fecha_aprobacion: null,
    fecha_notificacion: null,
    fecha_pago: null,
    fecha_anulacion: null,
    valor: 150,
    multas: 10,
    interes: 2.5,
    valor_total: 162.5,
    estado_catalogo_item_id: 12,
    etapa_cobranza_catalogo_item_id: 5,
    tipo_identificacion_catalogo_item_id: 3,
  };

  const resultado: TituloListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    titulosService = {
      listTitulos: vi.fn().mockReturnValue(of(resultado)),
      exportTitulos: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [TitulosComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: TitulosService, useValue: titulosService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TitulosComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(titulosService.listTitulos).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 29 columns in the defined order', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(29);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(29);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[25]).toBe('162.5');
      expect(cellTexts[26]).toBe('12');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay títulos de crédito para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los títulos de crédito. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    titulosService.listTitulos.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(titulosService.listTitulos).toHaveBeenLastCalledWith(
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

      expect(titulosService.exportTitulos).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      titulosService.listTitulos.mockReturnValue(
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/titulos/titulos.component.spec.ts"`
Expected: FAIL — `titulos.component.ts` doesn't exist yet.

- [ ] **Step 5: Create the component and template**

Create `apps/web/src/app/features/reportes/titulos/titulos.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { TitulosService } from '../../../core/titulos.service';
import { TituloFilters, TituloItem, TituloListResponse } from '../../../core/models/titulo.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los títulos de crédito. Intenta de nuevo.';

export interface ColumnaTitulo {
  clave: keyof TituloItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaTitulo[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_titulo_credito', encabezado: 'Código Título Crédito' },
  { clave: 'tipo_identificacion', encabezado: 'Tipo de Identificación' },
  { clave: 'identificacion', encabezado: 'Identificación' },
  { clave: 'nombre_completo', encabezado: 'Nombre Completo' },
  { clave: 'etapa_cobranza', encabezado: 'Etapa Cobranza' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_referencia', encabezado: 'Código de Referencia' },
  { clave: 'concepto', encabezado: 'Concepto' },
  { clave: 'nombre_elabora_titulo', encabezado: 'Nombre Elabora Título de Crédito' },
  { clave: 'nombre_solicita', encabezado: 'Nombre que Solicita' },
  { clave: 'nombre_aprobacion', encabezado: 'Nombre de Aprobación' },
  { clave: 'motivo_anulacion', encabezado: 'Motivo de Anulación' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_elaboracion', encabezado: 'Fecha de Elaboración' },
  { clave: 'fecha_solicitud', encabezado: 'Fecha de Solicitud' },
  { clave: 'fecha_aprobacion', encabezado: 'Fecha de Aprobación' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'valor', encabezado: 'Valor' },
  { clave: 'multas', encabezado: 'Multas' },
  { clave: 'interes', encabezado: 'Interés' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'etapa_cobranza_catalogo_item_id', encabezado: 'ID de Catálogo (Etapa de Cobranza)' },
  { clave: 'tipo_identificacion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación)' },
];

@Component({
  selector: 'app-titulos',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './titulos.component.html',
})
export class TitulosComponent {
  private readonly titulosService = inject(TitulosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<TituloListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: TituloFilters | null = null;

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
    this.titulosService.exportTitulos(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: TituloFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `titulos_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.titulosService.listTitulos(this.filtrosVigentes, page).subscribe({
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

Create `apps/web/src/app/features/reportes/titulos/titulos.component.html`:

```html
<app-shell activeRoute="titulos">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Títulos de Crédito</h2>
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
        <p class="p-md text-on-surface-variant text-body-sm">No hay títulos de crédito para estos filtros</p>
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/titulos/titulos.component.spec.ts"`
Expected: all pass.

- [ ] **Step 7: Wire up the route**

In `apps/web/src/app/app.routes.ts`, change:

```ts
import { PagosComponent } from './features/reportes/pagos/pagos.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

to:

```ts
import { PagosComponent } from './features/reportes/pagos/pagos.component';
import { TitulosComponent } from './features/reportes/titulos/titulos.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

and change:

```ts
  { path: 'reportes/pagos', component: PagosComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

to:

```ts
  { path: 'reportes/pagos', component: PagosComponent, canActivate: [authGuard] },
  { path: 'reportes/titulos', component: TitulosComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

- [ ] **Step 8: Add the sidebar entry**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'usuarios' | 'auditoria';
```

to:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'titulos' | 'usuarios' | 'auditoria';
```

and change:

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

to:

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

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, change:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/pagos" [class]="navLinkClass('pagos')">
                  <span class="font-body-sm text-body-sm">Pagos</span>
                </a>
```

to:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/pagos" [class]="navLinkClass('pagos')">
                  <span class="font-body-sm text-body-sm">Pagos</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/titulos" [class]="navLinkClass('titulos')">
                  <span class="font-body-sm text-body-sm">Títulos de Crédito</span>
                </a>
```

(Check the exact closing tag right after "Pagos" in the current file before applying — the `</li>` that used to close the Pagos entry must now sit right after the new Títulos `</a>` instead, since the edit above inserts a new `<li>` in between.)

- [ ] **Step 9: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass. `app-shell.component.spec.ts` tests specific routes one at a time (`impugnaciones`, `infracciones`, `juicios`, `pagos`) rather than enumerating the full `AppShellRoute` union, so adding `'titulos'` to the type does not require changes there.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/core/models/titulo.model.ts apps/web/src/app/core/titulos.service.ts apps/web/src/app/features/reportes/titulos apps/web/src/app/app.routes.ts apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html
git commit -m "feat(web): add Títulos de Crédito report page"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: navigate to `/reportes/titulos`, confirm the sidebar entry, filter by date, confirm all 29 columns render with the official labels, and download both CSV and XLSX to confirm they match the on-screen columns.
