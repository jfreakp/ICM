# Completar Columnas Reales de Impugnaciones e Infracciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Impugnaciones and Infracciones show and export 100% of their real database columns (except `deleted_at`, which is deliberately not displayed in any report), matching the official AXIS Cloud/Yoveri field documentation for labels.

**Architecture:** Same pattern already used for every other column addition this project has done: append the missing column names to `COLUMN_HEADERS` (backend), add matching fields to the Pydantic schema, add matching entries to the frontend column list/template, add the new timestamp columns to each router's existing `DATE_ONLY_COLUMNS` set so they truncate to date-only like the others.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Every column name and label below was verified directly against `information_schema.columns` for the real `axis_impugnaciones`/`axis_infracciones` tables and cross-checked against the official source-system field documentation (AXIS Cloud/Yoveri) — use them exactly as given, do not rename or reorder.
- `deleted_at` is deliberately excluded from every report's display/export (standing decision, applies to all 4 reports) — do not add it here.
- New columns are appended at the end of each report's existing column list — no existing column changes position.
- `hora_generacion` and `fecha_generacion` need NO date truncation — `hora_generacion` is already `time`, `fecha_generacion` is already `date` in the real table.
- The other new `fecha_*` columns listed below ARE `timestamp` in the real table and DO need truncation — add them to the router's existing `DATE_ONLY_COLUMNS` set (already established pattern from a prior plan).
- `axis_infracciones.numero_identificacion_agente` has a real foreign key to `axis.personas.identificacion` — any test that sets a value for it must first seed a matching persona (same pattern already used for infractor/propietario).
- No join with `axis.catalogo_items` for any `*_catalogo_item_id` column — shown as the raw numeric ID, labeled `"ID de Catálogo (<concepto>)"`.
- Do not modify the existing `INSERT_SQL`/`_row()` test helpers in either test file (used by many pre-existing tests) — populate new-column values for verification via a separate `UPDATE` statement on the already-seeded row, the same technique the existing date-truncation tests already use.

---

### Task 1: Impugnaciones — add 31 missing columns

**Files:**
- Modify: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_reportes_routes.py`
- Modify: `apps/web/src/app/core/models/impugnacion.model.ts`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of Task 2).
- Produces: `ImpugnacionItem` grows from 11 to 42 fields (including `id`); `axis_impugnaciones` report shows/exports 41 named columns instead of 10.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_reportes_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_shows_newly_added_columns(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session, [_row("TEST-NEWCOL-001", datetime(2031, 6, 5, 14, 35, 0), estado="A")]
    )
    await db_session.execute(
        text(
            """
            UPDATE axis.axis_impugnaciones
            SET hora_generacion = '14:35:00',
                fecha_generacion = '2031-06-01',
                numero_credito = 'CRED-001',
                juzgado = 'Juzgado de Prueba',
                fecha_anulacion = :fecha_anulacion,
                tipo_acta_catalogo_item_id = 42
            WHERE registro = 'TEST-NEWCOL-001'
            """
        ),
        {"fecha_anulacion": datetime(2031, 6, 10, 9, 0, 0)},
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["hora_generacion"] == "14:35:00"
    assert first["fecha_generacion"] == "2031-06-01"
    assert first["numero_credito"] == "CRED-001"
    assert first["juzgado"] == "Juzgado de Prueba"
    assert first["fecha_anulacion"] == "2031-06-10"
    assert first["tipo_acta_catalogo_item_id"] == 42
```

Then change the `EXPECTED_HEADERS` list (used by the export tests) from:

```python
EXPECTED_HEADERS = [
    "Registro",
    "Fecha de Registro",
    "Fecha de Acta",
    "Estado",
    "Código de Infracción AXIS",
    "Contravención",
    "Tipo de Acta",
    "Artículo Original",
    "Monto Capital Original",
    "Observación",
]
```

to:

