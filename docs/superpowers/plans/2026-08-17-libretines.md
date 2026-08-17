# Reporte de Libretines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete new report for `axis_libretines` (filters, paginated table, CSV/Excel export), showing 100% of its real columns (except `id` and `deleted_at`) with the official AXIS Cloud/Yoveri labels, combining the `_select_column`/`DATE_ONLY_COLUMNS` truncation pattern (CRV, this time with three real `timestamp` columns) with the persona-seeding pattern (Juicios/Infracciones/CRV).

**Architecture:** A FastAPI router under `/api/reportes/libretines` (+ `/export`) that truncates `fecha_registro`, `fecha_asignacion`, and `fecha_inactivacion` to date-only via `cast(column, Date)`, a `LibretinItem`/`LibretinListResponse` Pydantic schema, and an Angular `LibretinesComponent` (filters + table + downloads) wired into the app's routes and the "Reportes" sidebar submenu. Unlike CRV, this table already has `fecha_registro`, so it plays the same filter/sort role it plays in every other report.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- `axis_libretines` has NO definition at all in `axis_tables.py` today — not even the minimal `id`+`deleted_at` used by other tables for the Dashboard, because the user explicitly excluded it from the Dashboard earlier this session. Task 1 creates the full Table definition from scratch.
- Show/export all 40 real named columns of `axis_libretines` (`id` and `deleted_at` are excluded from every report per this session's standing rule).
- `fecha_registro`, `fecha_asignacion`, and `fecha_inactivacion` are real `timestamp` columns — select all three via `cast(column, Date).label(name)` (same pattern as `reportes.py`/`infracciones.py`/`pagos.py`/`modificacion_infracciones.py`/`crv.py`) and type all three schema fields `date`, not `datetime`. `fecha_generacion` is already `date` and `hora_generacion` is already `time` — neither needs truncation.
- `cantidad_boletas`, `disponibles`, `utilizadas`, and `desactivadas` are real `text` columns in the database, not numeric — type all four `str | None` in the schema.
- Date-range filter is on `fecha_registro` (this table has it, unlike CRV), truncated to date via `cast(..., Date).between(...)`. Exclude soft-deleted rows (`deleted_at IS NULL`). No estado filter (the `estado` column exists but is not used as a filter, same as Juicios/Pagos). Order by the full-precision `fecha_registro DESC, id DESC`. Page size 50.
- `identificacion_agente` has a real foreign key to `axis.personas.identificacion` — any test that sets a value for it must first seed a matching persona (same pattern already used for Juicios/Infracciones/CRV).
- `codigo_localidad_catalogo_item_id`, `codigo_provincia_catalogo_item_id`, `estado_catalogo_item_id`, and `tipo_catalogo_item_id` have real FKs to `axis.catalogo_items` — no join, show the raw numeric ID, labeled `"ID de Catálogo (<concepto>)"`.
- Labels are used exactly as they appear in the official AXIS Cloud/Yoveri document, including where they read slightly differently across tables (e.g. `fecha_asignacion` → "Fecha Asignación", no "de" — literal to the source, unlike `fecha_registro` → "Fecha de Registro", which matches the label already established for this same column in every other report).

---

### Task 1: Backend — Libretines report endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py` (add the new `axis_libretines` Table at the end of the file)
- Create: `apps/api/app/routers/libretines.py`
- Modify: `apps/api/app/schemas.py` (add `LibretinItem`, `LibretinListResponse`)
- Modify: `apps/api/app/main.py` (register the new router)
- Create: `apps/api/tests/test_libretines_routes.py`

**Interfaces:**
- Consumes: none (self-contained).
- Produces: `GET /api/reportes/libretines` and `GET /api/reportes/libretines/export`, both requiring auth via `require_active_user`. `LibretinItem` has 41 fields (`id` + 40 named). Frontend (Task 2) consumes these exact field names and the exact `COLUMN_HEADERS` label strings below.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_libretines_routes.py`:

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


INSERT_PERSONA_SQL = text(
    """
    INSERT INTO axis.personas (identificacion, tipo_identificacion, nombre)
    VALUES (:identificacion, :tipo_identificacion, :nombre)
    ON CONFLICT (identificacion) DO NOTHING
    """
)

INSERT_SQL = text(
    """
    INSERT INTO axis.axis_libretines
        (registro, hora_generacion, codigo_libretin, prefijo_boleta, rango_inicio_boleta,
         rango_fin_boleta, cantidad_boletas, longitud_boleta, estado, codigo_tramite,
         codigo_usuario_creacion, codigo_tramite_asignacion, codigo_usuario_asignacion,
         codigo_usuario_inactiva, observacion, codigo_agente, identificacion_agente, agente,
         codigo_distrito, descripcion_distrito, codigo_oficina, descripcion_oficina,
         codigo_provincia, descripcion_provincia, codigo_localidad, descripcion_localidad, tipo,
         origen_tramite, motivo_baja, disponibles, utilizadas, desactivadas, fecha_generacion,
         fecha_registro, fecha_asignacion, fecha_inactivacion, codigo_localidad_catalogo_item_id,
         codigo_provincia_catalogo_item_id, estado_catalogo_item_id, tipo_catalogo_item_id)
    VALUES
        (:registro, :hora_generacion, :codigo_libretin, :prefijo_boleta, :rango_inicio_boleta,
         :rango_fin_boleta, :cantidad_boletas, :longitud_boleta, :estado, :codigo_tramite,
         :codigo_usuario_creacion, :codigo_tramite_asignacion, :codigo_usuario_asignacion,
         :codigo_usuario_inactiva, :observacion, :codigo_agente, :identificacion_agente, :agente,
         :codigo_distrito, :descripcion_distrito, :codigo_oficina, :descripcion_oficina,
         :codigo_provincia, :descripcion_provincia, :codigo_localidad, :descripcion_localidad, :tipo,
         :origen_tramite, :motivo_baja, :disponibles, :utilizadas, :desactivadas, :fecha_generacion,
         :fecha_registro, :fecha_asignacion, :fecha_inactivacion, :codigo_localidad_catalogo_item_id,
         :codigo_provincia_catalogo_item_id, :estado_catalogo_item_id, :tipo_catalogo_item_id)
    RETURNING id
    """
)


def _row(registro, fecha_registro, identificacion_agente="TEST-LIB-CED-0001", **overrides):
    base = {
        "registro": registro,
        "hora_generacion": time(7, 30, 0),
        "codigo_libretin": f"LIB-{registro}",
        "prefijo_boleta": "A",
        "rango_inicio_boleta": "000001",
        "rango_fin_boleta": "000100",
        "cantidad_boletas": "100",
        "longitud_boleta": "6",
        "estado": "ACTIVO",
        "codigo_tramite": "TRA-001",
        "codigo_usuario_creacion": "USR-001",
        "codigo_tramite_asignacion": "TRA-002",
        "codigo_usuario_asignacion": "USR-002",
        "codigo_usuario_inactiva": None,
        "observacion": "Observación de prueba",
        "codigo_agente": "AGT-001",
        "identificacion_agente": identificacion_agente,
        "agente": "Agente de Prueba",
        "codigo_distrito": "D-01",
        "descripcion_distrito": "Distrito Centro",
        "codigo_oficina": "OF-01",
        "descripcion_oficina": "Oficina Centro",
        "codigo_provincia": "LOJ",
        "descripcion_provincia": "Loja",
        "codigo_localidad": "LOJ-01",
        "descripcion_localidad": "Loja",
        "tipo": "NORMAL",
        "origen_tramite": "MANUAL",
        "motivo_baja": None,
        "disponibles": "50",
        "utilizadas": "40",
        "desactivadas": "10",
        "fecha_generacion": fecha_registro.date(),
        "fecha_registro": fecha_registro,
        "fecha_asignacion": None,
        "fecha_inactivacion": None,
        "codigo_localidad_catalogo_item_id": 8,
        "codigo_provincia_catalogo_item_id": 4,
        "estado_catalogo_item_id": 2,
        "tipo_catalogo_item_id": 1,
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


async def _seed_libretines(db_session, rows):
    personas = {row["identificacion_agente"] for row in rows}
    await _seed_personas(db_session, personas)
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_libretines(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_libretines WHERE registro LIKE 'TEST-LIB-%'"))
    await db_session.execute(text("DELETE FROM axis.personas WHERE identificacion LIKE 'TEST-LIB-%'"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_list_returns_items_within_range(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row("TEST-LIB-101", datetime(2031, 6, 5, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0001"),
            _row("TEST-LIB-102", datetime(2031, 6, 15, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0002"),
            _row("TEST-LIB-103", datetime(2031, 6, 25, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0003"),
        ],
    )

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    registros = [item["registro"] for item in body["items"]]
    assert registros == ["TEST-LIB-103", "TEST-LIB-102", "TEST-LIB-101"]
    first = body["items"][0]
    assert first["agente"] == "Agente de Prueba"
    assert first["identificacion_agente"] == "TEST-LIB-CED-0003"
    assert first["disponibles"] == "50"
    assert first["estado_catalogo_item_id"] == 2


@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-15", "fecha_hasta": "2031-07-05"},
        headers=headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_rejects_desde_after_hasta(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-20", "fecha_hasta": "2031-06-10"},
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row("TEST-LIB-201", datetime(2031, 6, 5, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0004"),
            _row("TEST-LIB-202", datetime(2031, 6, 6, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0005"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_libretines SET deleted_at = now() WHERE registro = 'TEST-LIB-202'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["registro"] == "TEST-LIB-201"


@pytest.mark.asyncio
async def test_list_includes_rows_at_the_end_of_the_last_day(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row("TEST-LIB-601", datetime(2031, 6, 30, 23, 59, 59), identificacion_agente="TEST-LIB-CED-0006"),
            _row("TEST-LIB-602", datetime(2031, 7, 1, 0, 0, 0), identificacion_agente="TEST-LIB-CED-0007"),
        ],
    )

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    registros = [item["registro"] for item in body["items"]]
    assert "TEST-LIB-601" in registros
    assert "TEST-LIB-602" not in registros


@pytest.mark.asyncio
async def test_list_pagination_page_two_offset(client, db_session):
    headers = await _auth_headers(client, db_session)
    base = datetime(2031, 5, 1, 8, 0, 0)
    rows = [_row(f"TEST-LIB-p-{i:03d}", base.replace(day=1 + i % 28)) for i in range(55)]
    await _seed_libretines(db_session, rows)

    response = await client.get(
        "/api/reportes/libretines",
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
    await _seed_libretines(db_session, [_row("TEST-LIB-301", datetime(2031, 6, 5, 9, 0, 0))])

    response = await client.get(
        "/api/reportes/libretines",
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
        "/api/reportes/libretines",
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
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"


EXPECTED_HEADERS = [
    "Registro",
    "Hora de Generación del Registro",
    "Código Libretin",
    "Prefijo Boleta",
    "Rango Inicio Boleta",
    "Rango Fin Boleta",
    "Cantidad Boletas",
    "Longitud Boleta",
    "Estado",
    "Código de Trámite",
    "Código de Usuario Creación",
    "Código de Trámite Asignación",
    "Código de Usuario Asignación",
    "Código de Usuario Inactiva",
    "Observación",
    "Código Agente",
    "Identificación Agente",
    "Agente",
    "Código Distrito",
    "Descripción Distrito",
    "Código Oficina",
    "Descripción Oficina",
    "Código Provincia",
    "Descripción Provincia",
    "Código Localidad",
    "Descripción Localidad",
    "Tipo",
    "Origen Trámite",
    "Motivo Baja",
    "Disponibles",
    "Utilizadas",
    "Desactivadas",
    "Fecha de Generación del Registro",
    "Fecha de Registro",
    "Fecha Asignación",
    "Fecha Inactivación",
    "ID de Catálogo (Localidad)",
    "ID de Catálogo (Provincia)",
    "ID de Catálogo (Estado)",
    "ID de Catálogo (Tipo)",
]


@pytest.mark.asyncio
async def test_export_csv_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-LIB-e-{i:03d}", datetime(2031, 8, 1 + i, 9, 0, 0))
        for i in range(28)
    ]
    await _seed_libretines(db_session, rows)

    response = await client.get(
        "/api/reportes/libretines/export",
        params={"fecha_desde": "2031-08-01", "fecha_hasta": "2031-08-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "libretines_2031-08-01_2031-08-31.csv" in response.headers["content-disposition"]

    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 40
    assert len(lines) - 1 == 28

    data_row = parsed_rows[1]
    assert len(data_row) == 40
    assert data_row[0].startswith("TEST-LIB-e-")


@pytest.mark.asyncio
async def test_export_xlsx_returns_all_matching_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    rows = [
        _row(f"TEST-LIB-x-{i:03d}", datetime(2031, 9, 1 + i, 9, 0, 0))
        for i in range(29)
    ]
    await _seed_libretines(db_session, rows)

    response = await client.get(
        "/api/reportes/libretines/export",
        params={"fecha_desde": "2031-09-01", "fecha_hasta": "2031-09-30", "formato": "xlsx"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "libretines_2031-09-01_2031-09-30.xlsx" in response.headers["content-disposition"]

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 41)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 29

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 41)]
    assert data_row[0].startswith("TEST-LIB-x-")


@pytest.mark.asyncio
async def test_export_excludes_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row("TEST-LIB-501", datetime(2031, 6, 5, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0008"),
            _row("TEST-LIB-502", datetime(2031, 6, 6, 9, 0, 0), identificacion_agente="TEST-LIB-CED-0009"),
        ],
    )
    await db_session.execute(
        text("UPDATE axis.axis_libretines SET deleted_at = now() WHERE registro = 'TEST-LIB-502'")
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/libretines/export",
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
        "/api/reportes/libretines/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row(
                "TEST-LIB-TRUNC-001",
                datetime(2031, 6, 5, 14, 35, 0),
                fecha_asignacion=datetime(2031, 6, 6, 10, 0, 0),
                fecha_inactivacion=datetime(2031, 6, 10, 9, 0, 0),
            )
        ],
    )

    response = await client.get(
        "/api/reportes/libretines",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["fecha_generacion"] == "2031-06-05"
    assert first["fecha_registro"] == "2031-06-05"
    assert first["fecha_asignacion"] == "2031-06-06"
    assert first["fecha_inactivacion"] == "2031-06-10"


@pytest.mark.asyncio
async def test_export_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session,
        [
            _row(
                "TEST-LIB-TRUNC-002",
                datetime(2031, 6, 6, 14, 35, 0),
                fecha_asignacion=datetime(2031, 6, 7, 10, 0, 0),
                fecha_inactivacion=datetime(2031, 6, 11, 9, 0, 0),
            )
        ],
    )

    response = await client.get(
        "/api/reportes/libretines/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    data_row = parsed_rows[-1]
    assert data_row[32] == "2031-06-06"
    assert data_row[33] == "2031-06-06"
    assert data_row[34] == "2031-06-07"
    assert data_row[35] == "2031-06-11"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_libretines_routes.py -v`
Expected: FAIL — errors inserting into `axis.axis_libretines` (the table columns don't exist on the SQLAlchemy `Table` object yet) and `404` for `/api/reportes/libretines`.

- [ ] **Step 3: Create the `axis_libretines` Table definition**

At the end of `apps/api/app/axis_tables.py`, add:

```python
axis_libretines = Table(
    "axis_libretines",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("codigo_libretin", Text),
    Column("prefijo_boleta", Text),
    Column("rango_inicio_boleta", Text),
    Column("rango_fin_boleta", Text),
    Column("cantidad_boletas", Text),
    Column("longitud_boleta", Text),
    Column("estado", Text),
    Column("codigo_tramite", Text),
    Column("codigo_usuario_creacion", Text),
    Column("codigo_tramite_asignacion", Text),
    Column("codigo_usuario_asignacion", Text),
    Column("codigo_usuario_inactiva", Text),
    Column("observacion", Text),
    Column("codigo_agente", Text),
    Column("identificacion_agente", Text),
    Column("agente", Text),
    Column("codigo_distrito", Text),
    Column("descripcion_distrito", Text),
    Column("codigo_oficina", Text),
    Column("descripcion_oficina", Text),
    Column("codigo_provincia", Text),
    Column("descripcion_provincia", Text),
    Column("codigo_localidad", Text),
    Column("descripcion_localidad", Text),
    Column("tipo", Text),
    Column("origen_tramite", Text),
    Column("motivo_baja", Text),
    Column("disponibles", Text),
    Column("utilizadas", Text),
    Column("desactivadas", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_registro", DateTime),
    Column("fecha_asignacion", DateTime),
    Column("fecha_inactivacion", DateTime),
    Column("codigo_localidad_catalogo_item_id", Integer),
    Column("codigo_provincia_catalogo_item_id", Integer),
    Column("estado_catalogo_item_id", Integer),
    Column("tipo_catalogo_item_id", Integer),
)
```

All of `BigInteger`, `Column`, `Date`, `DateTime`, `Integer`, `Table`, `Text`, `Time` are already imported at the top of the file.

- [ ] **Step 4: Add the schema**

In `apps/api/app/schemas.py`, add at the end of the file, after `CrvListResponse`:

```python
class LibretinItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_libretin: str | None
    prefijo_boleta: str | None
    rango_inicio_boleta: str | None
    rango_fin_boleta: str | None
    cantidad_boletas: str | None
    longitud_boleta: str | None
    estado: str | None
    codigo_tramite: str | None
    codigo_usuario_creacion: str | None
    codigo_tramite_asignacion: str | None
    codigo_usuario_asignacion: str | None
    codigo_usuario_inactiva: str | None
    observacion: str | None
    codigo_agente: str | None
    identificacion_agente: str | None
    agente: str | None
    codigo_distrito: str | None
    descripcion_distrito: str | None
    codigo_oficina: str | None
    descripcion_oficina: str | None
    codigo_provincia: str | None
    descripcion_provincia: str | None
    codigo_localidad: str | None
    descripcion_localidad: str | None
    tipo: str | None
    origen_tramite: str | None
    motivo_baja: str | None
    disponibles: str | None
    utilizadas: str | None
    desactivadas: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_asignacion: date | None
    fecha_inactivacion: date | None
    codigo_localidad_catalogo_item_id: int | None
    codigo_provincia_catalogo_item_id: int | None
    estado_catalogo_item_id: int | None
    tipo_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class LibretinListResponse(BaseModel):
    items: list[LibretinItem]
    total: int
    page: int
    page_size: int
```

`date` and `time` are already imported at the top of `schemas.py`.

- [ ] **Step 5: Create the router**

Create `apps/api/app/routers/libretines.py`:

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
from app.axis_tables import axis_libretines
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import LibretinItem, LibretinListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_libretin": "Código Libretin",
    "prefijo_boleta": "Prefijo Boleta",
    "rango_inicio_boleta": "Rango Inicio Boleta",
    "rango_fin_boleta": "Rango Fin Boleta",
    "cantidad_boletas": "Cantidad Boletas",
    "longitud_boleta": "Longitud Boleta",
    "estado": "Estado",
    "codigo_tramite": "Código de Trámite",
    "codigo_usuario_creacion": "Código de Usuario Creación",
    "codigo_tramite_asignacion": "Código de Trámite Asignación",
    "codigo_usuario_asignacion": "Código de Usuario Asignación",
    "codigo_usuario_inactiva": "Código de Usuario Inactiva",
    "observacion": "Observación",
    "codigo_agente": "Código Agente",
    "identificacion_agente": "Identificación Agente",
    "agente": "Agente",
    "codigo_distrito": "Código Distrito",
    "descripcion_distrito": "Descripción Distrito",
    "codigo_oficina": "Código Oficina",
    "descripcion_oficina": "Descripción Oficina",
    "codigo_provincia": "Código Provincia",
    "descripcion_provincia": "Descripción Provincia",
    "codigo_localidad": "Código Localidad",
    "descripcion_localidad": "Descripción Localidad",
    "tipo": "Tipo",
    "origen_tramite": "Origen Trámite",
    "motivo_baja": "Motivo Baja",
    "disponibles": "Disponibles",
    "utilizadas": "Utilizadas",
    "desactivadas": "Desactivadas",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_asignacion": "Fecha Asignación",
    "fecha_inactivacion": "Fecha Inactivación",
    "codigo_localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "codigo_provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "tipo_catalogo_item_id": "ID de Catálogo (Tipo)",
}
COLUMN_NAMES = list(COLUMN_HEADERS)

DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_asignacion", "fecha_inactivacion"}


def _select_column(name: str):
    column = axis_libretines.c[name]
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
        cast(axis_libretines.c.fecha_registro, Date).between(fecha_desde, fecha_hasta),
        axis_libretines.c.deleted_at.is_(None),
    ]


