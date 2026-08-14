# Mostrar Todas las Columnas Reales en los Reportes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each of the 4 existing reports (Impugnaciones, Infracciones, Juicios, Pagos) show and export 100% of its source table's real columns — nothing hidden, even if the value is null.

**Architecture:** For each report, append the currently-missing column(s) to the end of its existing column list (backend `COLUMN_HEADERS` dict, Pydantic schema, frontend column definition, TypeScript model) — no reordering of existing columns, no filtering logic changes.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Columns to add, one report at a time, always appended at the end of the existing list:
  - Impugnaciones: `deleted_at` → "Fecha de Eliminación" (`datetime | None` / `string | null`)
  - Infracciones: `deleted_at` → "Fecha de Eliminación" (`datetime | None` / `string | null`)
  - Juicios: `deleted_at` → "Fecha de Eliminación" (`datetime | None` / `string | null`), then `tipo_identificacion_catalogo_item_id` → "ID de Catálogo (Tipo de Identificación)" (`int | None` / `number | null`)
  - Pagos: `deleted_at` → "Fecha de Eliminación" (`datetime | None` / `string | null`), then `tipo_documento_catalogo_item_id` → "ID de Catálogo (Tipo de Documento)" (`int | None` / `number | null`), then `tipo_recaudador_catalogo_item_id` → "ID de Catálogo (Tipo de Recaudador)" (`int | None` / `number | null`), then `tipo_servicio_catalogo_item_id` → "ID de Catálogo (Tipo de Servicio)" (`int | None` / `number | null`)
- Do NOT change the `WHERE` filtering logic of any report. Impugnaciones/Infracciones keep showing all rows regardless of `deleted_at` (unchanged, known, accepted behavior). Juicios/Pagos keep excluding `deleted_at IS NOT NULL` rows (unchanged) — their newly-visible `deleted_at` column will therefore always read empty/null in practice, and that's expected.
- `axis_impugnaciones` and `axis_infracciones` already have `deleted_at` in their SQLAlchemy Core `Table` definitions in `axis_tables.py` (added earlier by the Dashboard feature) — no changes needed there.
- No join with `axis.catalogo_items` — the `*_catalogo_item_id` columns are shown as their raw numeric ID.
- Every existing test that hardcodes a column count or an exact header list must be updated to the new, larger count/list. In Juicios and Pagos, remove the now-false `assert "<column>" not in first` lines (the column is no longer excluded).

---

### Task 1: Impugnaciones — add `deleted_at`

**Files:**
- Modify: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_reportes_routes.py`
- Modify: `apps/web/src/app/core/models/impugnacion.model.ts`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of Tasks 2-4).
- Produces: `ImpugnacionItem` (backend and frontend) gains `deleted_at`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_reportes_routes.py`, change:

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
    "Fecha de Eliminación",
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
    assert len(data_row) == 11
    assert data_row[3] == "A"
    assert data_row[0].startswith("TEST-e-")
```

And change, in `test_export_xlsx_returns_all_matching_rows`:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 11)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 11)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 12)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 12)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -k export -v`
Expected: FAIL — header list length mismatch (11 vs 10) and `len(data_row)`/column-range mismatches.

- [ ] **Step 3: Add the column to the backend**

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
    "deleted_at": "Fecha de Eliminación",
}
```

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

    model_config = {"from_attributes": True}
```

to:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v`
Expected: all pass (same count as before this task, still green).

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`, change the `resultado` object's single item from:

```ts
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
```

to:

```ts
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
        deleted_at: null,
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  };
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
    'Fecha de Eliminación',
  ];
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: FAIL — either a TypeScript compile error (missing `deleted_at` on the `ImpugnacionItem` object literal, since the model doesn't have that field yet) or a header-length mismatch, whichever the compiler reaches first.

- [ ] **Step 7: Add the column to the frontend**

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
  deleted_at: string | null;
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
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha de Eliminación</th>
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
                  <td class="py-3 px-md text-on-surface-variant">{{ item.deleted_at }}</td>
                </tr>
```

- [ ] **Step 8: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: all pass (same count as before this task, still green).

- [ ] **Step 9: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone — no concurrent pytest process against the same shared local DB, or you may see spurious `InvalidRequestError: Could not refresh instance` failures unrelated to this change).
Expected: all pass (aside from the pre-existing unrelated flake `test_decode_access_token_rejects_tampered_token`).

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/app/schemas.py apps/api/tests/test_reportes_routes.py apps/web/src/app/core/models/impugnacion.model.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts
git commit -m "feat: show deleted_at column in the Impugnaciones report"
```

---

### Task 2: Infracciones — add `deleted_at`

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`
- Modify: `apps/web/src/app/core/models/infraccion.model.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of the other 3 tasks).
- Produces: `InfraccionItem` (backend and frontend) gains `deleted_at`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_infracciones_routes.py`, in the `EXPECTED_HEADERS` list, change the last entry from:

