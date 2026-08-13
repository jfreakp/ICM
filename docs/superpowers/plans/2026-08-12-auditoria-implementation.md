# Auditoría de accesos y consultas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose an audit trail of login/logout, report searches/downloads, and admin IP changes, viewable by admins in a new "Auditoría" screen.

**Architecture:** A new `app.audit_logs` table (Postgres JSONB `details` column) is written to by an explicit `registrar_evento()` call added inside each business endpoint, inside the same DB transaction as the action it audits. A new admin-only `GET /api/auditoria` endpoint reads it back, paginated. The Angular frontend gets one new screen (`AuditoriaComponent`) following the exact `ImpugnacionesComponent` pattern, plus a fix to `AuthService.logout()` so it also notifies the backend.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async, asyncpg) + Alembic + pytest/pytest-asyncio/httpx (backend); Angular 22 standalone + zoneless change detection + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-12-auditoria-design.md`

## Global Constraints

- Backend tests run against a real Postgres database via the `client`/`db_session` fixtures in `apps/api/tests/conftest.py` — there is no mocking of the DB layer. Run backend tests with `cd apps/api && .venv/bin/pytest <path> -v`.
- Each backend test file defines its **own local** helper functions (`_create_user`, `_create_admin`, etc.) rather than importing them from other test files — this matches the existing convention in `test_auth_routes.py` and `test_reportes_routes.py` (both duplicate `_create_user` independently). Do not introduce cross-test-file imports.
- `apps/api/tests/conftest.py`'s `db_session` fixture truncates `app.users ... CASCADE` after every test. Because `app.audit_logs.user_id` will have a foreign key to `app.users.id`, this `TRUNCATE ... CASCADE` automatically empties `app.audit_logs` too (Postgres truncates any table with an FK reference to a truncated table when `CASCADE` is given, regardless of whether individual rows have `NULL` in that FK column). **Do not modify `conftest.py`** — no extra cleanup code is needed for `audit_logs`.
- All Angular data loading uses `BehaviorSubject` + `AsyncPipe` (never a bare field mutated inside `.subscribe()`) — this app runs zoneless change detection, established as a hard rule in the Impugnaciones work (commits `c4b6a2c`, `c363ca4`). Frontend tests that check async-arriving data must use a `Subject` + `await fixture.whenStable()`, never a synchronous mock + manual `detectChanges()`, per the same established rigor.
- Run frontend tests with `cd apps/web && npm test -- --run` (or `npx vitest run <path>` for a single file).
- Money/date formatting, table styling, and Tailwind class names follow exactly what `ImpugnacionesComponent`/`AdministracionUsuariosComponent` already use — no new design system introduced.

---

## Backend

### Task 1: `AuditLog` model and migration

**Files:**
- Modify: `apps/api/app/models.py`
- Create: `apps/api/alembic/versions/0003_create_audit_logs.py`
- Create: `apps/api/tests/test_audit_model.py`

**Interfaces:**
- Produces: `app.models.AuditLog` (SQLAlchemy model), table `app.audit_logs`, columns `id`, `occurred_at`, `user_id` (nullable FK to `app.users.id`), `user_email`, `action`, `ip_address` (nullable), `details` (nullable JSONB dict).

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_audit_model.py`:

```python
import pytest

from app.models import AuditLog


@pytest.mark.asyncio
async def test_audit_log_persists_with_null_user_id(db_session):
    log = AuditLog(
        user_id=None,
        user_email="nobody@example.com",
        action="auth.login_failed",
        ip_address="127.0.0.1",
        details={"motivo": "credenciales_invalidas"},
    )
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)

    assert log.id is not None
    assert log.occurred_at is not None
    assert log.user_id is None
    assert log.user_email == "nobody@example.com"
    assert log.action == "auth.login_failed"
    assert log.ip_address == "127.0.0.1"
    assert log.details == {"motivo": "credenciales_invalidas"}


@pytest.mark.asyncio
async def test_audit_log_persists_with_user_id(db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(email="user@example.com", password_hash=hash_password("Sup3rSecret!"), full_name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    log = AuditLog(user_id=user.id, user_email=user.email, action="auth.login_success")
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)

    assert log.user_id == user.id
    assert log.ip_address is None
    assert log.details is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_model.py -v`
Expected: FAIL with `ImportError: cannot import name 'AuditLog' from 'app.models'`

- [ ] **Step 3: Add the `AuditLog` model**

In `apps/api/app/models.py`, add below the existing `User` class:

