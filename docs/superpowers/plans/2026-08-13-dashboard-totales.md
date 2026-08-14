# Dashboard con Totales Reales por Tabla Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard's 4 hardcoded mock KPI cards with 7 cards showing the real row count of each `axis` schema table that backs a report.

**Architecture:** A new backend endpoint `GET /api/dashboard/resumen` counts rows (excluding soft-deleted) across 7 fixed tables and returns them in a fixed order. A new Angular `DashboardService` fetches that summary once on `HomeComponent` init and renders it in the existing KPI card grid, replacing the hardcoded array.

**Tech Stack:** FastAPI + SQLAlchemy Core (async) backend; Angular 22 standalone + zoneless + vitest frontend.

## Global Constraints

- Exactly 7 tables, in this fixed order: `crv` ("CRV"), `impugnaciones` ("Impugnaciones"), `infracciones` ("Infracciones"), `juicios` ("Juicios Coactivos"), `modificacion_infracciones` ("Modificación de Infracciones"), `pagos` ("Pagos"), `titulos` ("Títulos de Crédito"). `axis.axis_libretines` is explicitly excluded.
- Every total is `COUNT(*) WHERE deleted_at IS NULL` — all 7 real tables have a `deleted_at` column (confirmed against the actual database).
- The endpoint requires only `require_active_user` (any authenticated user without a pending mandatory password change) — not admin-only, same as the existing reports.
- No audit event is logged for this endpoint (it's a read-only aggregate count, not a search or export).
- The "Actividad Reciente" table on the Dashboard is not touched.
- The 4 new minimal table definitions (`axis_crv`, `axis_modificacion_infracciones`, `axis_pagos`, `axis_titulos`) only model `id` and `deleted_at` — not their other real columns, since this feature doesn't need them.

---

### Task 1: Backend — table definitions, schema, and endpoint

**Files:**
- Modify: `apps/api/app/axis_tables.py`
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/routers/dashboard.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_dashboard_routes.py` (new)

**Interfaces:**
- Consumes: `require_active_user` (from `app.routers.auth`), `get_db` (from `app.database`).
- Produces: `GET /api/dashboard/resumen` → `DashboardResumenResponse` (`{"tablas": [{"tabla": str, "etiqueta": str, "total": int}, ...]}`), 7 items in the fixed order above, consumed by Task 2's frontend service.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_dashboard_routes.py`:

```python
from datetime import datetime, timezone

import pytest
import pytest_asyncio
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


@pytest_asyncio.fixture
async def _crv_row_ids(db_session):
    ids: list[int] = []
    yield ids
    if ids:
        await db_session.execute(text("DELETE FROM axis.axis_crv WHERE id = ANY(:ids)"), {"ids": ids})
        await db_session.commit()


async def _insert_crv_row(db_session, crv_ids, deleted_at=None):
    result = await db_session.execute(
        text("INSERT INTO axis.axis_crv (deleted_at) VALUES (:deleted_at) RETURNING id"),
        {"deleted_at": deleted_at},
    )
    new_id = result.scalar_one()
    crv_ids.append(new_id)
    await db_session.commit()
    return new_id


EXPECTED_ORDER = [
    ("crv", "CRV"),
    ("impugnaciones", "Impugnaciones"),
    ("infracciones", "Infracciones"),
    ("juicios", "Juicios Coactivos"),
    ("modificacion_infracciones", "Modificación de Infracciones"),
    ("pagos", "Pagos"),
    ("titulos", "Títulos de Crédito"),
]


@pytest.mark.asyncio
async def test_resumen_returns_all_seven_tables_in_order(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get("/api/dashboard/resumen", headers=headers)

    assert response.status_code == 200
    body = response.json()
    tablas = [(item["tabla"], item["etiqueta"]) for item in body["tablas"]]
    assert tablas == EXPECTED_ORDER
    for item in body["tablas"]:
        assert item["total"] >= 0


@pytest.mark.asyncio
async def test_resumen_excludes_soft_deleted_rows(client, db_session, _crv_row_ids):
    headers = await _auth_headers(client, db_session)

    baseline = await client.get("/api/dashboard/resumen", headers=headers)
    baseline_total = next(
        item["total"] for item in baseline.json()["tablas"] if item["tabla"] == "crv"
    )

    await _insert_crv_row(db_session, _crv_row_ids, deleted_at=None)
    await _insert_crv_row(db_session, _crv_row_ids, deleted_at=datetime.now(timezone.utc))

    response = await client.get("/api/dashboard/resumen", headers=headers)

    assert response.status_code == 200
    new_total = next(
        item["total"] for item in response.json()["tablas"] if item["tabla"] == "crv"
    )
    assert new_total == baseline_total + 1


@pytest.mark.asyncio
async def test_resumen_without_token_returns_401(client, db_session):
    response = await client.get("/api/dashboard/resumen")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_resumen_blocked_when_must_change_password_is_true(client, db_session):
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
        "/api/dashboard/resumen", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_dashboard_routes.py -v`
Expected: all FAIL with `404 Not Found` (the route doesn't exist yet).

- [ ] **Step 3: Add the new minimal table definitions and `deleted_at` on the existing two**

In `apps/api/app/axis_tables.py`, add `Column("deleted_at", DateTime(timezone=True)),` as the last column of the existing `axis_impugnaciones` table (right before its closing `)`), so it reads:

```python
axis_impugnaciones = Table(
    "axis_impugnaciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("fecha_registro", DateTime),
    Column("fecha_acta", DateTime),
    Column("estado", Text),
    Column("codigo_infraccion_axis", Text),
    Column("contravencion", Text),
    Column("tipo_acta", Text),
    Column("articulo_original", Text),
    Column("monto_capital_original", Numeric(14, 2)),
    Column("observacion", Text),
    Column("deleted_at", DateTime(timezone=True)),
)
```

In the same file, change the end of the `axis_infracciones` table definition from:

```python
    Column("valor_intereses", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
)
```

to:

```python
    Column("valor_intereses", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
    Column("deleted_at", DateTime(timezone=True)),
)
```

Then append at the end of the file (after `axis_juicios`):

```python
axis_crv = Table(
    "axis_crv",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_modificacion_infracciones = Table(
    "axis_modificacion_infracciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_pagos = Table(
    "axis_pagos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_titulos = Table(
    "axis_titulos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)
```

No new imports are needed — `BigInteger`, `Column`, `DateTime`, `Table` are already imported at the top of this file.

- [ ] **Step 4: Add the schemas**

Append at the end of `apps/api/app/schemas.py`:

```python
class ResumenTablaItem(BaseModel):
    tabla: str
    etiqueta: str
    total: int


class DashboardResumenResponse(BaseModel):
    tablas: list[ResumenTablaItem]
```

- [ ] **Step 5: Create the router**

Create `apps/api/app/routers/dashboard.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import (
    axis_crv,
    axis_impugnaciones,
    axis_infracciones,
    axis_juicios,
    axis_modificacion_infracciones,
    axis_pagos,
    axis_titulos,
)
from app.database import get_db
from app.models import User
from app.routers.auth import require_active_user
from app.schemas import DashboardResumenResponse, ResumenTablaItem

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

TABLAS_RESUMEN = [
    ("crv", "CRV", axis_crv),
    ("impugnaciones", "Impugnaciones", axis_impugnaciones),
    ("infracciones", "Infracciones", axis_infracciones),
    ("juicios", "Juicios Coactivos", axis_juicios),
    ("modificacion_infracciones", "Modificación de Infracciones", axis_modificacion_infracciones),
    ("pagos", "Pagos", axis_pagos),
    ("titulos", "Títulos de Crédito", axis_titulos),
]


@router.get("/resumen", response_model=DashboardResumenResponse)
async def get_resumen(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_active_user),
) -> DashboardResumenResponse:
    items = []
    for tabla, etiqueta, table in TABLAS_RESUMEN:
        total = await db.scalar(
            select(func.count()).select_from(table).where(table.c.deleted_at.is_(None))
        )
        items.append(ResumenTablaItem(tabla=tabla, etiqueta=etiqueta, total=total or 0))
    return DashboardResumenResponse(tablas=items)
```

- [ ] **Step 6: Register the router in `main.py`**

In `apps/api/app/main.py`, change:

```python
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.infracciones import router as infracciones_router
from app.routers.juicios import router as juicios_router
from app.routers.reportes import router as reportes_router
```

to:

```python
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.dashboard import router as dashboard_router
from app.routers.infracciones import router as infracciones_router
from app.routers.juicios import router as juicios_router
from app.routers.reportes import router as reportes_router
```

and change:

```python
app.include_router(auth_router)
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
app.include_router(auditoria_router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_dashboard_routes.py -v`
Expected: `4 passed`

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (a pre-existing, unrelated flake, `test_decode_access_token_rejects_tampered_token`, may occasionally fail independently of this change). If you run this at the same time as another process is also running the backend test suite against the same shared local database, you may see unrelated failures in `test_auth_routes.py`/`test_audit_routes.py` with `InvalidRequestError: Could not refresh instance` — that's a concurrency collision on the `TRUNCATE TABLE app.users` test cleanup, not a real regression. Re-run alone if you see it.

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/axis_tables.py apps/api/app/schemas.py apps/api/app/routers/dashboard.py apps/api/app/main.py apps/api/tests/test_dashboard_routes.py
git commit -m "feat(api): add GET /api/dashboard/resumen endpoint"
```

---

### Task 2: Frontend — service and Dashboard cards

**Files:**
- Create: `apps/web/src/app/core/models/dashboard-resumen.model.ts`
- Create: `apps/web/src/app/core/dashboard.service.ts`
- Create: `apps/web/src/app/core/dashboard.service.spec.ts`
- Modify: `apps/web/src/app/features/home/home.component.ts`
- Modify: `apps/web/src/app/features/home/home.component.html`
- Modify: `apps/web/src/app/features/home/home.component.spec.ts`

**Interfaces:**
- Consumes: `GET /api/dashboard/resumen` (Task 1).
- Produces: `DashboardService.getResumen(): Observable<DashboardResumenResponse>`, consumed by `HomeComponent`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/core/dashboard.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DashboardService } from './dashboard.service';
import { DashboardResumenResponse } from './models/dashboard-resumen.model';
import { environment } from '../../environments/environment';

describe('DashboardService', () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DashboardService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetches the dashboard summary', () => {
    const resumen: DashboardResumenResponse = {
      tablas: [{ tabla: 'crv', etiqueta: 'CRV', total: 16 }],
    };

    service.getResumen().subscribe((res) => expect(res).toEqual(resumen));

    const req = httpMock.expectOne(`${environment.apiUrl}/dashboard/resumen`);
    expect(req.request.method).toBe('GET');
    req.flush(resumen);
  });
});
```

Replace the existing `it('displays KPI cards with placeholder metrics', ...)` test in `apps/web/src/app/features/home/home.component.spec.ts` — the whole file becomes:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/auth.service';
import { DashboardService } from '../../core/dashboard.service';
import { User } from '../../core/models/user.model';
import { DashboardResumenResponse } from '../../core/models/dashboard-resumen.model';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  const resumen: DashboardResumenResponse = {
    tablas: [
      { tabla: 'crv', etiqueta: 'CRV', total: 16 },
      { tabla: 'impugnaciones', etiqueta: 'Impugnaciones', total: 99788 },
    ],
  };

  beforeEach(async () => {
    const authService = {
      loadCurrentUser: vi.fn().mockReturnValue(of(null)),
      currentUser$: of<User | null>({ id: 1, email: 'a@b.com', full_name: 'Ana Pérez', is_admin: false, must_change_password: false }),
    };
    const dashboardService = {
      getResumen: vi.fn().mockReturnValue(of(resumen)),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('displays the current user full name', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Pérez');
  });

  it('displays real table totals from the dashboard summary', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('CRV');
    expect(text).toContain('16');
    expect(text).toContain('Impugnaciones');
    expect(text).toContain('99,788');
  });

  it('displays the recent activity table', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Actividad Reciente');
    expect(text).toContain('Juan Pérez Morales');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/dashboard.service.spec.ts" --include="src/app/features/home/home.component.spec.ts"`
Expected: FAIL — `Cannot find module './dashboard.service'`, and the `HomeComponent` test module fails to configure (no `DashboardService` provider needed/found).

- [ ] **Step 3: Create the model**

Create `apps/web/src/app/core/models/dashboard-resumen.model.ts`:

```ts
export interface ResumenTablaItem {
  tabla: string;
  etiqueta: string;
  total: number;
}

export interface DashboardResumenResponse {
  tablas: ResumenTablaItem[];
}
```

- [ ] **Step 4: Create the service**

Create `apps/web/src/app/core/dashboard.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DashboardResumenResponse } from './models/dashboard-resumen.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getResumen(): Observable<DashboardResumenResponse> {
    return this.http.get<DashboardResumenResponse>(`${environment.apiUrl}/dashboard/resumen`);
  }
}
```

- [ ] **Step 5: Update `HomeComponent`**

Replace the full contents of `apps/web/src/app/features/home/home.component.ts`:

```ts
import { Component, inject, OnInit } from '@angular/core';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { DashboardService } from '../../core/dashboard.service';
import { ResumenTablaItem } from '../../core/models/dashboard-resumen.model';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';

const LOAD_ERROR_MESSAGE = 'No se pudo cargar el resumen. Intenta de nuevo.';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe, DecimalPipe, AppShellComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);

  readonly currentUser$ = this.authService.currentUser$;

  private readonly resumenSubject = new BehaviorSubject<ResumenTablaItem[]>([]);
  readonly resumen$ = this.resumenSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  readonly actividadReciente = [
    { ciudadano: 'Juan Pérez Morales', fecha: '12 Oct 2023', monto: '$120.00', estado: 'Pagado' },
    { ciudadano: 'María Elena Castro', fecha: '11 Oct 2023', monto: '$45.50', estado: 'Pendiente' },
    { ciudadano: 'Carlos Rojas', fecha: '11 Oct 2023', monto: '$250.00', estado: 'Pendiente' },
    { ciudadano: 'Ana Silva', fecha: '10 Oct 2023', monto: '$85.00', estado: 'Pagado' },
    { ciudadano: 'Roberto Núñez', fecha: '09 Oct 2023', monto: '$300.00', estado: 'Pendiente' },
  ];

  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
    this.dashboardService.getResumen().subscribe({
      next: (resumen) => this.resumenSubject.next(resumen.tablas),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
  }
}
```

(`actividadReciente` is copied verbatim, unchanged, from the current file — only the KPI-related fields are removed and the dashboard-summary wiring is added.)

- [ ] **Step 6: Update the template**

In `apps/web/src/app/features/home/home.component.html`, replace:

```html
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
    @for (kpi of kpis; track kpi.label) {
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-[0_4px_12px_rgba(0,0,0,0.05)] hover:shadow-lg transition-shadow duration-300">
        <div class="flex items-center justify-between mb-sm">
          <span class="font-label-caps text-label-caps text-on-surface-variant uppercase bg-surface-container-low px-2 py-1 rounded-DEFAULT">{{ kpi.label }}</span>
          <div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
            <span class="material-symbols-outlined text-on-primary-container text-[20px]">{{ kpi.icon }}</span>
          </div>
        </div>
        <div class="flex items-baseline gap-xs">
          <span class="font-display-lg text-display-lg text-primary">{{ kpi.value }}</span>
          <span class="text-on-surface-variant font-body-sm text-body-sm">{{ kpi.trend }}</span>
        </div>
      </div>
    }
  </div>
```

with:

```html
  @if (error$ | async; as error) {
    <p class="text-error text-body-sm mb-md">{{ error }}</p>
  }

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
    @for (tabla of (resumen$ | async); track tabla.tabla) {
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-[0_4px_12px_rgba(0,0,0,0.05)] hover:shadow-lg transition-shadow duration-300">
        <div class="flex items-center justify-between mb-sm">
          <span class="font-label-caps text-label-caps text-on-surface-variant uppercase bg-surface-container-low px-2 py-1 rounded-DEFAULT">{{ tabla.etiqueta }}</span>
          <div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
            <span class="material-symbols-outlined text-on-primary-container text-[20px]">table_rows</span>
          </div>
        </div>
        <div class="flex items-baseline gap-xs">
          <span class="font-display-lg text-display-lg text-primary">{{ tabla.total | number }}</span>
        </div>
      </div>
    }
  </div>
```

Nothing else in the file changes — the "Actividad Reciente" section below stays exactly as-is.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/dashboard.service.spec.ts" --include="src/app/features/home/home.component.spec.ts"`
Expected: `4 passed` (1 from `dashboard.service.spec.ts` + 3 from `home.component.spec.ts`)

- [ ] **Step 8: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/core/models/dashboard-resumen.model.ts apps/web/src/app/core/dashboard.service.ts apps/web/src/app/core/dashboard.service.spec.ts apps/web/src/app/features/home/home.component.ts apps/web/src/app/features/home/home.component.html apps/web/src/app/features/home/home.component.spec.ts
git commit -m "feat(web): show real per-table totals on the Dashboard"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing unrelated flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: log in, land on the Dashboard, confirm 7 cards render with real numbers (compare against a manual `SELECT count(*)` on a couple of the tables), confirm "Actividad Reciente" still shows its existing content unchanged.