```python
    "Valor Total",
]
```

to:

```python
    "Valor Total",
    "Fecha de Eliminación",
]
```

Then change:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 41
```

to:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 42
```

and change:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 41
```

to:

```python
    data_row = parsed_rows[1]
    assert len(data_row) == 42
```

and change:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 42)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 42)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 43)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 55

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 43)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -k export -v`
Expected: FAIL — header/column-count mismatches (42 vs 41).

- [ ] **Step 3: Add the column to the backend**

In `apps/api/app/routers/infracciones.py`, change the last entry of `COLUMN_HEADERS` from:

```python
    "valor_total": "Valor Total",
}
```

to:

```python
    "valor_total": "Valor Total",
    "deleted_at": "Fecha de Eliminación",
}
```

In `apps/api/app/schemas.py`, change the last field of `InfraccionItem` before `model_config` from:

```python
    valor_total: float | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
```

to:

```python
    valor_total: float | None
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`, change the `item` object's last field from:

```ts
    valor_total: 56,
  };
```

to:

```ts
    valor_total: 56,
    deleted_at: null,
  };
```

Change the last assertion group in the async rendering test — find:

```ts
      expect(cellTexts.length).toBe(41);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[6]).toBe('COD-001');
      expect(cellTexts[40]).toBe('56');
    });
```

and replace with:

```ts
      expect(cellTexts.length).toBe(42);
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
      expect(headerTexts.length).toBe(42);
```

Also update the test's title text (cosmetic, but keep it accurate) from:

```ts
    it('renders results once the deferred response arrives, with all 41 columns in the defined order', async () => {
```

to:

```ts
    it('renders results once the deferred response arrives, with all 42 columns in the defined order', async () => {
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: FAIL — TypeScript compile error (missing `deleted_at` on the object literal) or a length mismatch.

- [ ] **Step 7: Add the column to the frontend**

In `apps/web/src/app/core/models/infraccion.model.ts`, change the last field of `InfraccionItem` from:

```ts
  valor_total: number | null;
}
```

to:

```ts
  valor_total: number | null;
  deleted_at: string | null;
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
  { clave: 'deleted_at', encabezado: 'Fecha de Eliminación' },
];
```

- [ ] **Step 8: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 9: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/routers/infracciones.py apps/api/app/schemas.py apps/api/tests/test_infracciones_routes.py apps/web/src/app/core/models/infraccion.model.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts
git commit -m "feat: show deleted_at column in the Infracciones report"
```

---

### Task 3: Juicios — add `deleted_at` and `tipo_identificacion_catalogo_item_id`

**Files:**
- Modify: `apps/api/app/routers/juicios.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_juicios_routes.py`
- Modify: `apps/web/src/app/core/models/juicio.model.ts`
- Modify: `apps/web/src/app/features/reportes/juicios/juicios.component.ts`
- Modify: `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of the other 3 tasks).
- Produces: `JuicioItem` (backend and frontend) gains `deleted_at` and `tipo_identificacion_catalogo_item_id`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_juicios_routes.py`, change:

```python
    first = body["items"][0]
    assert first["nombre_completo"] == "Deudor de Prueba"
    assert first["valor_total"] == 80.48
    assert "deleted_at" not in first
    assert "tipo_identificacion_catalogo_item_id" not in first
```

to:

```python
    first = body["items"][0]
    assert first["nombre_completo"] == "Deudor de Prueba"
    assert first["valor_total"] == 80.48
    assert first["deleted_at"] is None
    assert first["tipo_identificacion_catalogo_item_id"] == 67
```

In the `EXPECTED_HEADERS` list (in the export section), change the last entry from:

```python
    "Valor Total",
]
```

to:

```python
    "Valor Total",
    "Fecha de Eliminación",
    "ID de Catálogo (Tipo de Identificación)",
]
```

Then change, in `test_export_csv_returns_all_matching_rows`:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 26
    assert len(lines) - 1 == 31

    data_row = parsed_rows[1]
    assert len(data_row) == 26
```

to:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 28
    assert len(lines) - 1 == 31

    data_row = parsed_rows[1]
    assert len(data_row) == 28
```