```python
EXPECTED_HEADERS = [
    "Registro",
    "Fecha de Registro",
    "Fecha de Acta",
    "Estado",
    "Código de Infracción AXIS",
    "Contravención",
    "Tipo de Acta",
    "Artículo Original",
    "Monto Capital Original",
    "Observación",
    "Hora de Generación del Registro",
    "Fecha de Generación del Registro",
    "Número de Crédito",
    "Número de Trámite",
    "Código de la Infracción Generada en AXIS Cloud",
    "Juzgado",
    "Código de la Provincia",
    "Código de la Localidad",
    "Número del Proceso",
    "Monto Modificado por la Sentencia",
    "Puntos Original",
    "Puntos Modificados por la Sentencia",
    "Literal Original",
    "Artículo Modificado por la Sentencia",
    "Literal Modificado por la Sentencia",
    "Fecha de Vencimiento Original",
    "Fecha de Vencimiento Modificado por la Sentencia",
    "Sanción Original",
    "Sanción Modificada por la Sentencia",
    "Código del Usuario",
    "Código del Usuario que Aprueba",
    "Número de Acta de Juzgamiento",
    "Fecha de Aprobación",
    "Fecha de Anulación",
    "Código de Usuario que Anula",
    "Observación de Anulación",
    "ID de Catálogo (Artículo Original)",
    "ID de Catálogo (Artículo Modificado por la Sentencia)",
    "ID de Catálogo (Localidad)",
    "ID de Catálogo (Provincia)",
    "ID de Catálogo (Tipo de Acta)",
]
```

Then change, in `test_export_csv_returns_all_matching_rows`:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 10
    assert data_row[3] == "A"
    assert data_row[0].startswith("TEST-e-")
```

to:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 41
    assert data_row[3] == "A"
    assert data_row[0].startswith("TEST-e-")
```

and, in `test_export_xlsx_returns_all_matching_rows`:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 11)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 11)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 42)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 42)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v`
Expected: `test_list_shows_newly_added_columns` FAILS with `KeyError` (the new fields don't exist in the response yet); both export tests FAIL on header/column-count mismatches.

- [ ] **Step 3: Add the columns to the backend**

In `apps/api/app/routers/reportes.py`, change:

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
```

to:

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
    "hora_generacion": "Hora de Generación del Registro",
    "fecha_generacion": "Fecha de Generación del Registro",
    "numero_credito": "Número de Crédito",
    "numero_tramite": "Número de Trámite",
    "codigo_infraccion_generada_axis": "Código de la Infracción Generada en AXIS Cloud",
    "juzgado": "Juzgado",
    "codigo_provincia": "Código de la Provincia",
    "codigo_localidad": "Código de la Localidad",
    "numero_proceso": "Número del Proceso",
    "monto_modificado_sentencia": "Monto Modificado por la Sentencia",
    "puntos_original": "Puntos Original",
    "puntos_modificados_sentencia": "Puntos Modificados por la Sentencia",
    "literal_original": "Literal Original",
    "articulo_modificado_sentencia": "Artículo Modificado por la Sentencia",
    "literal_modificado_sentencia": "Literal Modificado por la Sentencia",
    "fecha_vencimiento_original": "Fecha de Vencimiento Original",
    "fecha_vencimiento_modificado_sentencia": "Fecha de Vencimiento Modificado por la Sentencia",
    "sancion_original": "Sanción Original",
    "sancion_modificada_sentencia": "Sanción Modificada por la Sentencia",
    "codigo_usuario": "Código del Usuario",
    "codigo_usuario_aprueba": "Código del Usuario que Aprueba",
    "numero_acta_juzgamiento": "Número de Acta de Juzgamiento",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_anulacion": "Fecha de Anulación",
    "codigo_usuario_anula": "Código de Usuario que Anula",
    "observacion_anulacion": "Observación de Anulación",
    "articulo_original_catalogo_item_id": "ID de Catálogo (Artículo Original)",
    "articulo_modificado_sentencia_catalogo_item_id": "ID de Catálogo (Artículo Modificado por la Sentencia)",
    "codigo_localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "codigo_provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "tipo_acta_catalogo_item_id": "ID de Catálogo (Tipo de Acta)",
}
```

Then change `DATE_ONLY_COLUMNS` from:

```python
DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_acta"}
```

to:

```python
DATE_ONLY_COLUMNS = {
    "fecha_registro",
    "fecha_acta",
    "fecha_vencimiento_original",
    "fecha_vencimiento_modificado_sentencia",
    "fecha_aprobacion",
    "fecha_anulacion",
}
```

(`hora_generacion` and `fecha_generacion` are deliberately NOT added — they're already `time`/`date`.)

- [ ] **Step 4: Add the fields to the schema**

In `apps/api/app/schemas.py`, change:

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
    hora_generacion: time | None
    fecha_generacion: date | None
    numero_credito: str | None
    numero_tramite: str | None
    codigo_infraccion_generada_axis: str | None
    juzgado: str | None
    codigo_provincia: str | None
    codigo_localidad: str | None
    numero_proceso: str | None
    monto_modificado_sentencia: float | None
    puntos_original: str | None
    puntos_modificados_sentencia: str | None
    literal_original: str | None
    articulo_modificado_sentencia: str | None
    literal_modificado_sentencia: str | None
    fecha_vencimiento_original: date | None
    fecha_vencimiento_modificado_sentencia: date | None
    sancion_original: str | None
    sancion_modificada_sentencia: str | None
    codigo_usuario: str | None
    codigo_usuario_aprueba: str | None
    numero_acta_juzgamiento: str | None
    fecha_aprobacion: date | None
    fecha_anulacion: date | None
    codigo_usuario_anula: str | None
    observacion_anulacion: str | None
    articulo_original_catalogo_item_id: int | None
    articulo_modificado_sentencia_catalogo_item_id: int | None
    codigo_localidad_catalogo_item_id: int | None
    codigo_provincia_catalogo_item_id: int | None
    tipo_acta_catalogo_item_id: int | None

    model_config = {"from_attributes": True}
```

