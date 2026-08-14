# Truncar Fechas a Solo-Fecha en los Reportes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show and export date columns that are really `timestamp` in the database as plain dates (no time-of-day), in Impugnaciones, Infracciones, and Pagos.

**Architecture:** Each affected router selects the timestamp columns that should display as dates using `cast(column, Date).label(name)` instead of the raw column, in both the list and export endpoints. The corresponding Pydantic schema field type changes from `datetime` to `date` to match. No query filtering or ordering changes.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend. No frontend changes — components already just interpolate whatever string the API returns.

## Global Constraints

- Only columns that are genuinely `timestamp` in the database AND can appear with a value in the report's actual output get truncated. `ORDER BY` clauses keep using the original, full-precision column — sort order does not change, only what's displayed/exported.
- `deleted_at` is truncated in Impugnaciones and Infracciones (both show rows regardless of `deleted_at` — the column can carry a real value in visible output) but explicitly NOT touched in Pagos (it filters `deleted_at IS NULL`, so the column is always `null` in any row that reaches the response — truncating it would be unobservable, untestable dead code).
- **Juicios needs no changes in this plan at all.** Its only `timestamp` column was `deleted_at`, which is excluded for the same reason as Pagos above (Juicios also filters `deleted_at IS NULL`), and all its other date columns are already plain `date` in the database. There is nothing left to truncate.
- `hora_generacion` (Juicios, Pagos) is untouched — it's a time-of-day value, not a date with unwanted time.
- No frontend files change in this plan.

---

### Task 1: Impugnaciones — truncate `fecha_registro`, `fecha_acta`, `deleted_at`

**Files:**
- Modify: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_reportes_routes.py`

**Interfaces:**
- Consumes: none (self-contained; independent of Tasks 2-3).
- Produces: `ImpugnacionItem.fecha_registro`/`fecha_acta`/`deleted_at` become `date | None` instead of `datetime | None`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_reportes_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session, [_row("TEST-TRUNC-001", datetime(2031, 6, 5, 14, 35, 0), estado="A")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_impugnaciones SET deleted_at = :ts WHERE registro = 'TEST-TRUNC-001'"),
        {"ts": datetime(2031, 6, 5, 14, 35, 0)},
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["fecha_registro"] == "2031-06-05"
    assert first["fecha_acta"] == "2031-06-05"
    assert first["deleted_at"] == "2031-06-05"


@pytest.mark.asyncio
async def test_export_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session, [_row("TEST-TRUNC-002", datetime(2031, 6, 6, 14, 35, 0), estado="A")]
    )

    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    data_row = parsed_rows[-1]
    assert data_row[1] == "2031-06-06"
    assert data_row[2] == "2031-06-06"
```

This uses `text` (already imported from `sqlalchemy` at the top of this test file) and `csv` (already imported earlier in this file, above `EXPECTED_HEADERS`) — no new imports needed in the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -k truncates -v`
Expected: FAIL — `first["fecha_registro"]` is currently `"2031-06-05T14:35:00"` (or similar), not `"2031-06-05"`; same for the export test's `data_row` values.

- [ ] **Step 3: Add the truncation helper and use it in both endpoints**

In `apps/api/app/routers/reportes.py`, add this right after `_date_range_conditions`:

```python
DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_acta", "deleted_at"}


def _select_column(name: str):
    column = axis_impugnaciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column