and change, in `test_export_xlsx_returns_all_matching_rows`:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 27)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 30

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 27)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 29)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 30

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 29)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v`
Expected: FAIL — `test_list_returns_items_within_range` fails because `first["deleted_at"]`/`first["tipo_identificacion_catalogo_item_id"]` are `KeyError`s (fields not in the response yet); the two export tests fail on header/column-count mismatches.

- [ ] **Step 3: Add the columns to the backend**

In `apps/api/app/routers/juicios.py`, change the last two entries of `COLUMN_HEADERS` from:

```python
    "valor_costas": "Valor Costas",
    "valor_total": "Valor Total",
}
```

to:

```python
    "valor_costas": "Valor Costas",
    "valor_total": "Valor Total",
    "deleted_at": "Fecha de Eliminación",
    "tipo_identificacion_catalogo_item_id": "ID de Catálogo (Tipo de Identificación)",
}
```

In `apps/api/app/schemas.py`, change the last field of `JuicioItem` before `model_config` from:

```python
    valor_costas: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class JuicioListResponse(BaseModel):
```

to:

```python
    valor_costas: float | None
    valor_total: float | None
    deleted_at: datetime | None
    tipo_identificacion_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class JuicioListResponse(BaseModel):
```

`datetime` is already imported at the top of `schemas.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`, change the `item` object's last two fields from:

```ts
    valor_costas: 30.63,
    valor_total: 80.48,
  };
```

to:

```ts
    valor_costas: 30.63,
    valor_total: 80.48,
    deleted_at: null,
    tipo_identificacion_catalogo_item_id: 67,
  };
```

Change:

```ts
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
```

to:

```ts
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(28);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(28);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[25]).toBe('80.48');
      expect(cellTexts[27]).toBe('67');
    });