`time` is already imported at the top of `schemas.py` (`from datetime import date, datetime, time`). `puntos_original`/`puntos_modificados_sentencia`/`sancion_original`/`sancion_modificada_sentencia` are `text` columns in the real database (confirmed against `information_schema` — not numeric), so they're typed `str | None`, not `float | None`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v`
Expected: all pass.

- [ ] **Step 6: Write the failing frontend test**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`, change the `resultado` object's single item from:

```ts
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
```

to:

```ts
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
        hora_generacion: '14:35:00',
        fecha_generacion: '2024-06-01',
        numero_credito: null,
        numero_tramite: null,
        codigo_infraccion_generada_axis: null,
        juzgado: null,
        codigo_provincia: null,
        codigo_localidad: null,
        numero_proceso: null,
        monto_modificado_sentencia: null,
        puntos_original: null,
        puntos_modificados_sentencia: null,
        literal_original: null,
        articulo_modificado_sentencia: null,
        literal_modificado_sentencia: null,
        fecha_vencimiento_original: null,
        fecha_vencimiento_modificado_sentencia: null,
        sancion_original: null,
        sancion_modificada_sentencia: null,
        codigo_usuario: null,
        codigo_usuario_aprueba: null,
        numero_acta_juzgamiento: null,
        fecha_aprobacion: null,
        fecha_anulacion: null,
        codigo_usuario_anula: null,
        observacion_anulacion: null,
        articulo_original_catalogo_item_id: null,
        articulo_modificado_sentencia_catalogo_item_id: null,
        codigo_localidad_catalogo_item_id: null,
        codigo_provincia_catalogo_item_id: null,
        tipo_acta_catalogo_item_id: null,
      },
```

Change the `EXPECTED_HEADERS` constant from:

```ts
  const EXPECTED_HEADERS = [
    'Registro',
    'Fecha de Registro',
    'Fecha de Acta',
    'Estado',
    'Código de Infracción AXIS',
    'Contravención',
    'Tipo de Acta',
    'Artículo Original',
    'Monto Capital Original',
    'Observación',
  ];
```

to:

```ts
  const EXPECTED_HEADERS = [
    'Registro',
    'Fecha de Registro',
    'Fecha de Acta',
    'Estado',
    'Código de Infracción AXIS',
    'Contravención',
    'Tipo de Acta',
    'Artículo Original',
    'Monto Capital Original',
    'Observación',
    'Hora de Generación del Registro',
    'Fecha de Generación del Registro',
    'Número de Crédito',
    'Número de Trámite',
    'Código de la Infracción Generada en AXIS Cloud',
    'Juzgado',
    'Código de la Provincia',
    'Código de la Localidad',
    'Número del Proceso',
    'Monto Modificado por la Sentencia',
    'Puntos Original',
    'Puntos Modificados por la Sentencia',
    'Literal Original',
    'Artículo Modificado por la Sentencia',
    'Literal Modificado por la Sentencia',
    'Fecha de Vencimiento Original',
    'Fecha de Vencimiento Modificado por la Sentencia',
    'Sanción Original',
    'Sanción Modificada por la Sentencia',
    'Código del Usuario',
    'Código del Usuario que Aprueba',
    'Número de Acta de Juzgamiento',
    'Fecha de Aprobación',
    'Fecha de Anulación',
    'Código de Usuario que Anula',
    'Observación de Anulación',
    'ID de Catálogo (Artículo Original)',
    'ID de Catálogo (Artículo Modificado por la Sentencia)',
    'ID de Catálogo (Localidad)',
    'ID de Catálogo (Provincia)',
    'ID de Catálogo (Tipo de Acta)',
  ];