```

Then, in `list_impugnaciones`, change:

```python
    columns = [axis_impugnaciones.c.id] + [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [axis_impugnaciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
```

And, in `export_impugnaciones`, change:

```python
    columns = [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [_select_column(name) for name in COLUMN_NAMES]
```

`Date` and `cast` are already imported at the top of this file (`from sqlalchemy import Date, and_, cast, func, select`).

- [ ] **Step 4: Update the schema**

In `apps/api/app/schemas.py`, change:

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
    deleted_at: datetime | None

    model_config = {"from_attributes": True}
```

to:

```python
class ImpugnacionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: date | None
    fecha_acta: date | None
    estado: str | None
    codigo_infraccion_axis: str | None
    contravencion: str | None
    tipo_acta: str | None
    articulo_original: str | None
    monto_capital_original: float | None
    observacion: str | None
    deleted_at: date | None

    model_config = {"from_attributes": True}
```

`date` is already imported at the top of `schemas.py` (`from datetime import date, datetime, time`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v`
Expected: all pass.

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone — no concurrent pytest process against the same shared local DB, or you may see spurious `InvalidRequestError: Could not refresh instance` failures unrelated to this change; also note a pre-existing unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail on its own — not your concern).
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/app/schemas.py apps/api/tests/test_reportes_routes.py
git commit -m "feat(api): show date-only (no time) for Impugnaciones timestamp columns"
```

---

### Task 2: Infracciones — truncate `fecha_registro`, `fecha_emision`, `fecha_aprobacion`, `fecha_vencimiento`, `deleted_at`

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`

**Interfaces:**
- Consumes: none (self-contained; independent of Tasks 1 and 3).
- Produces: `InfraccionItem.fecha_registro`/`fecha_emision`/`fecha_aprobacion`/`fecha_vencimiento`/`deleted_at` become `date | None` instead of `datetime | None`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_infracciones_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session, [_row("TEST-INF-TRUNC-001", datetime(2031, 6, 5, 14, 35, 0), estado="EMITIDA")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_infracciones SET deleted_at = :ts WHERE registro = 'TEST-INF-TRUNC-001'"),
        {"ts": datetime(2031, 6, 5, 14, 35, 0)},
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["fecha_registro"] == "2031-06-05"
    assert first["fecha_emision"] == "2031-06-05"
    assert first["fecha_aprobacion"] == "2031-06-05"
    assert first["fecha_vencimiento"] == "2031-06-05"
    assert first["deleted_at"] == "2031-06-05"


@pytest.mark.asyncio
async def test_export_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session, [_row("TEST-INF-TRUNC-002", datetime(2031, 6, 6, 14, 35, 0), estado="EMITIDA")]
    )

    response = await client.get(
        "/api/reportes/infracciones/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    data_row = parsed_rows[-1]
    assert data_row[1] == "2031-06-06"
    assert data_row[2] == "2031-06-06"
    assert data_row[3] == "2031-06-06"
    assert data_row[4] == "2031-06-06"
```

`text` (from `sqlalchemy`) and `csv` are both already imported at the top of this file — no import changes needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -k truncates -v`
Expected: FAIL — the four date fields and `deleted_at` currently include a time component.

- [ ] **Step 3: Add the truncation helper and use it in both endpoints**

In `apps/api/app/routers/infracciones.py`, add this right after `_date_range_conditions`:

```python
DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_emision", "fecha_aprobacion", "fecha_vencimiento", "deleted_at"}


def _select_column(name: str):
    column = axis_infracciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column
```

Then, in `list_infracciones`, change:

```python
    columns = [axis_infracciones.c.id] + [axis_infracciones.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [axis_infracciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
```

And, in `export_infracciones`, change:

```python
    columns = [axis_infracciones.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [_select_column(name) for name in COLUMN_NAMES]
```

`Date` and `cast` are already imported at the top of this file (`from sqlalchemy import Date, and_, cast, func, select`).

- [ ] **Step 4: Update the schema**

In `apps/api/app/schemas.py`, change:

```python
class InfraccionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: datetime | None
    fecha_emision: datetime | None
    fecha_aprobacion: datetime | None
    fecha_vencimiento: datetime | None
    estado: str | None
```

to:

```python
class InfraccionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: date | None
    fecha_emision: date | None
    fecha_aprobacion: date | None
    fecha_vencimiento: date | None
    estado: str | None
```

And, further down the same class, change:

```python
    valor_total: float | None
    deleted_at: datetime | None

    model_config = {"from_attributes": True}
```

to:

```python
    valor_total: float | None
    deleted_at: date | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v`
Expected: all pass.

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/infracciones.py apps/api/app/schemas.py apps/api/tests/test_infracciones_routes.py
git commit -m "feat(api): show date-only (no time) for Infracciones timestamp columns"
```

---

### Task 3: Pagos — truncate `fecha_operacion`, `fecha_transaccion`

**Files:**
- Modify: `apps/api/app/routers/pagos.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_pagos_routes.py`

**Interfaces:**
- Consumes: none (self-contained; independent of Tasks 1 and 2).
- Produces: `PagoItem.fecha_operacion`/`fecha_transaccion` become `date | None` instead of `datetime | None`. `PagoItem.deleted_at` is NOT changed (stays `datetime | None`) — it's unobservable given Pagos' existing `deleted_at IS NULL` filter, so there's nothing meaningful to truncate or test.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_pagos_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(db_session, [_row("TEST-PAG-TRUNC-001", datetime(2031, 6, 5, 14, 35, 0))])

    response = await client.get(
        "/api/reportes/pagos",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["fecha_operacion"] == "2031-06-05"
    assert first["fecha_transaccion"] == "2031-06-05"


@pytest.mark.asyncio
async def test_export_truncates_datetime_columns_to_date_only(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(db_session, [_row("TEST-PAG-TRUNC-002", datetime(2031, 6, 6, 14, 35, 0))])

    response = await client.get(
        "/api/reportes/pagos/export",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    text_content = response.content.decode("utf-8-sig")
    lines = [line for line in text_content.splitlines() if line]
    reader = csv.reader(lines)
    parsed_rows = list(reader)
    data_row = parsed_rows[-1]
    assert data_row[10] == "2031-06-06"
    assert data_row[11] == "2031-06-06"
```

(`data_row[10]`/`[11]` are `fecha_operacion`/`fecha_transaccion` — the 11th and 12th entries in `COLUMN_HEADERS`, 0-indexed 10 and 11; `COLUMN_HEADERS` order is: registro, hora_generacion, tipo_recaudador, recaudador, comprobante_pago_interno, comprobante_pago_recaudador, tipo_servicio, tipo_documento, numero_documento, fecha_generacion, fecha_operacion, fecha_transaccion, ...). `csv` is already imported earlier in this file (near `EXPECTED_HEADERS`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -k truncates -v`
Expected: FAIL — `fecha_operacion`/`fecha_transaccion` currently include a time component.

- [ ] **Step 3: Add the truncation helper and use it in both endpoints**

In `apps/api/app/routers/pagos.py`, add this right after `_date_range_conditions`:

```python
DATE_ONLY_COLUMNS = {"fecha_operacion", "fecha_transaccion"}


def _select_column(name: str):
    column = axis_pagos.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column
```

Then, in `list_pagos`, change:

```python
    columns = [axis_pagos.c.id] + [axis_pagos.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [axis_pagos.c.id] + [_select_column(name) for name in COLUMN_NAMES]
```

And, in `export_pagos`, change:

```python
    columns = [axis_pagos.c[name] for name in COLUMN_NAMES]
```

to:

```python
    columns = [_select_column(name) for name in COLUMN_NAMES]
```

`Date` and `cast` are already imported at the top of this file (`from sqlalchemy import Date, and_, cast, func, select`).

- [ ] **Step 4: Update the schema**

In `apps/api/app/schemas.py`, change:

```python
    fecha_generacion: date | None
    fecha_operacion: datetime | None
    fecha_transaccion: datetime | None
    monto_recaudado: float | None
```

to:

```python
    fecha_generacion: date | None
    fecha_operacion: date | None
    fecha_transaccion: date | None
    monto_recaudado: float | None
```

(this is inside `PagoItem` — `deleted_at: datetime | None`, a few lines below, stays unchanged per this task's Interfaces note above.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: all pass.

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/pagos.py apps/api/app/schemas.py apps/api/tests/test_pagos_routes.py
git commit -m "feat(api): show date-only (no time) for Pagos timestamp columns"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green (no frontend files changed by this plan, this just confirms nothing else broke).
- [ ] Manually smoke-test: search each of the 3 affected reports (Impugnaciones, Infracciones, Pagos) and confirm the date columns show as `YYYY-MM-DD` with no time, both on screen and in a downloaded CSV/XLSX.
