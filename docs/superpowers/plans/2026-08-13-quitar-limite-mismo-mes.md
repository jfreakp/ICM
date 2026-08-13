# Quitar Límite de Mismo Mes Calendario en Reportes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Impugnaciones and Infracciones reports to accept date ranges that cross a calendar month boundary, removing the existing same-month restriction with no replacement limit.

**Architecture:** Both reports currently validate the date range in two independent, textually-identical `_validate_date_range` functions (one per FastAPI router) and two independent, textually-identical `rangoValido` methods (one per Angular component). Each has two checks: order (`desde > hasta`) and same-month. This plan removes only the same-month check, in all four places, and removes the tests that assert it.

**Tech Stack:** FastAPI (backend), Angular 22 standalone + zoneless + vitest (frontend).

## Global Constraints

- The order check (`fecha_desde` cannot be after `fecha_hasta`) is NOT touched — it must keep returning `400`/showing `ORDER_ERROR_MESSAGE` exactly as today.
- No replacement limit is added (no 6-month cap, no 1-year cap, no row limit). This is an explicit, accepted risk — do not add one.
- Applies identically to both reports (Impugnaciones and Infracciones) — do not treat them differently.

---

### Task 1: Backend — remove the same-month check

**Files:**
- Modify: `apps/api/app/routers/reportes.py:38-48`
- Modify: `apps/api/app/routers/infracciones.py:70-80`
- Test: `apps/api/tests/test_reportes_routes.py`
- Test: `apps/api/tests/test_infracciones_routes.py`

**Interfaces:**
- Consumes: none (self-contained).
- Produces: `_validate_date_range(fecha_desde, fecha_hasta)` in both routers now only raises `400` when `fecha_desde > fecha_hasta`; no longer raises for a cross-month range. No signature change.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/test_reportes_routes.py`, replace the existing `test_list_rejects_range_crossing_month` test:

```python
@pytest.mark.asyncio
async def test_list_rejects_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 400
```

with:

```python
@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 200
```

In `apps/api/tests/test_infracciones_routes.py`, replace the existing `test_list_rejects_range_crossing_month` test:

```python
@pytest.mark.asyncio
async def test_list_rejects_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 400
```

with:

```python
@pytest.mark.asyncio
async def test_list_allows_range_crossing_month(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get(
        "/api/reportes/infracciones",
        params={"fecha_desde": "2024-06-15", "fecha_hasta": "2024-07-05"},
        headers=headers,
    )

    assert response.status_code == 200
```

Leave `test_list_rejects_desde_after_hasta` untouched in both files — it must keep passing throughout.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_reportes_routes.py::test_list_allows_range_crossing_month tests/test_infracciones_routes.py::test_list_allows_range_crossing_month -v`
Expected: both FAIL with `assert 400 == 200`.

- [ ] **Step 3: Remove the same-month check in `reportes.py`**

In `apps/api/app/routers/reportes.py`, replace:

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
```

with:

```python
def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
```

- [ ] **Step 4: Remove the same-month check in `infracciones.py`**

In `apps/api/app/routers/infracciones.py`, replace:

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
```

with:

```python
def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_reportes_routes.py::test_list_allows_range_crossing_month tests/test_infracciones_routes.py::test_list_allows_range_crossing_month tests/test_reportes_routes.py::test_list_rejects_desde_after_hasta tests/test_infracciones_routes.py::test_list_rejects_desde_after_hasta -v`
Expected: `4 passed`

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (a pre-existing, unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail independently of this change — not a regression from this task).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/app/routers/infracciones.py apps/api/tests/test_reportes_routes.py apps/api/tests/test_infracciones_routes.py
git commit -m "feat(api): allow report date ranges to cross a calendar month"
```

---

### Task 2: Frontend — remove the same-month check

**Files:**
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`
- Test: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`
- Test: `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`

**Interfaces:**
- Consumes: none (self-contained; independent of Task 1 — the frontend has its own duplicate client-side validation).
- Produces: `rangoValido()` in both components now only rejects on date order, never on month mismatch. `RANGE_ERROR_MESSAGE` constant is removed from both files (no longer referenced).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`, replace:

```ts
  it('blocks submit when the date range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('El rango de fechas debe estar dentro del mismo mes calendario.');
    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });
```

with:

```ts
  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(impugnacionesService.listImpugnaciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-03-15', fecha_hasta: '2024-04-05', estado: null },
      1
    );
  });
```

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`, replace:

```ts
  it('blocks submit when the date range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('El rango de fechas debe estar dentro del mismo mes calendario.');
    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });
```

with:

```ts
  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-03-15', fecha_hasta: '2024-04-05', estado: null },
      1
    );
  });
```

Leave `'blocks submit when fecha desde is after fecha hasta in the same month'` untouched in both spec files — it must keep passing throughout.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts" --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: both new tests FAIL (submit button still disabled, service never called).

- [ ] **Step 3: Remove the same-month check in `impugnaciones.component.ts`**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`, replace:

```ts
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
```

with:

```ts
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
```

Then remove the now-unused constant near the top of the file:

```ts
const RANGE_ERROR_MESSAGE = 'El rango de fechas debe estar dentro del mismo mes calendario.';
```

(delete this line entirely; `ORDER_ERROR_MESSAGE` and `LOAD_ERROR_MESSAGE` stay).

- [ ] **Step 4: Remove the same-month check in `infracciones.component.ts`**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`, replace:

```ts
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
```

with:

```ts
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
```

Then remove the now-unused constant near the top of the file (same line, delete entirely):

```ts
const RANGE_ERROR_MESSAGE = 'El rango de fechas debe estar dentro del mismo mes calendario.';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts" --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: all tests in both files pass.

- [ ] **Step 6: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts
git commit -m "feat(web): allow report date ranges to cross a calendar month"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test one report (e.g. Impugnaciones): pick a `fecha_desde`/`fecha_hasta` spanning two different months, confirm the search/export runs without the old error message and without the submit button being disabled.