```

- [ ] **Step 7: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: FAIL — the header-count assertion (`headerTexts` vs `EXPECTED_HEADERS`) fails because the template doesn't render the new `<th>` elements yet.

- [ ] **Step 8: Add the columns to the frontend**

In `apps/web/src/app/core/models/impugnacion.model.ts`, change:

```ts
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
```

to:

```ts
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
  hora_generacion: string | null;
  fecha_generacion: string | null;
  numero_credito: string | null;
  numero_tramite: string | null;
  codigo_infraccion_generada_axis: string | null;
  juzgado: string | null;
  codigo_provincia: string | null;
  codigo_localidad: string | null;
  numero_proceso: string | null;
  monto_modificado_sentencia: number | null;
  puntos_original: string | null;
  puntos_modificados_sentencia: string | null;
  literal_original: string | null;
  articulo_modificado_sentencia: string | null;
  literal_modificado_sentencia: string | null;
  fecha_vencimiento_original: string | null;
  fecha_vencimiento_modificado_sentencia: string | null;
  sancion_original: string | null;
  sancion_modificada_sentencia: string | null;
  codigo_usuario: string | null;
  codigo_usuario_aprueba: string | null;
  numero_acta_juzgamiento: string | null;
  fecha_aprobacion: string | null;
  fecha_anulacion: string | null;
  codigo_usuario_anula: string | null;
  observacion_anulacion: string | null;
  articulo_original_catalogo_item_id: number | null;
  articulo_modificado_sentencia_catalogo_item_id: number | null;
  codigo_localidad_catalogo_item_id: number | null;
  codigo_provincia_catalogo_item_id: number | null;
  tipo_acta_catalogo_item_id: number | null;
}
```

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`, change the header row:

```html
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Observación</th>
              </tr>
```

to:

```html
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Observación</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Hora de Generación del Registro</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Generación del Registro</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Número de Crédito</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Número de Trámite</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código de la Infracción Generada en AXIS Cloud</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Juzgado</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código de la Provincia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código de la Localidad</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Número del Proceso</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Monto Modificado por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Puntos Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Puntos Modificados por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Literal Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Artículo Modificado por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Literal Modificado por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Vencimiento Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Vencimiento Modificado por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Sanción Original</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Sanción Modificada por la Sentencia</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código del Usuario</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código del Usuario que Aprueba</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Número de Acta de Juzgamiento</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Aprobación</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Anulación</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Código de Usuario que Anula</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Observación de Anulación</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">ID de Catálogo (Artículo Original)</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">ID de Catálogo (Artículo Modificado por la Sentencia)</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">ID de Catálogo (Localidad)</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">ID de Catálogo (Provincia)</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">ID de Catálogo (Tipo de Acta)</th>
              </tr>
```

and change the corresponding data row:

```html
                  <td class="py-3 px-md text-on-surface-variant">{{ item.observacion }}</td>
                </tr>
```

to:

```html
                  <td class="py-3 px-md text-on-surface-variant">{{ item.observacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.hora_generacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_generacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.numero_credito }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.numero_tramite }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_infraccion_generada_axis }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.juzgado }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_provincia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_localidad }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.numero_proceso }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.monto_modificado_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.puntos_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.puntos_modificados_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.literal_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.articulo_modificado_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.literal_modificado_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_vencimiento_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_vencimiento_modificado_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.sancion_original }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.sancion_modificada_sentencia }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_usuario }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_usuario_aprueba }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.numero_acta_juzgamiento }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_aprobacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.fecha_anulacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_usuario_anula }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.observacion_anulacion }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.articulo_original_catalogo_item_id }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.articulo_modificado_sentencia_catalogo_item_id }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_localidad_catalogo_item_id }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.codigo_provincia_catalogo_item_id }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.tipo_acta_catalogo_item_id }}</td>
                </tr>
```