```

Also update the test title (cosmetic) from:

```ts
    it('renders results once the deferred response arrives, with all 26 columns in the defined order', async () => {
```

to:

```ts
    it('renders results once the deferred response arrives, with all 28 columns in the defined order', async () => {
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: FAIL — TypeScript compile error (missing fields on the object literal) or length mismatches.

- [ ] **Step 7: Add the columns to the frontend**

In `apps/web/src/app/core/models/juicio.model.ts`, change the last two fields of `JuicioItem` from:

```ts
  valor_costas: number | null;
  valor_total: number | null;
}
```

to:

```ts
  valor_costas: number | null;
  valor_total: number | null;
  deleted_at: string | null;
  tipo_identificacion_catalogo_item_id: number | null;
}
```

In `apps/web/src/app/features/reportes/juicios/juicios.component.ts`, change the last two entries of `COLUMNAS` from:

```ts
  { clave: 'valor_costas', encabezado: 'Valor Costas' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
];
```

to:

```ts
  { clave: 'valor_costas', encabezado: 'Valor Costas' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'deleted_at', encabezado: 'Fecha de Eliminación' },
  { clave: 'tipo_identificacion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación)' },
];
```

- [ ] **Step 8: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: all pass.

- [ ] **Step 9: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/routers/juicios.py apps/api/app/schemas.py apps/api/tests/test_juicios_routes.py apps/web/src/app/core/models/juicio.model.ts apps/web/src/app/features/reportes/juicios/juicios.component.ts apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts
git commit -m "feat: show deleted_at and tipo_identificacion_catalogo_item_id in the Juicios report"
```

---

### Task 4: Pagos — add `deleted_at` and the 3 `*_catalogo_item_id` columns

**Files:**
- Modify: `apps/api/app/routers/pagos.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/tests/test_pagos_routes.py`
- Modify: `apps/web/src/app/core/models/pago.model.ts`
- Modify: `apps/web/src/app/features/reportes/pagos/pagos.component.ts`
- Modify: `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of the other 3 tasks).
- Produces: `PagoItem` (backend and frontend) gains `deleted_at`, `tipo_documento_catalogo_item_id`, `tipo_recaudador_catalogo_item_id`, `tipo_servicio_catalogo_item_id`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_pagos_routes.py`, change:

```python
    first = body["items"][0]
    assert first["recaudador"] == "BANCO DEL PACIFICO"
    assert first["monto_recaudado"] == 119.0
    assert "deleted_at" not in first
    assert "tipo_documento_catalogo_item_id" not in first
```

to:

```python
    first = body["items"][0]
    assert first["recaudador"] == "BANCO DEL PACIFICO"
    assert first["monto_recaudado"] == 119.0
    assert first["deleted_at"] is None
    assert first["tipo_documento_catalogo_item_id"] is None
    assert first["tipo_recaudador_catalogo_item_id"] is None
    assert first["tipo_servicio_catalogo_item_id"] is None
```

(the `_row()` helper never sets any `*_catalogo_item_id` field, and those columns are nullable, so they insert as `NULL` — this asserts the columns are now present and correctly `None`, not absent.)

In the `EXPECTED_HEADERS` list (export section), change the last entry from:

```python
    "Monto Cuenta 2",
]
```

to:

```python
    "Monto Cuenta 2",
    "Fecha de Eliminación",
    "ID de Catálogo (Tipo de Documento)",
    "ID de Catálogo (Tipo de Recaudador)",
    "ID de Catálogo (Tipo de Servicio)",
]
```

Then change, in `test_export_csv_returns_all_matching_rows`:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 15
    assert len(lines) - 1 == 28

    data_row = parsed_rows[1]
    assert len(data_row) == 15
```

to:

```python
    assert parsed_rows[0] == EXPECTED_HEADERS
    assert len(parsed_rows[0]) == 19
    assert len(lines) - 1 == 28

    data_row = parsed_rows[1]
    assert len(data_row) == 19
```

and change, in `test_export_xlsx_returns_all_matching_rows`:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 16)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 29

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 16)]
```

to:

```python
    header_row = [sheet.cell(row=1, column=col).value for col in range(1, 20)]
    assert header_row == EXPECTED_HEADERS
    assert sheet.max_row - 1 == 29

    data_row = [sheet.cell(row=2, column=col).value for col in range(1, 20)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: FAIL — `KeyError`s on the new fields in the list test, header/column-count mismatches in the export tests.

- [ ] **Step 3: Add the columns to the backend**

In `apps/api/app/routers/pagos.py`, change the last entry of `COLUMN_HEADERS` from:

```python
    "monto_cuenta_2": "Monto Cuenta 2",
}
```

to:

```python
    "monto_cuenta_2": "Monto Cuenta 2",
    "deleted_at": "Fecha de Eliminación",
    "tipo_documento_catalogo_item_id": "ID de Catálogo (Tipo de Documento)",
    "tipo_recaudador_catalogo_item_id": "ID de Catálogo (Tipo de Recaudador)",
    "tipo_servicio_catalogo_item_id": "ID de Catálogo (Tipo de Servicio)",
}
```

In `apps/api/app/schemas.py`, change the last field of `PagoItem` before `model_config` from:

```python
    monto_cuenta_2: float | None

    model_config = {"from_attributes": True}


class PagoListResponse(BaseModel):
```

to:

```python
    monto_cuenta_2: float | None
    deleted_at: datetime | None
    tipo_documento_catalogo_item_id: int | None
    tipo_recaudador_catalogo_item_id: int | None
    tipo_servicio_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class PagoListResponse(BaseModel):
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`, change the `item` object's last field from:

```ts
    monto_cuenta_2: 0,
  };
```

to:

```ts
    monto_cuenta_2: 0,
    deleted_at: null,
    tipo_documento_catalogo_item_id: null,
    tipo_recaudador_catalogo_item_id: null,
    tipo_servicio_catalogo_item_id: null,
  };
```

Change:

```ts
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
```

to:

```ts
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(19);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(19);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[3]).toBe('BANCO DEL PACIFICO');
    });
```

Also update the test title (cosmetic) from:

```ts
    it('renders results once the deferred response arrives, with all 15 columns in the defined order', async () => {
```

to:

```ts
    it('renders results once the deferred response arrives, with all 19 columns in the defined order', async () => {
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: FAIL — TypeScript compile error (missing fields on the object literal) or length mismatches.

- [ ] **Step 7: Add the columns to the frontend**

In `apps/web/src/app/core/models/pago.model.ts`, change the last field of `PagoItem` from:

```ts
  monto_cuenta_2: number | null;
}
```

to:

```ts
  monto_cuenta_2: number | null;
  deleted_at: string | null;
  tipo_documento_catalogo_item_id: number | null;
  tipo_recaudador_catalogo_item_id: number | null;
  tipo_servicio_catalogo_item_id: number | null;
}
```

In `apps/web/src/app/features/reportes/pagos/pagos.component.ts`, change the last entry of `COLUMNAS` from:

```ts
  { clave: 'monto_cuenta_2', encabezado: 'Monto Cuenta 2' },
];
```

to:

```ts
  { clave: 'monto_cuenta_2', encabezado: 'Monto Cuenta 2' },
  { clave: 'deleted_at', encabezado: 'Fecha de Eliminación' },
  { clave: 'tipo_documento_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Documento)' },
  { clave: 'tipo_recaudador_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Recaudador)' },
  { clave: 'tipo_servicio_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Servicio)' },
];
```

- [ ] **Step 8: Run the frontend test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: all pass.

- [ ] **Step 9: Run both full suites to check for regressions**

Run: `cd apps/api && pytest -v` (alone, per the concurrency note in Task 1).
Expected: all pass (aside from the pre-existing unrelated flake).

Run: `cd apps/web && npx ng test --watch=false`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/routers/pagos.py apps/api/app/schemas.py apps/api/tests/test_pagos_routes.py apps/web/src/app/core/models/pago.model.ts apps/web/src/app/features/reportes/pagos/pagos.component.ts apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts
git commit -m "feat: show deleted_at and catalogo_item_id columns in the Pagos report"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test each of the 4 reports: confirm the new column(s) appear at the end of the table and in a downloaded CSV/XLSX, and that existing columns didn't shift position.