@router.get("/libretines", response_model=LibretinListResponse)
async def list_libretines(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> LibretinListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_libretines).where(and_(*conditions)))

    columns = [axis_libretines.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_libretines.c.fecha_registro.desc(), axis_libretines.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [LibretinItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.libretines.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return LibretinListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/libretines/export")
async def export_libretines(
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
        .order_by(axis_libretines.c.fecha_registro.desc(), axis_libretines.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"libretines_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.libretines.export",
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
from app.routers.modificacion_infracciones import router as modificacion_infracciones_router
```

to:

```python
from app.routers.juicios import router as juicios_router
from app.routers.libretines import router as libretines_router
from app.routers.modificacion_infracciones import router as modificacion_infracciones_router
```

and change:

```python
app.include_router(modificacion_infracciones_router)
app.include_router(crv_router)
app.include_router(auditoria_router)
```

to:

```python
app.include_router(modificacion_infracciones_router)
app.include_router(crv_router)
app.include_router(libretines_router)
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_libretines_routes.py -v`
Expected: all 15 tests pass.

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone — check `ps aux | grep pytest` first; no concurrent run against the shared local DB. A pre-existing unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail on its own — not your concern.)
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/routers/libretines.py apps/api/app/schemas.py apps/api/app/main.py apps/api/tests/test_libretines_routes.py
git commit -m "feat(api): add Libretines report endpoint"
```

---

### Task 2: Frontend — Libretines page

**Files:**
- Create: `apps/web/src/app/core/models/libretin.model.ts`
- Create: `apps/web/src/app/core/libretines.service.ts`
- Create: `apps/web/src/app/features/reportes/libretines/libretines.component.ts`
- Create: `apps/web/src/app/features/reportes/libretines/libretines.component.html`
- Create: `apps/web/src/app/features/reportes/libretines/libretines.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`

**Interfaces:**
- Consumes: `GET /api/reportes/libretines` and `GET /api/reportes/libretines/export` from Task 1, returning the exact field names and `COLUMN_HEADERS` label strings defined there.
- Produces: route `/reportes/libretines`, sidebar entry "Libretines".

- [ ] **Step 1: Create the model**

Create `apps/web/src/app/core/models/libretin.model.ts`:

```ts
export interface LibretinItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_libretin: string | null;
  prefijo_boleta: string | null;
  rango_inicio_boleta: string | null;
  rango_fin_boleta: string | null;
  cantidad_boletas: string | null;
  longitud_boleta: string | null;
  estado: string | null;
  codigo_tramite: string | null;
  codigo_usuario_creacion: string | null;
  codigo_tramite_asignacion: string | null;
  codigo_usuario_asignacion: string | null;
  codigo_usuario_inactiva: string | null;
  observacion: string | null;
  codigo_agente: string | null;
  identificacion_agente: string | null;
  agente: string | null;
  codigo_distrito: string | null;
  descripcion_distrito: string | null;
  codigo_oficina: string | null;
  descripcion_oficina: string | null;
  codigo_provincia: string | null;
  descripcion_provincia: string | null;
  codigo_localidad: string | null;
  descripcion_localidad: string | null;
  tipo: string | null;
  origen_tramite: string | null;
  motivo_baja: string | null;
  disponibles: string | null;
  utilizadas: string | null;
  desactivadas: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_asignacion: string | null;
  fecha_inactivacion: string | null;
  codigo_localidad_catalogo_item_id: number | null;
  codigo_provincia_catalogo_item_id: number | null;
  estado_catalogo_item_id: number | null;
  tipo_catalogo_item_id: number | null;
}

export interface LibretinListResponse {
  items: LibretinItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface LibretinFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
```

- [ ] **Step 2: Create the service**

Create `apps/web/src/app/core/libretines.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { LibretinFilters, LibretinListResponse } from './models/libretin.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: LibretinFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class LibretinesService {
  private readonly http = inject(HttpClient);

  listLibretines(filters: LibretinFilters, page: number): Observable<LibretinListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<LibretinListResponse>(`${environment.apiUrl}/reportes/libretines`, { params });
  }

  exportLibretines(filters: LibretinFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/libretines/export`, {
      params,
      responseType: 'blob',
    });
  }
}
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/src/app/features/reportes/libretines/libretines.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { LibretinesComponent, COLUMNAS } from './libretines.component';
import { AuthService } from '../../../core/auth.service';
import { LibretinesService } from '../../../core/libretines.service';
import { LibretinItem, LibretinListResponse } from '../../../core/models/libretin.model';

describe('LibretinesComponent', () => {
  let fixture: ComponentFixture<LibretinesComponent>;
  let libretinesService: {
    listLibretines: ReturnType<typeof vi.fn>;
    exportLibretines: ReturnType<typeof vi.fn>;
  };

  const item: LibretinItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '07:30:00',
    codigo_libretin: 'LIB-001',
    prefijo_boleta: 'A',
    rango_inicio_boleta: '000001',
    rango_fin_boleta: '000100',
    cantidad_boletas: '100',
    longitud_boleta: '6',
    estado: 'ACTIVO',
    codigo_tramite: 'TRA-001',
    codigo_usuario_creacion: 'USR-001',
    codigo_tramite_asignacion: 'TRA-002',
    codigo_usuario_asignacion: 'USR-002',
    codigo_usuario_inactiva: null,
    observacion: 'Observación de prueba',
    codigo_agente: 'AGT-001',
    identificacion_agente: '1103456789',
    agente: 'Agente de Prueba',
    codigo_distrito: 'D-01',
    descripcion_distrito: 'Distrito Centro',
    codigo_oficina: 'OF-01',
    descripcion_oficina: 'Oficina Centro',
    codigo_provincia: 'LOJ',
    descripcion_provincia: 'Loja',
    codigo_localidad: 'LOJ-01',
    descripcion_localidad: 'Loja',
    tipo: 'NORMAL',
    origen_tramite: 'MANUAL',
    motivo_baja: null,
    disponibles: '50',
    utilizadas: '40',
    desactivadas: '10',
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_asignacion: null,
    fecha_inactivacion: null,
    codigo_localidad_catalogo_item_id: 8,
    codigo_provincia_catalogo_item_id: 4,
    estado_catalogo_item_id: 2,
    tipo_catalogo_item_id: 1,
  };

  const resultado: LibretinListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    libretinesService = {
      listLibretines: vi.fn().mockReturnValue(of(resultado)),
      exportLibretines: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [LibretinesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: LibretinesService, useValue: libretinesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LibretinesComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(libretinesService.listLibretines).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 40 columns in the defined order', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(40);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(40);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[29]).toBe('50');
      expect(cellTexts[38]).toBe('2');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay libretines para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los libretines. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    libretinesService.listLibretines.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(libretinesService.listLibretines).toHaveBeenLastCalledWith(
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

      expect(libretinesService.exportLibretines).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      libretinesService.listLibretines.mockReturnValue(
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/libretines/libretines.component.spec.ts"`
Expected: FAIL — `libretines.component.ts` doesn't exist yet.

- [ ] **Step 5: Create the component and template**

Create `apps/web/src/app/features/reportes/libretines/libretines.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { LibretinesService } from '../../../core/libretines.service';
import { LibretinFilters, LibretinItem, LibretinListResponse } from '../../../core/models/libretin.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los libretines. Intenta de nuevo.';

export interface ColumnaLibretin {
  clave: keyof LibretinItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaLibretin[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_libretin', encabezado: 'Código Libretin' },
  { clave: 'prefijo_boleta', encabezado: 'Prefijo Boleta' },
  { clave: 'rango_inicio_boleta', encabezado: 'Rango Inicio Boleta' },
  { clave: 'rango_fin_boleta', encabezado: 'Rango Fin Boleta' },
  { clave: 'cantidad_boletas', encabezado: 'Cantidad Boletas' },
  { clave: 'longitud_boleta', encabezado: 'Longitud Boleta' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_tramite', encabezado: 'Código de Trámite' },
  { clave: 'codigo_usuario_creacion', encabezado: 'Código de Usuario Creación' },
  { clave: 'codigo_tramite_asignacion', encabezado: 'Código de Trámite Asignación' },
  { clave: 'codigo_usuario_asignacion', encabezado: 'Código de Usuario Asignación' },
  { clave: 'codigo_usuario_inactiva', encabezado: 'Código de Usuario Inactiva' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'codigo_agente', encabezado: 'Código Agente' },
  { clave: 'identificacion_agente', encabezado: 'Identificación Agente' },
  { clave: 'agente', encabezado: 'Agente' },
  { clave: 'codigo_distrito', encabezado: 'Código Distrito' },
  { clave: 'descripcion_distrito', encabezado: 'Descripción Distrito' },
  { clave: 'codigo_oficina', encabezado: 'Código Oficina' },
  { clave: 'descripcion_oficina', encabezado: 'Descripción Oficina' },
  { clave: 'codigo_provincia', encabezado: 'Código Provincia' },
  { clave: 'descripcion_provincia', encabezado: 'Descripción Provincia' },
  { clave: 'codigo_localidad', encabezado: 'Código Localidad' },
  { clave: 'descripcion_localidad', encabezado: 'Descripción Localidad' },
  { clave: 'tipo', encabezado: 'Tipo' },
  { clave: 'origen_tramite', encabezado: 'Origen Trámite' },
  { clave: 'motivo_baja', encabezado: 'Motivo Baja' },
  { clave: 'disponibles', encabezado: 'Disponibles' },
  { clave: 'utilizadas', encabezado: 'Utilizadas' },
  { clave: 'desactivadas', encabezado: 'Desactivadas' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_asignacion', encabezado: 'Fecha Asignación' },
  { clave: 'fecha_inactivacion', encabezado: 'Fecha Inactivación' },
  { clave: 'codigo_localidad_catalogo_item_id', encabezado: 'ID de Catálogo (Localidad)' },
  { clave: 'codigo_provincia_catalogo_item_id', encabezado: 'ID de Catálogo (Provincia)' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'tipo_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo)' },
];

@Component({
  selector: 'app-libretines',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './libretines.component.html',
})
export class LibretinesComponent {
  private readonly libretinesService = inject(LibretinesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<LibretinListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: LibretinFilters | null = null;

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
    this.libretinesService.exportLibretines(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: LibretinFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `libretines_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.libretinesService.listLibretines(this.filtrosVigentes, page).subscribe({
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

Create `apps/web/src/app/features/reportes/libretines/libretines.component.html`:

```html
<app-shell activeRoute="libretines">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Libretines</h2>
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
        <p class="p-md text-on-surface-variant text-body-sm">No hay libretines para estos filtros</p>
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

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/libretines/libretines.component.spec.ts"`
Expected: all pass.

- [ ] **Step 7: Wire up the route**

In `apps/web/src/app/app.routes.ts`, change:

```ts
import { CrvComponent } from './features/reportes/crv/crv.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

to:

```ts
import { CrvComponent } from './features/reportes/crv/crv.component';
import { LibretinesComponent } from './features/reportes/libretines/libretines.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
```

and change:

```ts
  { path: 'reportes/crv', component: CrvComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

to:

```ts
  { path: 'reportes/crv', component: CrvComponent, canActivate: [authGuard] },
  { path: 'reportes/libretines', component: LibretinesComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
```

- [ ] **Step 8: Add the sidebar entry**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'titulos' | 'modificacion-infracciones' | 'crv' | 'usuarios' | 'auditoria';
```

to:

```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'infracciones' | 'juicios' | 'pagos' | 'titulos' | 'modificacion-infracciones' | 'crv' | 'libretines' | 'usuarios' | 'auditoria';
```

and change:

```ts
    if (
      this.activeRoute === 'impugnaciones' ||
      this.activeRoute === 'infracciones' ||
      this.activeRoute === 'juicios' ||
      this.activeRoute === 'pagos' ||
      this.activeRoute === 'titulos' ||
      this.activeRoute === 'modificacion-infracciones' ||
      this.activeRoute === 'crv'
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
      this.activeRoute === 'modificacion-infracciones' ||
      this.activeRoute === 'crv' ||
      this.activeRoute === 'libretines'
    ) {
      this.reportesExpanded = true;
    }
```

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, change:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/crv" [class]="navLinkClass('crv')">
                  <span class="font-body-sm text-body-sm">CRV</span>
                </a>
              </li>
            </ul>
```

to:

```html
              <li class="pl-xl">
                <a routerLink="/reportes/crv" [class]="navLinkClass('crv')">
                  <span class="font-body-sm text-body-sm">CRV</span>
                </a>
              </li>
              <li class="pl-xl">
                <a routerLink="/reportes/libretines" [class]="navLinkClass('libretines')">
                  <span class="font-body-sm text-body-sm">Libretines</span>
                </a>
              </li>
            </ul>
```

- [ ] **Step 9: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass. `app-shell.component.spec.ts` tests specific routes one at a time rather than enumerating the full `AppShellRoute` union, so adding `'libretines'` to the type does not require changes there.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/core/models/libretin.model.ts apps/web/src/app/core/libretines.service.ts apps/web/src/app/features/reportes/libretines apps/web/src/app/app.routes.ts apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html
git commit -m "feat(web): add Libretines report page"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: navigate to `/reportes/libretines`, confirm the sidebar entry, filter by date, confirm all 40 columns render with the official labels, and download both CSV and XLSX to confirm they match the on-screen columns.
- [ ] Confirm `axis_libretines` is still NOT included in the Dashboard's table-count summary — this task only adds the standalone report, the Dashboard exclusion decision stands.