- [ ] **Step 9: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 10: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone — no concurrent pytest process against the same shared local DB, or you may see spurious `InvalidRequestError: Could not refresh instance` failures unrelated to this change; a pre-existing unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail on its own — not your concern).
Expected: all pass.

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/app/schemas.py apps/api/tests/test_reportes_routes.py apps/web/src/app/core/models/impugnacion.model.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts
git commit -m "feat(api,web): show all 41 real columns in the Impugnaciones report"
```

---

### Task 2: Infracciones — add 42 missing columns

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`
- Modify: `apps/web/src/app/core/models/infraccion.model.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of Task 1).
- Produces: `InfraccionItem` grows from 42 to 84 fields (including `id`); `axis_infracciones` report shows/exports 83 named columns instead of 41.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_infracciones_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_shows_newly_added_columns(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(
        db_session, [_row("TEST-INF-NEWCOL-001", datetime(2031, 6, 5, 14, 35, 0), estado="EMITIDA")]
    )
    await _seed_personas(db_session, ["TEST-INF-AGT-0001"])
    await db_session.execute(
        text(
            """
            UPDATE axis.axis_infracciones
            SET hora_generacion = '14:35:00',
                fecha_generacion = '2031-06-01',
                tipo_infraccion = 'DE TRANSITO',
                zona = 'ZONA 1',
                tipo_identificacion_agente = 'CED',
                numero_identificacion_agente = 'TEST-INF-AGT-0001',
                nombre_agente = 'Agente de Prueba',
                fecha_coactiva = :fecha_coactiva,
                estado_catalogo_item_id = 77
            WHERE registro = 'TEST-INF-NEWCOL-001'
            """
        ),
        {"fecha_coactiva": datetime(2031, 6, 12, 8, 0, 0)},
    )
    await db_session.commit()

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30"},
        headers=headers,
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["hora_generacion"] == "14:35:00"
    assert first["fecha_generacion"] == "2031-06-01"
    assert first["tipo_infraccion"] == "DE TRANSITO"
    assert first["zona"] == "ZONA 1"
    assert first["numero_identificacion_agente"] == "TEST-INF-AGT-0001"
    assert first["nombre_agente"] == "Agente de Prueba"
    assert first["fecha_coactiva"] == "2031-06-12"
    assert first["estado_catalogo_item_id"] == 77
```

Then change the `EXPECTED_HEADERS` list (used by the export tests) from:

```python
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
```

to:

```python
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
    "Hora de Generación del Registro",
    "Fecha de Generación del Registro",
    "Tipo de Infracción",
    "Código del Usuario que Aprueba",
    "Código del Usuario que Notifica",
    "Tipo de Licencia",
    "Zona",
    "Distrito",
    "Circuito",
    "Dispositivo",
    "Geo-referencia-X",
    "Geo-referencia-Y",
    "Tipo de Identificación del Agente",
    "Número de Identificación del Agente",
    "Nombre del Agente",
    "Código del Agente de Tránsito",
    "Tipo de Infracción (2)",
    "Código de la Infracción Origen",
    "Código de la Empresa del Convenio",
    "Porcentaje Principal",
    "Porcentaje Convenio",
    "Cuenta Bancaria Principal",
    "Cuenta Bancaria Convenio",
    "Fecha de Notificación",
    "Fecha de Pago",
    "Fecha de Impugnación",
    "Fecha de Convenio",
    "Fecha de Anulación",
    "Fecha de Coactiva",
    "ID de Catálogo (Canal)",
    "ID de Catálogo (Estado)",
    "ID de Catálogo (Localidad)",
    "ID de Catálogo (Origen de Registro)",
    "ID de Catálogo (Provincia)",
    "ID de Catálogo (Tipo de Deudor)",
    "ID de Catálogo (Tipo de Emisión)",
    "ID de Catálogo (Tipo de Identificación del Agente)",
    "ID de Catálogo (Tipo de Identificación del Infractor)",
    "ID de Catálogo (Tipo de Identificación del Propietario)",
    "ID de Catálogo (Tipo de Licencia)",
    "ID de Catálogo (Tipo de Registro de Infracción)",
    "ID de Catálogo (Zona)",
]
```

Then change, in `test_export_csv_returns_all_matching_rows`:

```python
    assert len(parsed_rows[0]) == 41
```

to:

```python
    assert len(parsed_rows[0]) == 83
```

and:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 41
```

to:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 83
```