```python
from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "app"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app.users.id"), nullable=True)
    user_email: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

(Add the two new imports — `ForeignKey` and `JSONB` — to the existing `from sqlalchemy import ...` / add a new import line; keep the existing `Boolean, DateTime, Text, func` import and `Mapped, mapped_column` import untouched.)

- [ ] **Step 4: Write the migration**

Create `apps/api/alembic/versions/0003_create_audit_logs.py`:

```python
"""create audit_logs table

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("app.users.id"), nullable=True),
        sa.Column("user_email", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("ip_address", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        schema="app",
    )
    op.create_index("ix_audit_logs_occurred_at", "audit_logs", ["occurred_at"], schema="app")
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], schema="app")


def downgrade() -> None:
    op.drop_index("ix_audit_logs_action", table_name="audit_logs", schema="app")
    op.drop_index("ix_audit_logs_occurred_at", table_name="audit_logs", schema="app")
    op.drop_table("audit_logs", schema="app")
```

- [ ] **Step 5: Apply the migration**

Run: `cd apps/api && .venv/bin/alembic upgrade head`
Expected: output ending in `Running upgrade 0002 -> 0003, create audit_logs table`

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_model.py -v`
Expected: PASS (2 passed)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/models.py apps/api/alembic/versions/0003_create_audit_logs.py apps/api/tests/test_audit_model.py
git commit -m "feat(api): add AuditLog model and audit_logs table"
```

---

### Task 2: `registrar_evento()` audit service

**Files:**
- Create: `apps/api/app/audit.py`
- Create: `apps/api/tests/test_audit_service.py`

**Interfaces:**
- Consumes: `app.models.AuditLog` (Task 1).
- Produces: `async def registrar_evento(db: AsyncSession, *, user_id: int | None, user_email: str, action: str, ip_address: str | None = None, details: dict | None = None) -> None`, importable as `from app.audit import registrar_evento`. Does **not** call `db.commit()` — the caller's existing commit persists the row.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_audit_service.py`:

```python
import pytest
from sqlalchemy import select

from app.audit import registrar_evento
from app.models import AuditLog


@pytest.mark.asyncio
async def test_registrar_evento_adds_row_visible_before_commit(db_session):
    await registrar_evento(
        db_session,
        user_id=None,
        user_email="user@example.com",
        action="auth.login_success",
        ip_address="127.0.0.1",
        details={"foo": "bar"},
    )

    result = await db_session.execute(select(AuditLog).where(AuditLog.user_email == "user@example.com"))
    log = result.scalar_one()
    assert log.action == "auth.login_success"
    assert log.ip_address == "127.0.0.1"
    assert log.details == {"foo": "bar"}

    await db_session.commit()


@pytest.mark.asyncio
async def test_registrar_evento_does_not_commit_itself(db_session):
    await registrar_evento(
        db_session,
        user_id=None,
        user_email="norollback@example.com",
        action="auth.login_success",
    )
    await db_session.rollback()

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_email == "norollback@example.com")
    )
    assert result.scalar_one_or_none() is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.audit'`

- [ ] **Step 3: Implement the service**

Create `apps/api/app/audit.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def registrar_evento(
    db: AsyncSession,
    *,
    user_id: int | None,
    user_email: str,
    action: str,
    ip_address: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            user_email=user_email,
            action=action,
            ip_address=ip_address,
            details=details,
        )
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_service.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/audit.py apps/api/tests/test_audit_service.py
git commit -m "feat(api): add registrar_evento audit service"
```

---

### Task 3: Instrument login (success / failed / blocked-by-IP)

**Files:**
- Modify: `apps/api/app/routers/auth.py`
- Create: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `registrar_evento` (Task 2), existing `get_client_ip(request)` helper already defined in `routers/auth.py`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_audit_routes.py`:

```python
import pytest
from sqlalchemy import select

from app.auth import create_access_token, hash_password
from app.models import AuditLog, User


async def _create_user(db_session, email="user@example.com", password="Sup3rSecret!", **overrides):
    user = User(email=email, password_hash=hash_password(password), full_name="Test User", **overrides)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_admin(db_session, email="admin@example.com", password="Sup3rSecret!"):
    user = User(email=email, password_hash=hash_password(password), full_name="Admin", is_admin=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _last_audit_log(db_session, action):
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id.desc())
    )
    return result.scalars().first()


@pytest.mark.asyncio
async def test_successful_login_creates_login_success_event(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "auth.login_success")
    assert log is not None
    assert log.user_email == "user@example.com"
    assert log.ip_address == "127.0.0.1"


@pytest.mark.asyncio
async def test_wrong_password_creates_login_failed_event_with_known_user(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "wrong"}
    )

    assert response.status_code == 401
    log = await _last_audit_log(db_session, "auth.login_failed")
    assert log is not None
    assert log.user_id == user.id
    assert log.user_email == "user@example.com"


@pytest.mark.asyncio
async def test_unknown_email_creates_login_failed_event_with_null_user_id(client, db_session):
    response = await client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": "whatever"}
    )

    assert response.status_code == 401
    log = await _last_audit_log(db_session, "auth.login_failed")
    assert log is not None
    assert log.user_id is None
    assert log.user_email == "ghost@example.com"


@pytest.mark.asyncio
async def test_ip_mismatch_creates_login_blocked_ip_event(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    user.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 403
    log = await _last_audit_log(db_session, "auth.login_blocked_ip")
    assert log is not None
    assert log.user_id == user.id
    assert log.details == {"ip_esperada": "10.0.0.9"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v`
Expected: FAIL — all 4 tests fail with `log is not None` (`assert None is not None`), since no audit rows are created yet.

- [ ] **Step 3: Instrument the `login` endpoint**

In `apps/api/app/routers/auth.py`, add the import:

```python
from app.audit import registrar_evento
```

Replace the entire `login` function body with:

```python
@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    client_ip = get_client_ip(request)
    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        await registrar_evento(
            db,
            user_id=user.id if user is not None else None,
            user_email=payload.email,
            action="auth.login_failed",
            ip_address=client_ip,
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_admin:
        if user.allowed_ip is None:
            user.allowed_ip = client_ip
        elif user.allowed_ip != client_ip:
            await registrar_evento(
                db,
                user_id=user.id,
                user_email=user.email,
                action="auth.login_blocked_ip",
                ip_address=client_ip,
                details={"ip_esperada": user.allowed_ip},
            )
            await db.commit()
            raise _ip_not_allowed()
    await registrar_evento(
        db, user_id=user.id, user_email=user.email, action="auth.login_success", ip_address=client_ip
    )
    token = create_access_token(user_id=user.id, email=user.email)
    await db.commit()
    return TokenResponse(access_token=token)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py tests/test_auth_routes.py -v`
Expected: PASS (all tests in both files, including the pre-existing `test_login_auto_binds_allowed_ip_on_first_login` and `test_admin_login_is_exempt_from_ip_check`, which must keep passing unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/tests/test_audit_routes.py
git commit -m "feat(api): audit login success, failure and IP-blocked events"
```

---

### Task 4: `POST /api/auth/logout` endpoint

**Files:**
- Modify: `apps/api/app/routers/auth.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Produces: `POST /api/auth/logout` (requires bearer token), `204 No Content` on success, `401` without a valid token. Does not invalidate the JWT — it only records `auth.logout`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_audit_routes.py`:

```python
@pytest.mark.asyncio
async def test_logout_creates_event_and_returns_204(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    response = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204
    log = await _last_audit_log(db_session, "auth.logout")
    assert log is not None
    assert log.user_id == user.id
    assert log.user_email == "user@example.com"


@pytest.mark.asyncio
async def test_logout_without_token_returns_401(client, db_session):
    response = await client.post("/api/auth/logout")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v -k logout`
Expected: FAIL with `404 Not Found` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/auth.py`, add `Response` to the existing `from fastapi import ...` line (it currently imports `APIRouter, Depends, HTTPException, Request, status`), then add this new endpoint after `login` and before `me`:

```python
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="auth.logout",
        ip_address=get_client_ip(request),
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v -k logout`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/tests/test_audit_routes.py
git commit -m "feat(api): add POST /api/auth/logout with audit event"
```

---

### Task 5: Instrument Impugnaciones search and export

**Files:**
- Modify: `apps/api/app/routers/reportes.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `registrar_evento` (Task 2), `get_client_ip` from `app.routers.auth` (already exists, currently only used inside `routers/auth.py` — this task imports it into `routers/reportes.py` too).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_audit_routes.py` (add these imports at the top of the file alongside the existing ones):

```python
from datetime import datetime

import pytest_asyncio
from sqlalchemy import text

INSERT_IMPUGNACION_SQL = text(
    """
    INSERT INTO axis.axis_impugnaciones
        (registro, fecha_registro, fecha_acta, estado, codigo_infraccion_axis,
         contravencion, tipo_acta, articulo_original, monto_capital_original, observacion)
    VALUES
        (:registro, :fecha_registro, :fecha_acta, :estado, :codigo_infraccion_axis,
         :contravencion, :tipo_acta, :articulo_original, :monto_capital_original, :observacion)
    RETURNING id
    """
)


def _impugnacion_row(registro, fecha_registro, estado="A"):
    return {
        "registro": registro,
        "fecha_registro": fecha_registro,
        "fecha_acta": fecha_registro,
        "estado": estado,
        "codigo_infraccion_axis": "COD-1",
        "contravencion": "Contravencion de prueba",
        "tipo_acta": "Tipo A",
        "articulo_original": "Art 1",
        "monto_capital_original": None,
        "observacion": "Observación de prueba",
    }


async def _seed_impugnaciones(db_session, rows):
    for row in rows:
        await db_session.execute(INSERT_IMPUGNACION_SQL, row)
    await db_session.commit()


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_audit_impugnaciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_impugnaciones WHERE registro LIKE 'TEST-AUD-%'"))
    await db_session.commit()


async def _auth_headers(client, db_session, email="user@example.com"):
    await _create_user(db_session, email=email, password="Sup3rSecret!")
    response = await client.post("/api/auth/login", json={"email": email, "password": "Sup3rSecret!"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_search_creates_audit_event_with_filters_and_total(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _impugnacion_row("TEST-AUD-001", datetime(2031, 6, 5), estado="A"),
            _impugnacion_row("TEST-AUD-002", datetime(2031, 6, 6), estado="A"),
        ],
    )

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "estado": "A"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.impugnaciones.search")
    assert log is not None
    assert log.details == {
        "fecha_desde": "2031-06-01",
        "fecha_hasta": "2031-06-30",
        "estado": "A",
        "page": 1,
        "total": 2,
    }


@pytest.mark.asyncio
async def test_export_creates_audit_event_with_row_count(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(db_session, [_impugnacion_row("TEST-AUD-101", datetime(2031, 7, 5), estado="A")])

    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2031-07-01", "fecha_hasta": "2031-07-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.impugnaciones.export")
    assert log is not None
    assert log.details["formato"] == "csv"
    assert log.details["filas_exportadas"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v -k "search_creates or export_creates"`
Expected: FAIL — `log is not None` assertions fail (no rows created yet).

- [ ] **Step 3: Instrument `list_impugnaciones` and `export_impugnaciones`**

In `apps/api/app/routers/reportes.py`:

Change the import line:
```python
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
```
to:
```python
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
```

Change:
```python
from app.routers.auth import get_current_user
```
to:
```python
from app.routers.auth import get_client_ip, get_current_user
```

Add:
```python
from app.audit import registrar_evento
```

Replace the `list_impugnaciones` function with:

```python
@router.get("/impugnaciones", response_model=ImpugnacionListResponse)
async def list_impugnaciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ImpugnacionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_impugnaciones).where(and_(*conditions))
    )

    columns = [axis_impugnaciones.c.id] + [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ImpugnacionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.impugnaciones.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return ImpugnacionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

Replace the `export_impugnaciones` function's signature and body up to (not including) the `if formato == "csv":` line with:

```python
@router.get("/impugnaciones/export")
async def export_impugnaciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    columns = [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"impugnaciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.impugnaciones.export",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "formato": formato,
            "filas_exportadas": len(rows),
        },
    )
    await db.commit()

```

(Leave the rest of the function — the `if formato == "csv":` block onward — exactly as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py tests/test_reportes_routes.py -v`
Expected: PASS (all tests in both files — the pre-existing `test_reportes_routes.py` tests must be unaffected, since `current_user`/`request` are additive parameters).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/reportes.py apps/api/tests/test_audit_routes.py
git commit -m "feat(api): audit impugnaciones search and export events"
```

---

### Task 6: Instrument `update_allowed_ip`

**Files:**
- Modify: `apps/api/app/routers/auth.py`
- Modify: `apps/api/tests/test_audit_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_audit_routes.py`:

```python
@pytest.mark.asyncio
async def test_update_allowed_ip_creates_audit_event_with_old_and_new_ip(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="target@example.com", password="Sup3rSecret!")
    target.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.patch(
        f"/api/auth/users/{target.id}/allowed-ip",
        json={"allowed_ip": "10.0.0.55"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "usuarios.update_allowed_ip")
    assert log is not None
    assert log.user_email == admin.email
    assert log.details == {
        "usuario_objetivo_id": target.id,
        "ip_anterior": "10.0.0.9",
        "ip_nueva": "10.0.0.55",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v -k update_allowed_ip`
Expected: FAIL with `assert None is not None`.

- [ ] **Step 3: Instrument the endpoint**

In `apps/api/app/routers/auth.py`, replace the `update_allowed_ip` function with:

```python
@router.patch("/users/{user_id}/allowed-ip", response_model=UserListItem)
async def update_allowed_ip(
    user_id: int,
    payload: UpdateAllowedIpRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    ip_anterior = user.allowed_ip
    user.allowed_ip = payload.allowed_ip
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.update_allowed_ip",
        ip_address=get_client_ip(request),
        details={
            "usuario_objetivo_id": user.id,
            "ip_anterior": ip_anterior,
            "ip_nueva": payload.allowed_ip,
        },
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py tests/test_auth_routes.py -v`
Expected: PASS (all tests, including pre-existing `test_admin_can_reset_allowed_ip`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/tests/test_audit_routes.py
git commit -m "feat(api): audit allowed-ip changes made by admins"
```

---

### Task 7: `GET /api/auditoria` read endpoint

**Files:**
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/routers/auditoria.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `app.models.AuditLog` (Task 1), `require_admin` from `app.routers.auth` (existing).
- Produces: `GET /api/auditoria?desde=&hasta=&accion=&usuario_email=&page=` → `AuditLogListResponse { items: AuditLogItem[], total, page, page_size }`, admin-only, page size 50, most-recent-first.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_audit_routes.py`:

```python
from app.audit import registrar_evento


@pytest.mark.asyncio
async def test_list_auditoria_requires_admin(client, db_session):
    user = await _create_user(db_session)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get("/api/auditoria", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_auditoria_without_token_returns_401(client, db_session):
    response = await client.get("/api/auditoria")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_auditoria_returns_events_most_recent_first(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await registrar_evento(db_session, user_id=None, user_email="a@example.com", action="auth.login_failed")
    await db_session.commit()
    await registrar_evento(db_session, user_id=None, user_email="b@example.com", action="auth.login_failed")
    await db_session.commit()

    response = await client.get("/api/auditoria", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 50
    emails = [item["user_email"] for item in body["items"]]
    assert emails.index("b@example.com") < emails.index("a@example.com")


@pytest.mark.asyncio
async def test_list_auditoria_filters_by_accion(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await registrar_evento(db_session, user_id=None, user_email="x@example.com", action="auth.login_failed")
    await registrar_evento(db_session, user_id=None, user_email="y@example.com", action="auth.logout")
    await db_session.commit()

    response = await client.get(
        "/api/auditoria",
        params={"accion": "auth.logout"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["user_email"] == "y@example.com"


@pytest.mark.asyncio
async def test_list_auditoria_filters_by_usuario_email(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await registrar_evento(db_session, user_id=None, user_email="find-me@example.com", action="auth.login_failed")
    await registrar_evento(db_session, user_id=None, user_email="not-me@example.com", action="auth.login_failed")
    await db_session.commit()

    response = await client.get(
        "/api/auditoria",
        params={"usuario_email": "find-me@example.com"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["user_email"] == "find-me@example.com"


@pytest.mark.asyncio
async def test_list_auditoria_out_of_range_page_returns_empty(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await registrar_evento(db_session, user_id=None, user_email="z@example.com", action="auth.login_failed")
    await db_session.commit()

    response = await client.get(
        "/api/auditoria",
        params={"page": 5},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v -k list_auditoria`
Expected: FAIL with `404 Not Found` (route doesn't exist).

- [ ] **Step 3: Add the schemas**

In `apps/api/app/schemas.py`, add at the end of the file:

```python
class AuditLogItem(BaseModel):
    id: int
    occurred_at: datetime
    user_id: int | None
    user_email: str
    action: str
    ip_address: str | None
    details: dict | None

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    items: list[AuditLogItem]
    total: int
    page: int
    page_size: int
```

- [ ] **Step 4: Add the router**

Create `apps/api/app/routers/auditoria.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog
from app.routers.auth import require_admin
from app.schemas import AuditLogItem, AuditLogListResponse

router = APIRouter(prefix="/api/auditoria", tags=["auditoria"])

PAGE_SIZE = 50


def _filter_conditions(
    desde: date | None, hasta: date | None, accion: str | None, usuario_email: str | None
):
    conditions = []
    if desde is not None:
        conditions.append(cast(AuditLog.occurred_at, Date) >= desde)
    if hasta is not None:
        conditions.append(cast(AuditLog.occurred_at, Date) <= hasta)
    if accion is not None:
        conditions.append(AuditLog.action == accion)
    if usuario_email is not None:
        conditions.append(AuditLog.user_email == usuario_email)
    return conditions


@router.get("", response_model=AuditLogListResponse)
async def list_auditoria(
    desde: date | None = None,
    hasta: date | None = None,
    accion: str | None = None,
    usuario_email: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
) -> AuditLogListResponse:
    conditions = _filter_conditions(desde, hasta, accion, usuario_email)

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*conditions))

    stmt = (
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.scalars(stmt)).all()
    items = [AuditLogItem.model_validate(row) for row in rows]
    return AuditLogListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
```

- [ ] **Step 5: Register the router**

In `apps/api/app/main.py`, add the import:
```python
from app.routers.auditoria import router as auditoria_router
```
and, after `app.include_router(reportes_router)`, add:
```python
app.include_router(auditoria_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_audit_routes.py -v`
Expected: PASS (all tests in the file)

Then run the full backend suite to confirm nothing else broke:
Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/schemas.py apps/api/app/routers/auditoria.py apps/api/app/main.py apps/api/tests/test_audit_routes.py
git commit -m "feat(api): add GET /api/auditoria admin-only paginated read endpoint"
```

---

## Frontend

### Task 8: Prevent an infinite logout loop in the HTTP interceptor

**Context:** Task 9 will make `AuthService.logout()` call `POST /api/auth/logout`. The existing `authInterceptor` calls `authService.logout()` on any non-login 401 response. Without this fix, a 401 coming back from `/auth/logout` itself (e.g. an already-expired token) would trigger another `logout()` call, which fires another `POST /auth/logout`, which 401s again, forever. This task must land **before** Task 9.

**Files:**
- Modify: `apps/web/src/app/core/auth.interceptor.ts`
- Modify: `apps/web/src/app/core/auth.interceptor.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/app/core/auth.interceptor.spec.ts`, inside the existing `describe('authInterceptor', ...)` block:

```ts
  it('does not log out or redirect on a 401 from the logout endpoint itself', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.post('/api/auth/logout', {}).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/logout');
    req.flush({ detail: 'No autenticado' }, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/app/core/auth.interceptor.spec.ts`
Expected: FAIL — `authService.logout` was called once, expected zero calls.

- [ ] **Step 3: Fix the interceptor**

In `apps/web/src/app/core/auth.interceptor.ts`, replace the `catchError` callback body:

```ts
  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const isLoginRequest = req.url.includes('/auth/login');
      const isLogoutRequest = req.url.includes('/auth/logout');
      if (!isLoginRequest && !isLogoutRequest && error.status === 401) {
        authService.logout();
        router.navigate(['/login']);
      } else if (!isLoginRequest && !isLogoutRequest && isIpBlocked(error)) {
        authService.logout();
        router.navigate(['/login'], { queryParams: { reason: 'ip_blocked' } });
      }
      return throwError(() => error);
    })
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/core/auth.interceptor.spec.ts`
Expected: PASS (all tests in the file, including the pre-existing 401/403 cases)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/auth.interceptor.ts apps/web/src/app/core/auth.interceptor.spec.ts
git commit -m "fix(web): exclude /auth/logout from the interceptor's auto-logout handling"
```

---

### Task 9: `AuthService.logout()` calls the backend

**Files:**
- Modify: `apps/web/src/app/core/auth.service.ts`
- Modify: `apps/web/src/app/core/auth.service.spec.ts`

**Interfaces:**
- Produces: `AuthService.logout(): void` — unchanged signature/behavior from the caller's perspective (still synchronously clears the token and emits `null`), but now also fires `POST {apiUrl}/auth/logout` without waiting for or depending on its result.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/core/auth.service.spec.ts`, replace the existing test:

```ts
  it('clears the token and emits null on logout', () => {
    localStorage.setItem('access_token', 'fake-token');
    service.logout();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });
```

with:

```ts
  it('calls the logout endpoint and clears the token on logout', () => {
    localStorage.setItem('access_token', 'fake-token');

    service.logout();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('still clears the token locally even if the logout call fails', () => {
    localStorage.setItem('access_token', 'fake-token');

    service.logout();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    req.flush({ detail: 'error' }, { status: 500, statusText: 'Server Error' });

    expect(localStorage.getItem('access_token')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/app/core/auth.service.spec.ts`
Expected: FAIL — `httpMock.expectOne` finds no matching request for `${environment.apiUrl}/auth/logout`.

- [ ] **Step 3: Implement**

In `apps/web/src/app/core/auth.service.ts`, replace:

```ts
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.currentUserSubject.next(null);
  }
```

with:

```ts
  logout(): void {
    this.http.post(`${environment.apiUrl}/auth/logout`, {}).subscribe({ error: () => {} });
    localStorage.removeItem(TOKEN_KEY);
    this.currentUserSubject.next(null);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/core/auth.service.spec.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/auth.service.ts apps/web/src/app/core/auth.service.spec.ts
git commit -m "feat(web): notify the backend on logout"
```

---

### Task 10: `AuditLog` frontend model and `AuditoriaService`

**Files:**
- Create: `apps/web/src/app/core/models/audit-log.model.ts`
- Create: `apps/web/src/app/core/auditoria.service.ts`
- Create: `apps/web/src/app/core/auditoria.service.spec.ts`

**Interfaces:**
- Produces:
  - `AuditLogItem { id, occurred_at, user_id, user_email, action, ip_address, details }`
  - `AuditLogListResponse { items: AuditLogItem[], total, page, page_size }`
  - `AuditLogFilters { desde: string | null, hasta: string | null, accion: string | null, usuarioEmail: string | null }`
  - `AuditoriaService.listEventos(filters: AuditLogFilters, page: number): Observable<AuditLogListResponse>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/core/models/audit-log.model.ts`:

```ts
export interface AuditLogItem {
  id: number;
  occurred_at: string;
  user_id: number | null;
  user_email: string;
  action: string;
  ip_address: string | null;
  details: Record<string, unknown> | null;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditLogFilters {
  desde: string | null;
  hasta: string | null;
  accion: string | null;
  usuarioEmail: string | null;
}
```

Create `apps/web/src/app/core/auditoria.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuditoriaService } from './auditoria.service';
import { AuditLogListResponse } from './models/audit-log.model';
import { environment } from '../../environments/environment';

describe('AuditoriaService', () => {
  let service: AuditoriaService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuditoriaService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuditoriaService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listEventos omits optional filters when not set', () => {
    const response: AuditLogListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service.listEventos({ desde: null, hasta: null, accion: null, usuarioEmail: null }, 1).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auditoria`);
    expect(req.request.params.has('desde')).toBe(false);
    expect(req.request.params.has('hasta')).toBe(false);
    expect(req.request.params.has('accion')).toBe(false);
    expect(req.request.params.has('usuario_email')).toBe(false);
    expect(req.request.params.get('page')).toBe('1');
    req.flush(response);
  });

  it('listEventos includes all filters when set', () => {
    service
      .listEventos(
        { desde: '2026-08-01', hasta: '2026-08-31', accion: 'auth.login_success', usuarioEmail: 'a@b.com' },
        2
      )
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auditoria`);
    expect(req.request.params.get('desde')).toBe('2026-08-01');
    expect(req.request.params.get('hasta')).toBe('2026-08-31');
    expect(req.request.params.get('accion')).toBe('auth.login_success');
    expect(req.request.params.get('usuario_email')).toBe('a@b.com');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/app/core/auditoria.service.spec.ts`
Expected: FAIL with a module resolution error (`./auditoria.service` doesn't exist).

- [ ] **Step 3: Implement the service**

Create `apps/web/src/app/core/auditoria.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuditLogFilters, AuditLogListResponse } from './models/audit-log.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: AuditLogFilters): HttpParams {
  let params = new HttpParams();
  if (filters.desde) params = params.set('desde', filters.desde);
  if (filters.hasta) params = params.set('hasta', filters.hasta);
  if (filters.accion) params = params.set('accion', filters.accion);
  if (filters.usuarioEmail) params = params.set('usuario_email', filters.usuarioEmail);
  return params;
}

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private readonly http = inject(HttpClient);

  listEventos(filters: AuditLogFilters, page: number): Observable<AuditLogListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<AuditLogListResponse>(`${environment.apiUrl}/auditoria`, { params });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/app/core/auditoria.service.spec.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/models/audit-log.model.ts apps/web/src/app/core/auditoria.service.ts apps/web/src/app/core/auditoria.service.spec.ts
git commit -m "feat(web): add AuditLog model and AuditoriaService"
```

---

### Task 11: Sidebar link to "Auditoría"

**Files:**
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.ts`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.html`
- Modify: `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`

**Interfaces:**
- Produces: `AppShellRoute` now includes `'auditoria'`. `<app-shell activeRoute="auditoria">` is now a valid usage (needed by Task 12).

- [ ] **Step 1: Write the failing tests**

Append to the `describe('AppShellComponent', ...)` block in `apps/web/src/app/shared/app-shell/app-shell.component.spec.ts`:

```ts
  it('shows the Auditoría link when the current user is an admin', () => {
    authService.currentUser$ = of(ADMIN_USER);
    createComponent();

    const auditoriaLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/auditoria"]');
    expect(auditoriaLink).not.toBeNull();
  });

  it('hides the Auditoría link when the current user is not an admin', () => {
    authService.currentUser$ = of(NON_ADMIN_USER);
    createComponent();

    const auditoriaLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/auditoria"]');
    expect(auditoriaLink).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/app/shared/app-shell/app-shell.component.spec.ts`
Expected: FAIL — both new tests find no `a[href="/auditoria"]` (the admin case expects one and finds none).

- [ ] **Step 3: Add the route type and sidebar link**

In `apps/web/src/app/shared/app-shell/app-shell.component.ts`, change:
```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'usuarios';
```
to:
```ts
export type AppShellRoute = 'dashboard' | 'impugnaciones' | 'usuarios' | 'auditoria';
```

In `apps/web/src/app/shared/app-shell/app-shell.component.html`, replace:
```html
        @if ((currentUser$ | async)?.is_admin) {
          <li>
            <a routerLink="/usuarios" [class]="navLinkClass('usuarios')">
              <span class="material-symbols-outlined text-[20px]">manage_accounts</span>
              <span class="font-body-sm text-body-sm">Administración de Usuarios</span>
            </a>
          </li>
        }
```
with:
```html
        @if ((currentUser$ | async)?.is_admin) {
          <li>
            <a routerLink="/usuarios" [class]="navLinkClass('usuarios')">
              <span class="material-symbols-outlined text-[20px]">manage_accounts</span>
              <span class="font-body-sm text-body-sm">Administración de Usuarios</span>
            </a>
          </li>
          <li>
            <a routerLink="/auditoria" [class]="navLinkClass('auditoria')">
              <span class="material-symbols-outlined text-[20px]">history</span>
              <span class="font-body-sm text-body-sm">Auditoría</span>
            </a>
          </li>
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/shared/app-shell/app-shell.component.spec.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shared/app-shell/app-shell.component.ts apps/web/src/app/shared/app-shell/app-shell.component.html apps/web/src/app/shared/app-shell/app-shell.component.spec.ts
git commit -m "feat(web): add Auditoría link to the admin sidebar section"
```

---

### Task 12: `AuditoriaComponent` and route

**Files:**
- Create: `apps/web/src/app/features/auditoria/auditoria.component.ts`
- Create: `apps/web/src/app/features/auditoria/auditoria.component.html`
- Create: `apps/web/src/app/features/auditoria/auditoria.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `AuditoriaService.listEventos` (Task 10), `AppShellComponent` with `activeRoute="auditoria"` (Task 11).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/features/auditoria/auditoria.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { AuditoriaComponent } from './auditoria.component';
import { AuthService } from '../../core/auth.service';
import { AuditoriaService } from '../../core/auditoria.service';
import { AuditLogListResponse } from '../../core/models/audit-log.model';

describe('AuditoriaComponent', () => {
  let fixture: ComponentFixture<AuditoriaComponent>;
  let auditoriaService: { listEventos: ReturnType<typeof vi.fn> };

  const respuesta: AuditLogListResponse = {
    items: [
      {
        id: 1,
        occurred_at: '2026-08-12T10:00:00Z',
        user_id: 5,
        user_email: 'ana@icmloja.gob.ec',
        action: 'auth.login_success',
        ip_address: '10.0.0.5',
        details: {},
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  };

  beforeEach(async () => {
    auditoriaService = { listEventos: vi.fn().mockReturnValue(of(respuesta)) };

    await TestBed.configureTestingModule({
      imports: [AuditoriaComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: AuditoriaService, useValue: auditoriaService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditoriaComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Auditoría');
  });

  it('loads the first page with empty filters on init', () => {
    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: null, hasta: null, accion: null, usuarioEmail: null },
      1
    );
  });

  it('renders events fetched from AuditoriaService', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('ana@icmloja.gob.ec');
    expect(text).toContain('Inicio de sesión exitoso');
  });

  it('submits the current filters and reloads page 1', () => {
    fixture.componentInstance.form.setValue({
      desde: '2026-08-01',
      hasta: '2026-08-31',
      accion: 'auth.logout',
      usuarioEmail: 'ana@icmloja.gob.ec',
    });

    fixture.componentInstance.buscar();

    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: '2026-08-01', hasta: '2026-08-31', accion: 'auth.logout', usuarioEmail: 'ana@icmloja.gob.ec' },
      1
    );
  });

  it('requests the next page when cambiarPagina is called', () => {
    fixture.componentInstance.cambiarPagina(2);

    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: null, hasta: null, accion: null, usuarioEmail: null },
      2
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders the table once the deferred response arrives', async () => {
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      expect((localFixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('ana@icmloja.gob.ec');

      resultado$.next(respuesta);
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('ana@icmloja.gob.ec');
    });

    it('shows an error message when listEventos fails with 403', async () => {
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      resultado$.error(new HttpErrorResponse({ status: 403 }));
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No tienes permisos para ver esta página.');
    });

    it('shows the empty state message when there are no results', async () => {
      const vacio: AuditLogListResponse = { items: [], total: 0, page: 1, page_size: 50 };
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      resultado$.next(vacio);
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay eventos para estos filtros');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/app/features/auditoria/auditoria.component.spec.ts`
Expected: FAIL with a module resolution error (`./auditoria.component` doesn't exist).

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/auditoria/auditoria.component.ts`:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { AuditoriaService } from '../../core/auditoria.service';
import { AuditLogFilters, AuditLogItem, AuditLogListResponse } from '../../core/models/audit-log.model';

const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los eventos de auditoría. Intenta de nuevo.';
const FORBIDDEN_MESSAGE = 'No tienes permisos para ver esta página.';

export const ACCIONES: { value: string; label: string }[] = [
  { value: 'auth.login_success', label: 'Inicio de sesión exitoso' },
  { value: 'auth.login_failed', label: 'Inicio de sesión fallido' },
  { value: 'auth.login_blocked_ip', label: 'Inicio de sesión bloqueado por IP' },
  { value: 'auth.logout', label: 'Cierre de sesión' },
  { value: 'reportes.impugnaciones.search', label: 'Búsqueda de impugnaciones' },
  { value: 'reportes.impugnaciones.export', label: 'Descarga de impugnaciones' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];

const EMPTY_FILTERS: AuditLogFilters = { desde: null, hasta: null, accion: null, usuarioEmail: null };

@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './auditoria.component.html',
})
export class AuditoriaComponent implements OnInit {
  private readonly auditoriaService = inject(AuditoriaService);
  private readonly fb = inject(FormBuilder);

  readonly acciones = ACCIONES;

  readonly form = this.fb.nonNullable.group({
    desde: [''],
    hasta: [''],
    accion: [''],
    usuarioEmail: [''],
  });

  private readonly resultadoSubject = new BehaviorSubject<AuditLogListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private filtrosVigentes: AuditLogFilters = EMPTY_FILTERS;

  ngOnInit(): void {
    this.cargarPagina(1);
  }

  buscar(): void {
    const { desde, hasta, accion, usuarioEmail } = this.form.getRawValue();
    this.filtrosVigentes = {
      desde: desde || null,
      hasta: hasta || null,
      accion: accion || null,
      usuarioEmail: usuarioEmail || null,
    };
    this.cargarPagina(1);
  }

  cambiarPagina(page: number): void {
    this.cargarPagina(page);
  }

  accionLabel(action: string): string {
    return this.acciones.find((a) => a.value === action)?.label ?? action;
  }

  detalle(item: AuditLogItem): string {
    const d = item.details ?? {};
    switch (item.action) {
      case 'auth.login_blocked_ip':
        return `IP esperada: ${d['ip_esperada']}`;
      case 'reportes.impugnaciones.search': {
        const estadoTxt = d['estado'] ? `, estado=${d['estado']}` : '';
        return `Buscó impugnaciones ${d['fecha_desde']} a ${d['fecha_hasta']}${estadoTxt}, ${d['total']} resultados`;
      }
      case 'reportes.impugnaciones.export': {
        const estadoTxt = d['estado'] ? `, estado=${d['estado']}` : '';
        return `Descargó impugnaciones ${d['fecha_desde']} a ${d['fecha_hasta']}${estadoTxt} en ${String(d['formato']).toUpperCase()}, ${d['filas_exportadas']} filas`;
      }
      case 'usuarios.update_allowed_ip':
        return `Usuario #${d['usuario_objetivo_id']}: IP ${d['ip_anterior'] ?? 'sin anclar'} → ${d['ip_nueva'] ?? 'sin anclar'}`;
      default:
        return '—';
    }
  }

  private cargarPagina(page: number): void {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.auditoriaService.listEventos(this.filtrosVigentes, page).subscribe({
      next: (resultado) => {
        this.resultadoSubject.next(resultado);
        this.loadingSubject.next(false);
      },
      error: (err) => {
        this.errorSubject.next(err?.status === 403 ? FORBIDDEN_MESSAGE : LOAD_ERROR_MESSAGE);
        this.loadingSubject.next(false);
      },
    });
  }
}
```

Create `apps/web/src/app/features/auditoria/auditoria.component.html`:

```html
<app-shell activeRoute="auditoria">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Auditoría</h2>
  </div>

  <form [formGroup]="form" (ngSubmit)="buscar()" class="bg-surface-container-lowest border border-outline-variant rounded-lg p-md mb-lg flex flex-wrap items-end gap-md">
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="desde">Desde</label>
      <input id="desde" type="date" formControlName="desde" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
    </div>
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="hasta">Hasta</label>
      <input id="hasta" type="date" formControlName="hasta" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
    </div>
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="accion">Acción</label>
      <select id="accion" formControlName="accion" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm">
        <option value="">Todas</option>
        @for (accion of acciones; track accion.value) {
          <option [value]="accion.value">{{ accion.label }}</option>
        }
      </select>
    </div>
    <div>
      <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="usuario-email">Usuario</label>
      <input id="usuario-email" type="text" formControlName="usuarioEmail" placeholder="email@ejemplo.com" class="border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
    </div>
    <button type="submit" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold">
      Filtrar
    </button>
  </form>

  @if (error$ | async; as error) {
    <p class="text-error text-body-sm mb-md">{{ error }}</p>
  }

  @if (loading$ | async) {
    <p class="text-on-surface-variant text-body-sm">Cargando...</p>
  } @else if (resultado$ | async; as resultado) {
    <div class="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
      @if (resultado.total === 0) {
        <p class="p-md text-on-surface-variant text-body-sm">No hay eventos para estos filtros</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Fecha/Hora</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Usuario</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Acción</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Detalle</th>
                <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">IP</th>
              </tr>
            </thead>
            <tbody class="font-body-sm text-body-sm divide-y divide-outline-variant/50">
              @for (item of resultado.items; track item.id) {
                <tr class="hover:bg-surface-container-lowest/50 transition-colors">
                  <td class="py-3 px-md text-on-surface-variant">{{ item.occurred_at }}</td>
                  <td class="py-3 px-md text-on-surface">{{ item.user_email }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ accionLabel(item.action) }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ detalle(item) }}</td>
                  <td class="py-3 px-md text-on-surface-variant">{{ item.ip_address }}</td>
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

- [ ] **Step 4: Register the route**

In `apps/web/src/app/app.routes.ts`, add the import:
```ts
import { AuditoriaComponent } from './features/auditoria/auditoria.component';
```
and add, after the `usuarios` route:
```ts
  { path: 'auditoria', component: AuditoriaComponent, canActivate: [authGuard] },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/features/auditoria/auditoria.component.spec.ts`
Expected: PASS (all tests in the file)

Then run the full frontend suite to confirm nothing else broke:
Run: `cd apps/web && npm test -- --run`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/auditoria apps/web/src/app/app.routes.ts
git commit -m "feat(web): add Auditoría screen with filters and pagination"
```

---

## Final verification

- [ ] Run the full backend suite: `cd apps/api && .venv/bin/pytest -v` → all green.
- [ ] Run the full frontend suite: `cd apps/web && npm test -- --run` → all green.
- [ ] Manually smoke-test: log in, browse Impugnaciones (search + one CSV download), log out, log back in as an admin, open "Auditoría" from the sidebar, and confirm the login/search/export/logout events all appear with readable Spanish labels and correct filters.
