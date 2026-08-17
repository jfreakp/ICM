# Fecha Mínima Disponible por Reporte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight `GET /api/reportes/<reporte>/fecha-minima` endpoint to each of the 8 existing reports, and show "Información disponible desde: DD/MM/AAAA" in each report's header, loaded automatically on page open.

**Architecture:** One new endpoint per existing router (same lightweight pattern as the existing `/estados` endpoints — no pagination, no export, no audit logging), backed by a shared `FechaMinimaResponse` schema/model reused by all 8. Each frontend component calls it in `ngOnInit` and renders the formatted result under its `<h2>` title.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Endpoint shape for all 8: `GET /api/reportes/<reporte>/fecha-minima` → `{"fecha_minima": "YYYY-MM-DD"}` or `{"fecha_minima": null}`. Auth via `require_active_user` only — no pagination, no export, no `registrar_evento` audit call (same as `/estados`).
- Query: `MIN(<filter column>) WHERE deleted_at IS NULL`, using each router's own truncation logic for that column so the value matches what the report's own date-range filter already sees.
- `reportes.py`, `infracciones.py`, `pagos.py`, `modificacion_infracciones.py`, `crv.py`, `libretines.py` already have a `_select_column(name)` helper (their reports truncate at least one date column) — reuse it: `func.min(_select_column("<column>"))`.
- `juicios.py` and `titulos.py` have NO `_select_column` helper (neither report truncates any date, because their `fecha_registro` is already a native `Date` column) — use the column directly: `func.min(axis_juicios.c.fecha_registro)` / `func.min(axis_titulos.c.fecha_registro)`.
- Filter column per report: `fecha_registro` for Impugnaciones, Infracciones, Juicios, Títulos, Modificación de Infracciones, Libretines; `fecha_transaccion` for Pagos; `fecha_ingreso` for CRV.
- The shared `FechaMinimaResponse` schema (backend, in `schemas.py`) and its frontend counterpart (`apps/web/src/app/core/models/fecha-minima.model.ts`) each have exactly one field: `fecha_minima: date | None` (backend) / `fecha_minima: string | null` (frontend).
- Frontend: each component calls `getFechaMinima()` in `ngOnInit` (Impugnaciones/Infracciones already have `ngOnInit` for `getEstados()` — extend it; the other 6 have none — add `implements OnInit` and the method). Format the ISO date to `DD/MM/AAAA` with a plain string split (no date library). Show "Información disponible desde: DD/MM/AAAA" under the `<h2>`; show nothing if `fecha_minima` is `null`; on request failure, ignore silently (do not use `errorSubject`, which is reserved for search/list failures).
- Backend test DB caveat: per `apps/api/tests/conftest.py`, only `app.users` is truncated between tests — the `axis.*` tables are never reset and may contain real, pre-existing data. Every new backend test therefore seeds a sentinel date far outside any real data's range (`1901-01-01` to prove inclusion, `1902-01-01` to prove soft-deleted exclusion) instead of asserting the endpoint returns a specific "only" value — this makes the assertions correct regardless of what else is in the table.
- Frontend test caveat: adding `ngOnInit` (or extending it) means every existing spec's `beforeEach` service mock must gain a default `getFechaMinima` (returning `{ fecha_minima: null }`) so already-passing tests don't break when `fixture.detectChanges()` triggers the new `ngOnInit` call.

---

### Task 1: Shared `FechaMinimaResponse` schema and model

**Files:**
- Modify: `apps/api/app/schemas.py` (add `FechaMinimaResponse`)
- Modify: `apps/web/src/app/core/models/fecha-minima.model.ts` (new file)

**Interfaces:**
- Consumes: none.
- Produces: `FechaMinimaResponse` (backend, importable from `app.schemas`) with field `fecha_minima: date | None`. `FechaMinimaResponse` (frontend, importable from `../../../core/models/fecha-minima.model` relative to a report component, or `./models/fecha-minima.model` relative to a service) with field `fecha_minima: string | null`. Every task below imports and uses these exact names.

- [ ] **Step 1: Add the backend schema**

At the end of `apps/api/app/schemas.py`, add:

```python
class FechaMinimaResponse(BaseModel):
    fecha_minima: date | None
```

`date` is already imported at the top of the file.

- [ ] **Step 2: Add the frontend model**

Create `apps/web/src/app/core/models/fecha-minima.model.ts`:

```ts
export interface FechaMinimaResponse {
  fecha_minima: string | null;
}
```

- [ ] **Step 3: Verify the backend still imports cleanly**

Run: `cd apps/api && python -c "from app.schemas import FechaMinimaResponse; print(FechaMinimaResponse(fecha_minima=None))"`
Expected: prints `fecha_minima=None` with no import errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/schemas.py apps/web/src/app/core/models/fecha-minima.model.ts
git commit -m "feat(api,web): add shared FechaMinimaResponse schema and model"
```

---

### Task 2: Impugnaciones — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/tests/test_reportes_routes.py`
- Modify: `apps/web/src/app/core/impugnaciones.service.ts`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`
- Modify: `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/impugnaciones/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_reportes_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(db_session, [_row("TEST-FMIN-001", datetime(1901, 1, 1), estado="A")])

    response = await client.get("/api/reportes/impugnaciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(db_session, [_row("TEST-FMIN-101", datetime(1902, 1, 1), estado="A")])
    await db_session.execute(
        text("UPDATE axis.axis_impugnaciones SET deleted_at = now() WHERE registro = 'TEST-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/impugnaciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/impugnaciones/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/impugnaciones/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/reportes.py`, change:

```python
from app.schemas import ImpugnacionItem, ImpugnacionListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, ImpugnacionItem, ImpugnacionListResponse
```

Then, right after the existing `/impugnaciones/estados` endpoint (before `/impugnaciones`), add:

```python
@router.get("/impugnaciones/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_impugnaciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(axis_impugnaciones.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

`func` is already imported at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_reportes_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts`, change the service mock type declaration:

```ts
  let impugnacionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listImpugnaciones: ReturnType<typeof vi.fn>;
    exportImpugnaciones: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let impugnacionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
    listImpugnaciones: ReturnType<typeof vi.fn>;
    exportImpugnaciones: ReturnType<typeof vi.fn>;
  };
```

Then change the `beforeEach` service instantiation:

```ts
    impugnacionesService = {
      getEstados: vi.fn().mockReturnValue(of(['A', 'B'])),
```

to:

```ts
    impugnacionesService = {
      getEstados: vi.fn().mockReturnValue(of(['A', 'B'])),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
```

Then add a new test, anywhere after the `beforeEach` block:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    impugnacionesService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(ImpugnacionesComponent);
    fixtureConFecha.detectChanges();

    expect(impugnacionesService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `ImpugnacionesService` / the header text is never rendered.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/impugnaciones.service.ts`, change:

```ts
import { ImpugnacionFilters, ImpugnacionListResponse } from './models/impugnacion.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { ImpugnacionFilters, ImpugnacionListResponse } from './models/impugnacion.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class after `getEstados`:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/impugnaciones/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts` (no import changes needed here — `FechaMinimaResponse` is only referenced inside the service), change:

```ts
  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();
```

to:

```ts
  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();
```

Change:

```ts
  ngOnInit(): void {
    this.impugnacionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
  }
```

to:

```ts
  ngOnInit(): void {
    this.impugnacionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
    this.impugnacionesService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Impugnaciones</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Impugnaciones</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/tests/test_reportes_routes.py apps/web/src/app/core/impugnaciones.service.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.html apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Impugnaciones header"
```

---

### Task 3: Infracciones — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/infracciones.py`
- Modify: `apps/api/tests/test_infracciones_routes.py`
- Modify: `apps/web/src/app/core/infracciones.service.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.html`
- Modify: `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/infracciones/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_infracciones_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(db_session, [_row("TEST-INF-FMIN-001", datetime(1901, 1, 1), estado="EMITIDA")])

    response = await client.get("/api/reportes/infracciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_infracciones(db_session, [_row("TEST-INF-FMIN-101", datetime(1902, 1, 1), estado="EMITIDA")])
    await db_session.execute(
        text("UPDATE axis.axis_infracciones SET deleted_at = now() WHERE registro = 'TEST-INF-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/infracciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/infracciones/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/infracciones/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/infracciones.py`, change:

```python
from app.schemas import InfraccionItem, InfraccionListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, InfraccionItem, InfraccionListResponse
```

Then, right after the existing `/infracciones/estados` endpoint, add:

```python
@router.get("/infracciones/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_infracciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(axis_infracciones.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts`, change:

```ts
  let infraccionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listInfracciones: ReturnType<typeof vi.fn>;
    exportInfracciones: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let infraccionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
    listInfracciones: ReturnType<typeof vi.fn>;
    exportInfracciones: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    infraccionesService = {
      getEstados: vi.fn().mockReturnValue(of(['EMITIDA', 'PAGADA'])),
      listInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    infraccionesService = {
      getEstados: vi.fn().mockReturnValue(of(['EMITIDA', 'PAGADA'])),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
      listInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    infraccionesService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(InfraccionesComponent);
    fixtureConFecha.detectChanges();

    expect(infraccionesService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`infraccionesService` and `InfraccionesComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `InfraccionesService` / the header text is never rendered.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/infracciones.service.ts`, change:

```ts
import { InfraccionFilters, InfraccionListResponse } from './models/infraccion.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { InfraccionFilters, InfraccionListResponse } from './models/infraccion.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class after `getEstados`:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/infracciones/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.ts`, change:

```ts
  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();
```

to:

```ts
  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();
```

Change:

```ts
  ngOnInit(): void {
    this.infraccionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
  }
```

to:

```ts
  ngOnInit(): void {
    this.infraccionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
    this.infraccionesService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/infracciones/infracciones.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Infracciones</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Infracciones</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/infracciones/infracciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/infracciones.py apps/api/tests/test_infracciones_routes.py apps/web/src/app/core/infracciones.service.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.ts apps/web/src/app/features/reportes/infracciones/infracciones.component.html apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Infracciones header"
```

---

### Task 4: Juicios — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/juicios.py`
- Modify: `apps/api/tests/test_juicios_routes.py`
- Modify: `apps/web/src/app/core/juicios.service.ts`
- Modify: `apps/web/src/app/features/reportes/juicios/juicios.component.ts`
- Modify: `apps/web/src/app/features/reportes/juicios/juicios.component.html`
- Modify: `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/juicios/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_juicios_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(
        db_session, [_row("TEST-JUI-FMIN-001", date(1901, 1, 1), identificacion="TEST-JUI-CED-fmin1")]
    )

    response = await client.get("/api/reportes/juicios/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_juicios(
        db_session, [_row("TEST-JUI-FMIN-101", date(1902, 1, 1), identificacion="TEST-JUI-CED-fmin2")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_juicios SET deleted_at = now() WHERE registro = 'TEST-JUI-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/juicios/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/juicios/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/juicios/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/juicios.py`, change:

```python
from app.schemas import JuicioItem, JuicioListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, JuicioItem, JuicioListResponse
```

Then, right after `PAGE_SIZE = 50` and before `COLUMN_HEADERS`, or anywhere at module level before the route functions, add (placing it right after the `_date_range_conditions` function, before `list_juicios`):

```python
@router.get("/juicios/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_juicios(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(axis_juicios.c.fecha_registro)).where(axis_juicios.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

`func` is already imported at the top of the file (`from sqlalchemy import and_, func, select`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_juicios_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts`, change the service mock type declaration:

```ts
  let juiciosService: {
    listJuicios: ReturnType<typeof vi.fn>;
    exportJuicios: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let juiciosService: {
    listJuicios: ReturnType<typeof vi.fn>;
    exportJuicios: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change the `beforeEach` service instantiation:

```ts
    juiciosService = {
      listJuicios: vi.fn().mockReturnValue(of(resultado)),
      exportJuicios: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    juiciosService = {
      listJuicios: vi.fn().mockReturnValue(of(resultado)),
      exportJuicios: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add a new test:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    juiciosService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(JuiciosComponent);
    fixtureConFecha.detectChanges();

    expect(juiciosService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `JuiciosService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/juicios.service.ts`, change:

```ts
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/juicios/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/juicios/juicios.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class JuiciosComponent {
  private readonly juiciosService = inject(JuiciosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class JuiciosComponent implements OnInit {
  private readonly juiciosService = inject(JuiciosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: JuicioFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: JuicioFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.juiciosService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/juicios/juicios.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Juicios</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Juicios</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/juicios/juicios.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/juicios.py apps/api/tests/test_juicios_routes.py apps/web/src/app/core/juicios.service.ts apps/web/src/app/features/reportes/juicios/juicios.component.ts apps/web/src/app/features/reportes/juicios/juicios.component.html apps/web/src/app/features/reportes/juicios/juicios.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Juicios header"
```

---

### Task 5: Pagos — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/pagos.py`
- Modify: `apps/api/tests/test_pagos_routes.py`
- Modify: `apps/web/src/app/core/pagos.service.ts`
- Modify: `apps/web/src/app/features/reportes/pagos/pagos.component.ts`
- Modify: `apps/web/src/app/features/reportes/pagos/pagos.component.html`
- Modify: `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/pagos/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_pagos_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(db_session, [_row("TEST-PAG-FMIN-001", datetime(1901, 1, 1, 9, 0, 0))])

    response = await client.get("/api/reportes/pagos/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_pagos(db_session, [_row("TEST-PAG-FMIN-101", datetime(1902, 1, 1, 9, 0, 0))])
    await db_session.execute(
        text("UPDATE axis.axis_pagos SET deleted_at = now() WHERE registro = 'TEST-PAG-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/pagos/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/pagos/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/pagos/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/pagos.py`, change:

```python
from app.schemas import PagoItem, PagoListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, PagoItem, PagoListResponse
```

Then, right after the `_select_column` function and before `list_pagos`, add:

```python
@router.get("/pagos/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_pagos(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_transaccion"))).where(axis_pagos.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_pagos_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts`, change:

```ts
  let pagosService: {
    listPagos: ReturnType<typeof vi.fn>;
    exportPagos: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let pagosService: {
    listPagos: ReturnType<typeof vi.fn>;
    exportPagos: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    pagosService = {
      listPagos: vi.fn().mockReturnValue(of(resultado)),
      exportPagos: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    pagosService = {
      listPagos: vi.fn().mockReturnValue(of(resultado)),
      exportPagos: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    pagosService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(PagosComponent);
    fixtureConFecha.detectChanges();

    expect(pagosService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`pagosService` and `PagosComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `PagosService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/pagos.service.ts`, change:

```ts
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/pagos/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/pagos/pagos.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class PagosComponent {
  private readonly pagosService = inject(PagosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class PagosComponent implements OnInit {
  private readonly pagosService = inject(PagosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: PagoFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: PagoFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.pagosService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/pagos/pagos.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Pagos</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Pagos</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/pagos/pagos.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/pagos.py apps/api/tests/test_pagos_routes.py apps/web/src/app/core/pagos.service.ts apps/web/src/app/features/reportes/pagos/pagos.component.ts apps/web/src/app/features/reportes/pagos/pagos.component.html apps/web/src/app/features/reportes/pagos/pagos.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Pagos header"
```

---

### Task 6: Títulos de Crédito — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/titulos.py`
- Modify: `apps/api/tests/test_titulos_routes.py`
- Modify: `apps/web/src/app/core/titulos.service.ts`
- Modify: `apps/web/src/app/features/reportes/titulos/titulos.component.ts`
- Modify: `apps/web/src/app/features/reportes/titulos/titulos.component.html`
- Modify: `apps/web/src/app/features/reportes/titulos/titulos.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/titulos/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_titulos_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(
        db_session, [_row("TEST-TIT-FMIN-001", date(1901, 1, 1), identificacion="TEST-TIT-CED-fmin1")]
    )

    response = await client.get("/api/reportes/titulos/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_titulos(
        db_session, [_row("TEST-TIT-FMIN-101", date(1902, 1, 1), identificacion="TEST-TIT-CED-fmin2")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_titulos SET deleted_at = now() WHERE registro = 'TEST-TIT-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/titulos/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/titulos/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_titulos_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/titulos/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/titulos.py`, change:

```python
from app.schemas import TituloItem, TituloListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, TituloItem, TituloListResponse
```

Then, right after the `_date_range_conditions` function and before `list_titulos`, add:

```python
@router.get("/titulos/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_titulos(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(axis_titulos.c.fecha_registro)).where(axis_titulos.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

`func` is already imported at the top of the file (`from sqlalchemy import and_, func, select`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_titulos_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/titulos/titulos.component.spec.ts`, change:

```ts
  let titulosService: {
    listTitulos: ReturnType<typeof vi.fn>;
    exportTitulos: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let titulosService: {
    listTitulos: ReturnType<typeof vi.fn>;
    exportTitulos: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    titulosService = {
      listTitulos: vi.fn().mockReturnValue(of(resultado)),
      exportTitulos: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    titulosService = {
      listTitulos: vi.fn().mockReturnValue(of(resultado)),
      exportTitulos: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    titulosService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(TitulosComponent);
    fixtureConFecha.detectChanges();

    expect(titulosService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`titulosService` and `TitulosComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/titulos/titulos.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `TitulosService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/titulos.service.ts`, change:

```ts
import { TituloFilters, TituloListResponse } from './models/titulo.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { TituloFilters, TituloListResponse } from './models/titulo.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/titulos/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/titulos/titulos.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class TitulosComponent {
  private readonly titulosService = inject(TitulosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class TitulosComponent implements OnInit {
  private readonly titulosService = inject(TitulosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: TituloFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: TituloFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.titulosService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/titulos/titulos.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Títulos de Crédito</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Títulos de Crédito</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/titulos/titulos.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/titulos.py apps/api/tests/test_titulos_routes.py apps/web/src/app/core/titulos.service.ts apps/web/src/app/features/reportes/titulos/titulos.component.ts apps/web/src/app/features/reportes/titulos/titulos.component.html apps/web/src/app/features/reportes/titulos/titulos.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Titulos de Credito header"
```

---

### Task 7: Modificación de Infracciones — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/modificacion_infracciones.py`
- Modify: `apps/api/tests/test_modificacion_infracciones_routes.py`
- Modify: `apps/web/src/app/core/modificacion-infracciones.service.ts`
- Modify: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts`
- Modify: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.html`
- Modify: `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/modificacion-infracciones/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_modificacion_infracciones_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(db_session, [_row("TEST-MOD-FMIN-001", datetime(1901, 1, 1, 9, 0, 0))])

    response = await client.get("/api/reportes/modificacion-infracciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_modificaciones(db_session, [_row("TEST-MOD-FMIN-101", datetime(1902, 1, 1, 9, 0, 0))])
    await db_session.execute(
        text("UPDATE axis.axis_modificacion_infracciones SET deleted_at = now() WHERE registro = 'TEST-MOD-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/modificacion-infracciones/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/modificacion-infracciones/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_modificacion_infracciones_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/modificacion-infracciones/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/modificacion_infracciones.py`, change:

```python
from app.schemas import ModificacionInfraccionItem, ModificacionInfraccionListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, ModificacionInfraccionItem, ModificacionInfraccionListResponse
```

Then, right after the `_select_column` function and before `list_modificacion_infracciones`, add:

```python
@router.get("/modificacion-infracciones/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_modificacion_infracciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(
        axis_modificacion_infracciones.c.deleted_at.is_(None)
    )
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_modificacion_infracciones_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts`, change:

```ts
  let modificacionInfraccionesService: {
    listModificacionInfracciones: ReturnType<typeof vi.fn>;
    exportModificacionInfracciones: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let modificacionInfraccionesService: {
    listModificacionInfracciones: ReturnType<typeof vi.fn>;
    exportModificacionInfracciones: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    modificacionInfraccionesService = {
      listModificacionInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportModificacionInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    modificacionInfraccionesService = {
      listModificacionInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportModificacionInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    modificacionInfraccionesService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(ModificacionInfraccionesComponent);
    fixtureConFecha.detectChanges();

    expect(modificacionInfraccionesService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`modificacionInfraccionesService` and `ModificacionInfraccionesComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `ModificacionInfraccionesService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/modificacion-infracciones.service.ts`, change:

```ts
import { ModificacionInfraccionFilters, ModificacionInfraccionListResponse } from './models/modificacion-infraccion.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { ModificacionInfraccionFilters, ModificacionInfraccionListResponse } from './models/modificacion-infraccion.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/modificacion-infracciones/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class ModificacionInfraccionesComponent {
  private readonly modificacionInfraccionesService = inject(ModificacionInfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class ModificacionInfraccionesComponent implements OnInit {
  private readonly modificacionInfraccionesService = inject(ModificacionInfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: ModificacionInfraccionFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: ModificacionInfraccionFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.modificacionInfraccionesService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Modificación de Infracciones</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Modificación de Infracciones</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/modificacion_infracciones.py apps/api/tests/test_modificacion_infracciones_routes.py apps/web/src/app/core/modificacion-infracciones.service.ts apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.html apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Modificacion de Infracciones header"
```

---

### Task 8: CRV — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/crv.py`
- Modify: `apps/api/tests/test_crv_routes.py`
- Modify: `apps/web/src/app/core/crv.service.ts`
- Modify: `apps/web/src/app/features/reportes/crv/crv.component.ts`
- Modify: `apps/web/src/app/features/reportes/crv/crv.component.html`
- Modify: `apps/web/src/app/features/reportes/crv/crv.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/crv/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_crv_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_crv(
        db_session, [_row("TEST-CRV-FMIN-001", datetime(1901, 1, 1, 9, 0, 0), identificacion_agente="TEST-CRV-CED-fmin1")]
    )

    response = await client.get("/api/reportes/crv/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_crv(
        db_session, [_row("TEST-CRV-FMIN-101", datetime(1902, 1, 1, 9, 0, 0), identificacion_agente="TEST-CRV-CED-fmin2")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_crv SET deleted_at = now() WHERE registro = 'TEST-CRV-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/crv/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/crv/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_crv_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/crv/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/crv.py`, change:

```python
from app.schemas import CrvItem, CrvListResponse
```

to:

```python
from app.schemas import CrvItem, CrvListResponse, FechaMinimaResponse
```

Then, right after the `_select_column` function and before `list_crv`, add:

```python
@router.get("/crv/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_crv(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_ingreso"))).where(axis_crv.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_crv_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/crv/crv.component.spec.ts`, change:

```ts
  let crvService: {
    listCrv: ReturnType<typeof vi.fn>;
    exportCrv: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let crvService: {
    listCrv: ReturnType<typeof vi.fn>;
    exportCrv: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    crvService = {
      listCrv: vi.fn().mockReturnValue(of(resultado)),
      exportCrv: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    crvService = {
      listCrv: vi.fn().mockReturnValue(of(resultado)),
      exportCrv: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    crvService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(CrvComponent);
    fixtureConFecha.detectChanges();

    expect(crvService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`crvService` and `CrvComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/crv/crv.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `CrvService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/crv.service.ts`, change:

```ts
import { CrvFilters, CrvListResponse } from './models/crv.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { CrvFilters, CrvListResponse } from './models/crv.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/crv/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/crv/crv.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class CrvComponent {
  private readonly crvService = inject(CrvService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class CrvComponent implements OnInit {
  private readonly crvService = inject(CrvService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: CrvFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: CrvFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.crvService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/crv/crv.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">CRV</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">CRV</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/crv/crv.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/crv.py apps/api/tests/test_crv_routes.py apps/web/src/app/core/crv.service.ts apps/web/src/app/features/reportes/crv/crv.component.ts apps/web/src/app/features/reportes/crv/crv.component.html apps/web/src/app/features/reportes/crv/crv.component.spec.ts
git commit -m "feat(api,web): show earliest available date in CRV header"
```

---

### Task 9: Libretines — fecha mínima

**Files:**
- Modify: `apps/api/app/routers/libretines.py`
- Modify: `apps/api/tests/test_libretines_routes.py`
- Modify: `apps/web/src/app/core/libretines.service.ts`
- Modify: `apps/web/src/app/features/reportes/libretines/libretines.component.ts`
- Modify: `apps/web/src/app/features/reportes/libretines/libretines.component.html`
- Modify: `apps/web/src/app/features/reportes/libretines/libretines.component.spec.ts`

**Interfaces:**
- Consumes: `FechaMinimaResponse` from Task 1.
- Produces: `GET /api/reportes/libretines/fecha-minima`.

- [ ] **Step 1: Write the failing backend tests**

In `apps/api/tests/test_libretines_routes.py`, add at the end of the file:

```python
@pytest.mark.asyncio
async def test_fecha_minima_includes_seeded_row(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session, [_row("TEST-LIB-FMIN-001", datetime(1901, 1, 1, 9, 0, 0), identificacion_agente="TEST-LIB-CED-fmin1")]
    )

    response = await client.get("/api/reportes/libretines/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] == "1901-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_ignores_soft_deleted_rows(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_libretines(
        db_session, [_row("TEST-LIB-FMIN-101", datetime(1902, 1, 1, 9, 0, 0), identificacion_agente="TEST-LIB-CED-fmin2")]
    )
    await db_session.execute(
        text("UPDATE axis.axis_libretines SET deleted_at = now() WHERE registro = 'TEST-LIB-FMIN-101'")
    )
    await db_session.commit()

    response = await client.get("/api/reportes/libretines/fecha-minima", headers=headers)

    assert response.status_code == 200
    assert response.json()["fecha_minima"] != "1902-01-01"


@pytest.mark.asyncio
async def test_fecha_minima_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/libretines/fecha-minima")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_libretines_routes.py -v -k fecha_minima`
Expected: FAIL — `404` for `/api/reportes/libretines/fecha-minima`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/libretines.py`, change:

```python
from app.schemas import LibretinItem, LibretinListResponse
```

to:

```python
from app.schemas import FechaMinimaResponse, LibretinItem, LibretinListResponse
```

Then, right after the `_select_column` function and before `list_libretines`, add:

```python
@router.get("/libretines/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_libretines(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(axis_libretines.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_libretines_routes.py -v -k fecha_minima`
Expected: all 3 pass.

- [ ] **Step 5: Write the failing frontend test**

In `apps/web/src/app/features/reportes/libretines/libretines.component.spec.ts`, change:

```ts
  let libretinesService: {
    listLibretines: ReturnType<typeof vi.fn>;
    exportLibretines: ReturnType<typeof vi.fn>;
  };
```

to:

```ts
  let libretinesService: {
    listLibretines: ReturnType<typeof vi.fn>;
    exportLibretines: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };
```

Change:

```ts
    libretinesService = {
      listLibretines: vi.fn().mockReturnValue(of(resultado)),
      exportLibretines: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };
```

to:

```ts
    libretinesService = {
      listLibretines: vi.fn().mockReturnValue(of(resultado)),
      exportLibretines: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };
```

Then add:

```ts
  it('shows the formatted minimum date under the title on init', () => {
    libretinesService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(LibretinesComponent);
    fixtureConFecha.detectChanges();

    expect(libretinesService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
```

(`libretinesService` and `LibretinesComponent` are the existing local variable name and imported component class already used throughout this spec file.)

- [ ] **Step 6: Run the frontend test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/libretines/libretines.component.spec.ts"`
Expected: FAIL — `getFechaMinima` doesn't exist on `LibretinesService`.

- [ ] **Step 7: Add the service method**

In `apps/web/src/app/core/libretines.service.ts`, change:

```ts
import { LibretinFilters, LibretinListResponse } from './models/libretin.model';
import { environment } from '../../environments/environment';
```

to:

```ts
import { LibretinFilters, LibretinListResponse } from './models/libretin.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';
```

and add, inside the class:

```ts
  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/libretines/fecha-minima`);
  }
```

- [ ] **Step 8: Add the component logic**

In `apps/web/src/app/features/reportes/libretines/libretines.component.ts`, change:

```ts
import { Component, inject } from '@angular/core';
```

to:

```ts
import { Component, OnInit, inject } from '@angular/core';
```

Change:

```ts
export class LibretinesComponent {
  private readonly libretinesService = inject(LibretinesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

to:

```ts
export class LibretinesComponent implements OnInit {
  private readonly libretinesService = inject(LibretinesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;
```

Change:

```ts
  private filtrosVigentes: LibretinFilters | null = null;

  onFechaChange(): void {
```

to:

```ts
  private filtrosVigentes: LibretinFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.libretinesService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
```

- [ ] **Step 9: Add the template**

In `apps/web/src/app/features/reportes/libretines/libretines.component.html`, change:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Libretines</h2>
  </div>
```

to:

```html
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Libretines</h2>
  </div>

  @if (fechaMinima$ | async; as fechaMinima) {
    <p class="text-on-surface-variant text-body-sm mb-md">Información disponible desde: {{ fechaMinima }}</p>
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/reportes/libretines/libretines.component.spec.ts"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/libretines.py apps/api/tests/test_libretines_routes.py apps/web/src/app/core/libretines.service.ts apps/web/src/app/features/reportes/libretines/libretines.component.ts apps/web/src/app/features/reportes/libretines/libretines.component.html apps/web/src/app/features/reportes/libretines/libretines.component.spec.ts
git commit -m "feat(api,web): show earliest available date in Libretines header"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` (alone — check `ps aux | grep pytest` first) — expect all green (aside from the pre-existing unrelated flake `test_decode_access_token_rejects_tampered_token`).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test at least 2 reports (one that already had `ngOnInit`, e.g. Impugnaciones; one that didn't, e.g. Pagos): open the page and confirm "Información disponible desde: DD/MM/AAAA" appears immediately, before touching the filter form.