and, in `test_export_xlsx_returns_all_matching_rows`:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 42)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 42)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 84)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 84)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v`
Expected: `test_list_shows_newly_added_columns` FAILS with `KeyError`; both export tests FAIL on header/column-count mismatches.

- [ ] **Step 3: Add the columns to the backend**

In `apps/api/app/routers/infracciones.py`, change:

```python
    "valor_total": "Valor Total",
}
```

to:

```python
    "valor_total": "Valor Total",
    "hora_generacion": "Hora de Generación del Registro",
    "fecha_generacion": "Fecha de Generación del Registro",
    "tipo_infraccion": "Tipo de Infracción",
    "codigo_usuario_aprueba": "Código del Usuario que Aprueba",
    "codigo_usuario_notifica": "Código del Usuario que Notifica",
    "tipo_licencia": "Tipo de Licencia",
    "zona": "Zona",
    "distrito": "Distrito",
    "circuito": "Circuito",
    "dispositivo": "Dispositivo",
    "geo_referencia_x": "Geo-referencia-X",
    "geo_referencia_y": "Geo-referencia-Y",
    "tipo_identificacion_agente": "Tipo de Identificación del Agente",
    "numero_identificacion_agente": "Número de Identificación del Agente",
    "nombre_agente": "Nombre del Agente",
    "codigo_agente_transito": "Código del Agente de Tránsito",
    "tipo_infraccion_2": "Tipo de Infracción (2)",
    "codigo_infraccion_origen": "Código de la Infracción Origen",
    "codigo_empresa_convenio": "Código de la Empresa del Convenio",
    "porcentaje_principal": "Porcentaje Principal",
    "porcentaje_convenio": "Porcentaje Convenio",
    "cuenta_bancaria_principal": "Cuenta Bancaria Principal",
    "cuenta_bancaria_convenio": "Cuenta Bancaria Convenio",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_impugnacion": "Fecha de Impugnación",
    "fecha_convenio": "Fecha de Convenio",
    "fecha_anulacion": "Fecha de Anulación",
    "fecha_coactiva": "Fecha de Coactiva",
    "canal_catalogo_item_id": "ID de Catálogo (Canal)",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "origen_registro_catalogo_item_id": "ID de Catálogo (Origen de Registro)",
    "provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "tipo_deudor_catalogo_item_id": "ID de Catálogo (Tipo de Deudor)",
    "tipo_emision_catalogo_item_id": "ID de Catálogo (Tipo de Emisión)",
    "tipo_identificacion_agente_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Agente)",
    "tipo_identificacion_infractor_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Infractor)",
    "tipo_identificacion_propietario_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Propietario)",
    "tipo_licencia_catalogo_item_id": "ID de Catálogo (Tipo de Licencia)",
    "tipo_registro_infraccion_catalogo_item_id": "ID de Catálogo (Tipo de Registro de Infracción)",
    "zona_catalogo_item_id": "ID de Catálogo (Zona)",
}
```

Then change `DATE_ONLY_COLUMNS` from:

```python
DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_emision", "fecha_aprobacion", "fecha_vencimiento"}
```

to:

```python
DATE_ONLY_COLUMNS = {
    "fecha_registro",
    "fecha_emision",
    "fecha_aprobacion",
    "fecha_vencimiento",
    "fecha_notificacion",
    "fecha_pago",
    "fecha_impugnacion",
    "fecha_convenio",
    "fecha_anulacion",
    "fecha_coactiva",
}
```

- [ ] **Step 4: Add the fields to the schema**

In `apps/api/app/schemas.py`, change the end of `InfraccionItem` from:

```python
    valor_intereses: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
```

to:

```python
    valor_intereses: float | None
    valor_total: float | None
    hora_generacion: time | None
    fecha_generacion: date | None
    tipo_infraccion: str | None
    codigo_usuario_aprueba: str | None
    codigo_usuario_notifica: str | None
    tipo_licencia: str | None
    zona: str | None
    distrito: str | None
    circuito: str | None
    dispositivo: str | None
    geo_referencia_x: str | None
    geo_referencia_y: str | None
    tipo_identificacion_agente: str | None
    numero_identificacion_agente: str | None
    nombre_agente: str | None
    codigo_agente_transito: str | None
    tipo_infraccion_2: str | None
    codigo_infraccion_origen: str | None
    codigo_empresa_convenio: str | None
    porcentaje_principal: str | None
    porcentaje_convenio: str | None
    cuenta_bancaria_principal: str | None
    cuenta_bancaria_convenio: str | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_impugnacion: date | None
    fecha_convenio: date | None
    fecha_anulacion: date | None
    fecha_coactiva: date | None
    canal_catalogo_item_id: int | None
    estado_catalogo_item_id: int | None
    localidad_catalogo_item_id: int | None
    origen_registro_catalogo_item_id: int | None
    provincia_catalogo_item_id: int | None
    tipo_deudor_catalogo_item_id: int | None
    tipo_emision_catalogo_item_id: int | None
    tipo_identificacion_agente_catalogo_item_id: int | None
    tipo_identificacion_infractor_catalogo_item_id: int | None
    tipo_identificacion_propietario_catalogo_item_id: int | None
    tipo_licencia_catalogo_item_id: int | None
    tipo_registro_infraccion_catalogo_item_id: int | None
    zona_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
```

(`porcentaje_principal`/`porcentaje_convenio`/`cuenta_bancaria_principal`/`cuenta_bancaria_convenio` are `text` columns in the real database, not numeric — confirmed against `information_schema` — hence `str | None`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v`
Expected: all pass.

- [ ] **Step 6: Write the failing frontend test**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`, change the `item` object's last field from:

```ts
    valor_total: 56,
  };
```

to:

```ts
    valor_total: 56,
    hora_generacion: '14:35:00',
    fecha_generacion: '2024-06-01',
    tipo_infraccion: null,
    codigo_usuario_aprueba: null,
    codigo_usuario_notifica: null,
    tipo_licencia: null,
    zona: null,
    distrito: null,
    circuito: null,
    dispositivo: null,
    geo_referencia_x: null,
    geo_referencia_y: null,
    tipo_identificacion_agente: null,
    numero_identificacion_agente: null,
    nombre_agente: null,
    codigo_agente_transito: null,
    tipo_infraccion_2: null,
    codigo_infraccion_origen: null,
    codigo_empresa_convenio: null,
    porcentaje_principal: null,
    porcentaje_convenio: null,
    cuenta_bancaria_principal: null,
    cuenta_bancaria_convenio: null,
    fecha_notificacion: null,
    fecha_pago: null,
    fecha_impugnacion: null,
    fecha_convenio: null,
    fecha_anulacion: null,
    fecha_coactiva: null,
    canal_catalogo_item_id: null,
    estado_catalogo_item_id: null,
    localidad_catalogo_item_id: null,
    origen_registro_catalogo_item_id: null,
    provincia_catalogo_item_id: null,
    tipo_deudor_catalogo_item_id: null,
    tipo_emision_catalogo_item_id: null,
    tipo_identificacion_agente_catalogo_item_id: null,
    tipo_identificacion_infractor_catalogo_item_id: null,
    tipo_identificacion_propietario_catalogo_item_id: null,
    tipo_licencia_catalogo_item_id: null,
    tipo_registro_infraccion_catalogo_item_id: null,
    zona_catalogo_item_id: null,
  };
```

Change:

```ts
      expect(cellTexts.length).toBe(41);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[6]).toBe('COD-001');
      expect(cellTexts[40]).toBe('56');
    });
```

to:

```ts
      expect(cellTexts.length).toBe(83);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[6]).toBe('COD-001');
      expect(cellTexts[40]).toBe('56');
    });
```

and, a few lines above it in the same test, change:

```ts
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(41);
```

to:

```ts
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(83);
```

Also update the test title (cosmetic) from `'renders results once the deferred response arrives, with all 41 columns in the defined order'` to `'renders results once the deferred response arrives, with all 83 columns in the defined order'`.

- [ ] **Step 7: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: FAIL — header/cell-count mismatches.

- [ ] **Step 8: Add the columns to the frontend**

In `apps/web/src/app/core/models/infraccion.model.ts`, change the last field from:

```ts
  valor_total: number | null;
}
```

to:

```ts
  valor_total: number | null;
  hora_generacion: string | null;
  fecha_generacion: string | null;
  tipo_infraccion: string | null;
  codigo_usuario_aprueba: string | null;
  codigo_usuario_notifica: string | null;
  tipo_licencia: string | null;
  zona: string | null;
  distrito: string | null;
  circuito: string | null;
  dispositivo: string | null;
  geo_referencia_x: string | null;
  geo_referencia_y: string | null;
  tipo_identificacion_agente: string | null;
  numero_identificacion_agente: string | null;
  nombre_agente: string | null;
  codigo_agente_transito: string | null;
  tipo_infraccion_2: string | null;
  codigo_infraccion_origen: string | null;
  codigo_empresa_convenio: string | null;
  porcentaje_principal: string | null;
  porcentaje_convenio: string | null;
  cuenta_bancaria_principal: string | null;
  cuenta_bancaria_convenio: string | null;
  fecha_notificacion: string | null;
  fecha_pago: string | null;
  fecha_impugnacion: string | null;
  fecha_convenio: string | null;
  fecha_anulacion: string | null;
  fecha_coactiva: string | null;
  canal_catalogo_item_id: number | null;
  estado_catalogo_item_id: number | null;
  localidad_catalogo_item_id: number | null;
  origen_registro_catalogo_item_id: number | null;
  provincia_catalogo_item_id: number | null;
  tipo_deudor_catalogo_item_id: number | null;
  tipo_emision_catalogo_item_id: number | null;
  tipo_identificacion_agente_catalogo_item_id: number | null;
  tipo_identificacion_infractor_catalogo_item_id: number | null;
  tipo_identificacion_propietario_catalogo_item_id: number | null;
  tipo_licencia_catalogo_item_id: number | null;
  tipo_registro_infraccion_catalogo_item_id: number | null;
  zona_catalogo_item_id: number | null;
}
```

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`, change the last entry of `COLUMNAS` from:

```ts
  { clave: 'valor_total', encabezado: 'Valor Total' },
];
```

to:

```ts
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'tipo_infraccion', encabezado: 'Tipo de Infracción' },
  { clave: 'codigo_usuario_aprueba', encabezado: 'Código del Usuario que Aprueba' },
  { clave: 'codigo_usuario_notifica', encabezado: 'Código del Usuario que Notifica' },
  { clave: 'tipo_licencia', encabezado: 'Tipo de Licencia' },
  { clave: 'zona', encabezado: 'Zona' },
  { clave: 'distrito', encabezado: 'Distrito' },
  { clave: 'circuito', encabezado: 'Circuito' },
  { clave: 'dispositivo', encabezado: 'Dispositivo' },
  { clave: 'geo_referencia_x', encabezado: 'Geo-referencia-X' },
  { clave: 'geo_referencia_y', encabezado: 'Geo-referencia-Y' },
  { clave: 'tipo_identificacion_agente', encabezado: 'Tipo de Identificación del Agente' },
  { clave: 'numero_identificacion_agente', encabezado: 'Número de Identificación del Agente' },
  { clave: 'nombre_agente', encabezado: 'Nombre del Agente' },
  { clave: 'codigo_agente_transito', encabezado: 'Código del Agente de Tránsito' },
  { clave: 'tipo_infraccion_2', encabezado: 'Tipo de Infracción (2)' },
  { clave: 'codigo_infraccion_origen', encabezado: 'Código de la Infracción Origen' },
  { clave: 'codigo_empresa_convenio', encabezado: 'Código de la Empresa del Convenio' },
  { clave: 'porcentaje_principal', encabezado: 'Porcentaje Principal' },
  { clave: 'porcentaje_convenio', encabezado: 'Porcentaje Convenio' },
  { clave: 'cuenta_bancaria_principal', encabezado: 'Cuenta Bancaria Principal' },
  { clave: 'cuenta_bancaria_convenio', encabezado: 'Cuenta Bancaria Convenio' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_impugnacion', encabezado: 'Fecha de Impugnación' },
  { clave: 'fecha_convenio', encabezado: 'Fecha de Convenio' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'fecha_coactiva', encabezado: 'Fecha de Coactiva' },
  { clave: 'canal_catalogo_item_id', encabezado: 'ID de Catálogo (Canal)' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'localidad_catalogo_item_id', encabezado: 'ID de Catálogo (Localidad)' },
  { clave: 'origen_registro_catalogo_item_id', encabezado: 'ID de Catálogo (Origen de Registro)' },
  { clave: 'provincia_catalogo_item_id', encabezado: 'ID de Catálogo (Provincia)' },
  { clave: 'tipo_deudor_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Deudor)' },
  { clave: 'tipo_emision_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Emisión)' },
  { clave: 'tipo_identificacion_agente_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Agente)' },
  { clave: 'tipo_identificacion_infractor_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Infractor)' },
  { clave: 'tipo_identificacion_propietario_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Propietario)' },
  { clave: 'tipo_licencia_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Licencia)' },
  { clave: 'tipo_registro_infraccion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Registro de Infracción)' },
  { clave: 'zona_catalogo_item_id', encabezado: 'ID de Catálogo (Zona)' },
];
```

- [ ] **Step 9: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 10: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/infracciones.py apps/api/app/schemas.py apps/api/tests/test_infracciones_routes.py apps/web/src/app/core/models/infraccion.model.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts
git commit -m "feat(api,web): show all 83 real columns in the Infracciones report"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test both reports: confirm all new columns render with correct labels matching the official document, in both the on-screen table and a downloaded CSV/XLSX, with existing columns unchanged in position, and confirm `deleted_at` does not appear anywhere.
