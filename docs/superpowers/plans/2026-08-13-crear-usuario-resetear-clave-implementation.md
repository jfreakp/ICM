# Crear Usuario y Resetear Contraseña Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Nuevo Usuario" button actually create users, and add the ability for an admin to reset any user's password — both currently missing entirely (no backend endpoint, no frontend wiring).

**Architecture:** Two new admin-only, audited endpoints in `routers/auth.py` (`POST /users`, `PATCH /users/{id}/password`), following the exact patterns already used by `list_users`/`update_allowed_ip`. Two new small, standalone Angular modal components (one per action, each with its own reactive form and single responsibility), hosted conditionally by `AdministracionUsuariosComponent` via two plain boolean/nullable UI-state fields — not `BehaviorSubject`, since they're pure visibility toggles, not async data.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + pytest (backend); Angular 22 standalone + zoneless change detection + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-13-crear-usuario-resetear-clave-design.md`

## Global Constraints

- **Never run `git commit`, `git push`, or `git merge`.** At the end of every task, leave changed files as-is and report which files changed plus a suggested commit message — the user commits everything themselves. This applies to every task below, whether run by a human, the controlling session, or a dispatched subagent.
- Password minimum length: **8 characters**, enforced both client-side (`Validators.minLength(8)`) and server-side (`Field(min_length=8)`).
- Both new endpoints require admin (`Depends(require_admin)`, the existing dependency) and are audited via the existing `registrar_evento` (`app/audit.py`) — it only does `db.add(...)`, never commits itself; the endpoint's own `await db.commit()` persists the row.
- Backend tests run against a real Postgres database via `apps/api/tests/conftest.py`'s `client`/`db_session` fixtures — no mocking. Run with `cd apps/api && .venv/bin/pytest <path> -v`.
- Each backend test file defines its own local helpers, no cross-test-file imports — established convention already followed by `test_auth_routes.py` and `test_audit_routes.py`.
- All Angular data loading uses `BehaviorSubject` + `AsyncPipe`; plain component fields are reserved for pure UI-visibility state (e.g. "is this modal open"), never for anything that holds or reflects server data. Frontend tests that check data arriving after the initial render use a `Subject` + `await fixture.whenStable()`, never a synchronous mock plus a second manual `detectChanges()`.
- Run frontend tests with `cd apps/web && npx ng test --watch=false --include="<path>"` (focused) or `cd apps/web && npx ng test --watch=false` (full suite). Never a bare `npx vitest run` — it skips Angular's TestBed setup.
- New backend endpoints never return the password or password hash in any response — `UserListItem` (the existing response schema, unchanged) has no such field, and both endpoints reuse it as-is.
- The audit `details` payload for the password reset event must never contain the new password, in any form.

---

## Backend

### Task 1: `POST /api/auth/users` — create user

**Files:**
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/routers/auth.py`
- Modify: `apps/api/tests/test_auth_routes.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `require_admin`, `get_client_ip`, `registrar_evento`, `hash_password` (existing).
- Produces: `CreateUserRequest { email: EmailStr, password: str (min 8), full_name: str, is_admin: bool = False }` (Pydantic schema). `POST /api/auth/users` → `201`, body `UserListItem` of the created user. `409` if the email already exists. Records `usuarios.create_user` with `details = {usuario_creado_id, usuario_creado_email, es_admin}`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py` — first add `from sqlalchemy import select` to the file's existing imports (it currently doesn't import `select`), then add:

```python
@pytest.mark.asyncio
async def test_admin_can_create_user(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "nuevo@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "nuevo@example.com"
    assert body["full_name"] == "Nuevo Usuario"
    assert body["is_admin"] is False
    assert body["allowed_ip"] is None
    assert "password" not in body
    assert "password_hash" not in body


@pytest.mark.asyncio
async def test_created_user_password_is_hashed_and_usable_for_login(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    await client.post(
        "/api/auth/users",
        json={
            "email": "nuevo2@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    result = await db_session.execute(select(User).where(User.email == "nuevo2@example.com"))
    created = result.scalar_one()
    assert created.password_hash != "Sup3rSecret!"

    login_response = await client.post(
        "/api/auth/login", json={"email": "nuevo2@example.com", "password": "Sup3rSecret!"}
    )
    assert login_response.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_create_admin_user(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "nuevoadmin@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Admin",
            "is_admin": True,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
    assert response.json()["is_admin"] is True


@pytest.mark.asyncio
async def test_create_user_with_duplicate_email_returns_409(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await _create_user(db_session, email="existente@example.com")

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "existente@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Otro Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_non_admin_cannot_create_user(client, db_session):
    user = await _create_user(db_session, email="empleado@example.com")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "otro@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Otro Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_create_user_without_token_returns_401(client, db_session):
    response = await client.post(
        "/api/auth/users",
        json={
            "email": "sinauth@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Sin Auth",
            "is_admin": False,
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_user_with_short_password_returns_422(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "cortita@example.com",
            "password": "short",
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 422
```

Append to `apps/api/tests/test_audit_routes.py`:

```python
@pytest.mark.asyncio
async def test_create_user_creates_audit_event(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "auditado@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Usuario Auditado",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
    created_id = response.json()["id"]
    log = await _last_audit_log(db_session, "usuarios.create_user")
    assert log is not None
    assert log.user_email == admin.email
    assert log.details == {
        "usuario_creado_id": created_id,
        "usuario_creado_email": "auditado@example.com",
        "es_admin": False,
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_auth_routes.py tests/test_audit_routes.py -v -k create_user`
Expected: FAIL with `404 Not Found` (route doesn't exist yet).

- [ ] **Step 3: Add the `CreateUserRequest` schema**

In `apps/api/app/schemas.py`, change the pydantic import line:
```python
from pydantic import BaseModel, EmailStr
```
to:
```python
from pydantic import BaseModel, EmailStr, Field
```
Then add, directly after the existing `UpdateAllowedIpRequest` class:
```python
class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    is_admin: bool = False
```

- [ ] **Step 4: Implement the endpoint**

In `apps/api/app/routers/auth.py`, change the imports:
```python
from app.auth import create_access_token, decode_access_token, verify_password
```
to:
```python
from app.auth import create_access_token, decode_access_token, hash_password, verify_password
```
and:
```python
from app.schemas import LoginRequest, TokenResponse, UpdateAllowedIpRequest, UserListItem, UserOut
```
to:
```python
from app.schemas import (
    CreateUserRequest,
    LoginRequest,
    TokenResponse,
    UpdateAllowedIpRequest,
    UserListItem,
    UserOut,
)
```

Then add, directly after the `list_users` endpoint (before `update_allowed_ip`):

```python
@router.post("/users", response_model=UserListItem, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese email",
        )
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        is_admin=payload.is_admin,
    )
    db.add(user)
    await db.flush()
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.create_user",
        ip_address=get_client_ip(request),
        details={
            "usuario_creado_id": user.id,
            "usuario_creado_email": user.email,
            "es_admin": user.is_admin,
        },
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)
```

(The `await db.flush()` before `registrar_evento` is required — `user.id` doesn't exist until the row is flushed, and the audit event's `details` needs it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_auth_routes.py tests/test_audit_routes.py -v`
Expected: PASS (all tests in both files, including every pre-existing test).

Then run the full backend suite:
Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests).

- [ ] **Step 6: Report your changes (do not commit)**

Files changed: `apps/api/app/schemas.py`, `apps/api/app/routers/auth.py`, `apps/api/tests/test_auth_routes.py`, `apps/api/tests/test_audit_routes.py`. Suggested commit message: `feat(api): add POST /api/auth/users to create a new user`. Do not run `git add` or `git commit`.

---

### Task 2: `PATCH /api/auth/users/{user_id}/password` — reset password

**Files:**
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/routers/auth.py`
- Modify: `apps/api/tests/test_auth_routes.py`
- Modify: `apps/api/tests/test_audit_routes.py`

**Interfaces:**
- Consumes: `require_admin`, `get_client_ip`, `registrar_evento`, `hash_password` (Task 1's import already covers this).
- Produces: `ResetPasswordRequest { new_password: str (min 8) }`. `PATCH /api/auth/users/{user_id}/password` → `200`, body `UserListItem` of the updated user. `404` if `user_id` doesn't exist. Records `usuarios.reset_password` with `details = {usuario_objetivo_id}` — the new password never appears anywhere in the audit record.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_admin_can_reset_password(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="resetear@example.com", password="Original123!")

    response = await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert "password" not in response.json()
    assert "password_hash" not in response.json()

    old_login = await client.post(
        "/api/auth/login", json={"email": "resetear@example.com", "password": "Original123!"}
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/auth/login", json={"email": "resetear@example.com", "password": "NuevaClave123!"}
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_for_unknown_user_returns_404(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.patch(
        "/api/auth/users/9999/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_cannot_reset_password(client, db_session):
    user = await _create_user(db_session, email="empleado2@example.com")
    other = await _create_user(db_session, email="otroempleado@example.com")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        f"/api/auth/users/{other.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_reset_password_with_short_password_returns_422(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="cortita2@example.com")

    response = await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "short"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 422
```

Append to `apps/api/tests/test_audit_routes.py`:

```python
@pytest.mark.asyncio
async def test_reset_password_creates_audit_event_without_leaking_password(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="auditreset@example.com")

    response = await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "usuarios.reset_password")
    assert log is not None
    assert log.user_email == admin.email
    assert log.details == {"usuario_objetivo_id": target.id}
    assert "NuevaClave123!" not in str(log.details)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/pytest tests/test_auth_routes.py tests/test_audit_routes.py -v -k reset_password`
Expected: FAIL with `404 Not Found` (route doesn't exist yet).

- [ ] **Step 3: Add the `ResetPasswordRequest` schema**

In `apps/api/app/schemas.py`, add directly after `CreateUserRequest`:
```python
class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
```

- [ ] **Step 4: Implement the endpoint**

In `apps/api/app/routers/auth.py`, add `ResetPasswordRequest` to the multi-line schema import from Task 1:
```python
from app.schemas import (
    CreateUserRequest,
    LoginRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateAllowedIpRequest,
    UserListItem,
    UserOut,
)
```

Then add, at the end of the file (after `update_allowed_ip`):

```python
@router.patch("/users/{user_id}/password", response_model=UserListItem)
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    user.password_hash = hash_password(payload.new_password)
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.reset_password",
        ip_address=get_client_ip(request),
        details={"usuario_objetivo_id": user.id},
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/pytest tests/test_auth_routes.py tests/test_audit_routes.py -v`
Expected: PASS (all tests in both files).

Then run the full backend suite:
Run: `cd apps/api && .venv/bin/pytest -v`
Expected: PASS (all tests). ALL BACKEND TASKS COMPLETE at this point.

- [ ] **Step 6: Report your changes (do not commit)**

Files changed: `apps/api/app/schemas.py`, `apps/api/app/routers/auth.py`, `apps/api/tests/test_auth_routes.py`, `apps/api/tests/test_audit_routes.py`. Suggested commit message: `feat(api): add PATCH /api/auth/users/{id}/password to reset a user's password`. Do not run `git add` or `git commit`.

---

## Frontend

### Task 3: `UsersService.createUser` and `.resetPassword`

**Files:**
- Modify: `apps/web/src/app/core/users.service.ts`
- Modify: `apps/web/src/app/core/users.service.spec.ts`

**Interfaces:**
- Consumes: `UserListItem` (existing model, unchanged).
- Produces: `UsersService.createUser(payload: { email: string; full_name: string; password: string; is_admin: boolean }): Observable<UserListItem>` and `.resetPassword(userId: number, newPassword: string): Observable<UserListItem>` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/app/core/users.service.spec.ts`, inside the existing `describe('UsersService', ...)` block:

```ts
  it('createUser POSTs the new user payload and returns the created user', () => {
    let result: UserListItem | undefined;
    service
      .createUser({ email: 'nuevo@example.com', full_name: 'Nuevo Usuario', password: 'Sup3rSecret!', is_admin: false })
      .subscribe((user) => (result = user));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'nuevo@example.com',
      full_name: 'Nuevo Usuario',
      password: 'Sup3rSecret!',
      is_admin: false,
    });
    const created: UserListItem = {
      id: 3,
      email: 'nuevo@example.com',
      full_name: 'Nuevo Usuario',
      is_admin: false,
      is_active: true,
      allowed_ip: null,
    };
    req.flush(created);

    expect(result).toEqual(created);
  });

  it('resetPassword PATCHes the new password for the given user', () => {
    let result: UserListItem | undefined;
    service.resetPassword(1, 'NuevaClave123!').subscribe((user) => (result = user));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users/1/password`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ new_password: 'NuevaClave123!' });
    req.flush(sampleUser);

    expect(result).toEqual(sampleUser);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/users.service.spec.ts"`
Expected: FAIL — `TypeError: service.createUser is not a function` (or similar; the method doesn't exist yet).

- [ ] **Step 3: Implement the two methods**

In `apps/web/src/app/core/users.service.ts`, add after `updateAllowedIp`:

```ts
  createUser(payload: {
    email: string;
    full_name: string;
    password: string;
    is_admin: boolean;
  }): Observable<UserListItem> {
    return this.http.post<UserListItem>(`${environment.apiUrl}/auth/users`, payload);
  }

  resetPassword(userId: number, newPassword: string): Observable<UserListItem> {
    return this.http.patch<UserListItem>(`${environment.apiUrl}/auth/users/${userId}/password`, {
      new_password: newPassword,
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/users.service.spec.ts"`
Expected: PASS (4 passed)

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/core/users.service.ts`, `apps/web/src/app/core/users.service.spec.ts`. Suggested commit message: `feat(web): add UsersService.createUser and .resetPassword`. Do not run `git add` or `git commit`.

---

### Task 4: `NuevoUsuarioModalComponent`

**Files:**
- Create: `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.ts`
- Create: `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.html`
- Create: `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.spec.ts`

**Interfaces:**
- Consumes: `UsersService.createUser` (Task 3).
- Produces: `NuevoUsuarioModalComponent` with `@Output() creado: EventEmitter<UserListItem>` and `@Output() cancelado: EventEmitter<void>` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { NuevoUsuarioModalComponent } from './nuevo-usuario-modal.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('NuevoUsuarioModalComponent', () => {
  let fixture: ComponentFixture<NuevoUsuarioModalComponent>;
  let usersService: { createUser: ReturnType<typeof vi.fn> };

  function fillForm(overrides: Partial<{ email: string; fullName: string; password: string; confirmPassword: string; isAdmin: boolean }> = {}): void {
    fixture.componentInstance.form.setValue({
      email: overrides.email ?? 'nuevo@example.com',
      fullName: overrides.fullName ?? 'Nuevo Usuario',
      password: overrides.password ?? 'Sup3rSecret!',
      confirmPassword: overrides.confirmPassword ?? 'Sup3rSecret!',
      isAdmin: overrides.isAdmin ?? false,
    });
  }

  beforeEach(async () => {
    usersService = { createUser: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [NuevoUsuarioModalComponent],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compileComponents();

    fixture = TestBed.createComponent(NuevoUsuarioModalComponent);
    fixture.detectChanges();
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-nuevo-usuario"]');
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls createUser with the mapped payload and emits creado on success', () => {
    const creado = vi.fn();
    fixture.componentInstance.creado.subscribe(creado);
    const created: UserListItem = { id: 5, email: 'nuevo@example.com', full_name: 'Nuevo Usuario', is_admin: false, is_active: true, allowed_ip: null };
    usersService.createUser.mockReturnValue(of(created));

    fillForm();
    fixture.componentInstance.guardar();

    expect(usersService.createUser).toHaveBeenCalledWith({
      email: 'nuevo@example.com',
      full_name: 'Nuevo Usuario',
      password: 'Sup3rSecret!',
      is_admin: false,
    });
    expect(creado).toHaveBeenCalledWith(created);
  });

  it('emits cancelado when cancel is clicked', () => {
    const cancelado = vi.fn();
    fixture.componentInstance.cancelado.subscribe(cancelado);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="cancelar-nuevo-usuario"]');
    button.click();

    expect(cancelado).toHaveBeenCalled();
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows the duplicate-email message on a 409 without closing the modal', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.createUser.mockReturnValue(result$);
      const creado = vi.fn();
      fixture.componentInstance.creado.subscribe(creado);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 409 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Ya existe un usuario con ese email.');
      expect(creado).not.toHaveBeenCalled();
    });

    it('shows a generic error message on a non-409 failure', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.createUser.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo crear el usuario. Intenta de nuevo.');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/nuevo-usuario-modal.component.spec.ts"`
Expected: FAIL with a module resolution error (`./nuevo-usuario-modal.component` doesn't exist).

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.ts`:

```ts
import { Component, EventEmitter, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

const DUPLICATE_EMAIL_MESSAGE = 'Ya existe un usuario con ese email.';
const GENERIC_ERROR_MESSAGE = 'No se pudo crear el usuario. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-nuevo-usuario-modal',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './nuevo-usuario-modal.component.html',
})
export class NuevoUsuarioModalComponent {
  private readonly usersService = inject(UsersService);
  private readonly fb = inject(FormBuilder);

  @Output() readonly creado = new EventEmitter<UserListItem>();
  @Output() readonly cancelado = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      fullName: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
      isAdmin: [false],
    },
    { validators: passwordsMatch }
  );

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.value;
  }

  guardar(): void {
    if (this.form.invalid) {
      return;
    }
    const { email, fullName, password, isAdmin } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.usersService.createUser({ email, full_name: fullName, password, is_admin: isAdmin }).subscribe({
      next: (usuario) => this.creado.emit(usuario),
      error: (err: HttpErrorResponse) => {
        this.errorSubject.next(err.status === 409 ? DUPLICATE_EMAIL_MESSAGE : GENERIC_ERROR_MESSAGE);
      },
    });
  }

  cancelar(): void {
    this.cancelado.emit();
  }
}
```

Create `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.html`:

```html
<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
  <div class="bg-surface-container-lowest rounded-lg shadow-lg w-full max-w-md p-lg">
    <h3 class="font-headline-md text-headline-md text-on-surface mb-md">Nuevo Usuario</h3>

    @if (error$ | async; as error) {
      <p class="text-error text-body-sm mb-md">{{ error }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="guardar()" class="flex flex-col gap-md">
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="nuevo-email">Email</label>
        <input id="nuevo-email" type="email" formControlName="email" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
      </div>
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="nuevo-nombre">Nombre completo</label>
        <input id="nuevo-nombre" type="text" formControlName="fullName" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
      </div>
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="nuevo-password">Contraseña</label>
        <input id="nuevo-password" type="password" formControlName="password" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
      </div>
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="nuevo-confirmar">Confirmar contraseña</label>
        <input id="nuevo-confirmar" type="password" formControlName="confirmPassword" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
        @if (passwordMismatch) {
          <p class="text-error text-body-sm mt-1">Las contraseñas no coinciden.</p>
        }
      </div>
      <div class="flex items-center gap-sm">
        <input id="nuevo-admin" type="checkbox" formControlName="isAdmin" />
        <label class="font-body-sm text-body-sm text-on-surface" for="nuevo-admin">Es administrador</label>
      </div>
      <div class="flex justify-end gap-sm mt-md">
        <button type="button" data-testid="cancelar-nuevo-usuario" (click)="cancelar()" class="px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm border border-outline-variant">Cancelar</button>
        <button type="submit" data-testid="guardar-nuevo-usuario" [disabled]="form.invalid" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">Guardar</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/nuevo-usuario-modal.component.spec.ts"`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/features/administracion-usuarios/nuevo-usuario-modal.component.ts`, `.html`, `.spec.ts` (all new). Suggested commit message: `feat(web): add NuevoUsuarioModalComponent`. Do not run `git add` or `git commit`.

---

### Task 5: `ResetearContrasenaModalComponent`

**Files:**
- Create: `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.ts`
- Create: `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.html`
- Create: `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.spec.ts`

**Interfaces:**
- Consumes: `UsersService.resetPassword` (Task 3), `UserListItem` (existing model).
- Produces: `ResetearContrasenaModalComponent` with `@Input({ required: true }) usuario: UserListItem`, `@Output() reseteado: EventEmitter<void>`, `@Output() cancelado: EventEmitter<void>` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ResetearContrasenaModalComponent } from './resetear-contrasena-modal.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('ResetearContrasenaModalComponent', () => {
  let fixture: ComponentFixture<ResetearContrasenaModalComponent>;
  let usersService: { resetPassword: ReturnType<typeof vi.fn> };

  const usuario: UserListItem = {
    id: 7,
    email: 'ana@example.com',
    full_name: 'Ana Silva',
    is_admin: false,
    is_active: true,
    allowed_ip: null,
  };

  function fillForm(overrides: Partial<{ password: string; confirmPassword: string }> = {}): void {
    fixture.componentInstance.form.setValue({
      password: overrides.password ?? 'NuevaClave123!',
      confirmPassword: overrides.confirmPassword ?? 'NuevaClave123!',
    });
  }

  beforeEach(async () => {
    usersService = { resetPassword: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ResetearContrasenaModalComponent],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetearContrasenaModalComponent);
    fixture.componentInstance.usuario = usuario;
    fixture.detectChanges();
  });

  it('shows the target user\'s name in the title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Silva');
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-resetear-clave"]');
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls resetPassword with the target user id and new password, and emits reseteado on success', () => {
    const reseteado = vi.fn();
    fixture.componentInstance.reseteado.subscribe(reseteado);
    usersService.resetPassword.mockReturnValue(of(usuario));

    fillForm();
    fixture.componentInstance.guardar();

    expect(usersService.resetPassword).toHaveBeenCalledWith(7, 'NuevaClave123!');
    expect(reseteado).toHaveBeenCalled();
  });

  it('emits cancelado when cancel is clicked', () => {
    const cancelado = vi.fn();
    fixture.componentInstance.cancelado.subscribe(cancelado);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="cancelar-resetear-clave"]');
    button.click();

    expect(cancelado).toHaveBeenCalled();
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows a generic error message on failure without closing the modal', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.resetPassword.mockReturnValue(result$);
      const reseteado = vi.fn();
      fixture.componentInstance.reseteado.subscribe(reseteado);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo resetear la contraseña. Intenta de nuevo.');
      expect(reseteado).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/resetear-contrasena-modal.component.spec.ts"`
Expected: FAIL with a module resolution error (`./resetear-contrasena-modal.component` doesn't exist).

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.ts`:

```ts
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

const GENERIC_ERROR_MESSAGE = 'No se pudo resetear la contraseña. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-resetear-contrasena-modal',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './resetear-contrasena-modal.component.html',
})
export class ResetearContrasenaModalComponent {
  private readonly usersService = inject(UsersService);
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) usuario!: UserListItem;
  @Output() readonly reseteado = new EventEmitter<void>();
  @Output() readonly cancelado = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.value;
  }

  guardar(): void {
    if (this.form.invalid) {
      return;
    }
    const { password } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.usersService.resetPassword(this.usuario.id, password).subscribe({
      next: () => this.reseteado.emit(),
      error: () => this.errorSubject.next(GENERIC_ERROR_MESSAGE),
    });
  }

  cancelar(): void {
    this.cancelado.emit();
  }
}
```

Create `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.html`:

```html
<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
  <div class="bg-surface-container-lowest rounded-lg shadow-lg w-full max-w-md p-lg">
    <h3 class="font-headline-md text-headline-md text-on-surface mb-md">Resetear contraseña de {{ usuario.full_name }}</h3>

    @if (error$ | async; as error) {
      <p class="text-error text-body-sm mb-md">{{ error }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="guardar()" class="flex flex-col gap-md">
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="reset-password">Contraseña nueva</label>
        <input id="reset-password" type="password" formControlName="password" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
      </div>
      <div>
        <label class="block font-label-caps text-label-caps text-on-surface-variant mb-1" for="reset-confirmar">Confirmar contraseña</label>
        <input id="reset-confirmar" type="password" formControlName="confirmPassword" class="w-full border border-outline-variant rounded-DEFAULT px-3 py-2 font-body-sm text-body-sm" />
        @if (passwordMismatch) {
          <p class="text-error text-body-sm mt-1">Las contraseñas no coinciden.</p>
        }
      </div>
      <div class="flex justify-end gap-sm mt-md">
        <button type="button" data-testid="cancelar-resetear-clave" (click)="cancelar()" class="px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm border border-outline-variant">Cancelar</button>
        <button type="submit" data-testid="guardar-resetear-clave" [disabled]="form.invalid" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">Guardar</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/resetear-contrasena-modal.component.spec.ts"`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/features/administracion-usuarios/resetear-contrasena-modal.component.ts`, `.html`, `.spec.ts` (all new). Suggested commit message: `feat(web): add ResetearContrasenaModalComponent`. Do not run `git add` or `git commit`.

---

### Task 6: Wire both modals into `AdministracionUsuariosComponent`

**Files:**
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts`
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.html`
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts`

**Interfaces:**
- Consumes: `NuevoUsuarioModalComponent` (Task 4), `ResetearContrasenaModalComponent` (Task 5).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts`, change the `usersService` mock declaration and its initialization to include the two new methods (both modals get really instantiated when shown, and each injects `UsersService` — the same mocked provider the parent uses):

Change:
```ts
  let usersService: { listUsers: ReturnType<typeof vi.fn>; updateAllowedIp: ReturnType<typeof vi.fn> };
```
to:
```ts
  let usersService: {
    listUsers: ReturnType<typeof vi.fn>;
    updateAllowedIp: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
  };
```

Change:
```ts
    usersService = {
      listUsers: vi.fn().mockReturnValue(of(usuarios)),
      updateAllowedIp: vi.fn().mockReturnValue(of({ ...usuarios[0], allowed_ip: null })),
    };
```
to:
```ts
    usersService = {
      listUsers: vi.fn().mockReturnValue(of(usuarios)),
      updateAllowedIp: vi.fn().mockReturnValue(of({ ...usuarios[0], allowed_ip: null })),
      createUser: vi.fn(),
      resetPassword: vi.fn(),
    };
```

Then add these tests to the top-level `describe('AdministracionUsuariosComponent', ...)` block (alongside the existing `it('renders the page title', ...)` etc.):

```ts
  it('opens the new-user modal when "Nuevo Usuario" is clicked', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="nuevo-usuario-btn"]');
    button.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('app-nuevo-usuario-modal');
    expect(modal).not.toBeNull();
  });

  it('opens the reset-password modal for the clicked row', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelectorAll('[data-testid="resetear-clave-btn"]')[0];
    button.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('app-resetear-contrasena-modal');
    expect(modal).not.toBeNull();
  });
```

And add this test inside the existing `describe('async rendering under zoneless change detection', ...)` block:

```ts
    it('closes the new-user modal and reloads the list once creado fires and the deferred response arrives', async () => {
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="nuevo-usuario-btn"]');
      button.click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-nuevo-usuario-modal')).not.toBeNull();

      const reload$ = new Subject<UserListItem[]>();
      usersService.listUsers.mockReturnValue(reload$);

      fixture.componentInstance.onUsuarioCreado();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-nuevo-usuario-modal')).toBeNull();

      const nuevaLista: UserListItem[] = [
        ...usuarios,
        { id: 3, email: 'nuevo@example.com', full_name: 'Nuevo Usuario', is_admin: false, is_active: true, allowed_ip: null },
      ];
      reload$.next(nuevaLista);
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('nuevo@example.com');
      expect(text).toContain('Mostrando 3 de 3 usuarios');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts"`
Expected: FAIL — no `[data-testid="nuevo-usuario-btn"]`/`[data-testid="resetear-clave-btn"]` elements exist yet, and `onUsuarioCreado` doesn't exist on the component.

- [ ] **Step 3: Wire up the component**

Replace `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts` in full with:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';
import { NuevoUsuarioModalComponent } from './nuevo-usuario-modal.component';
import { ResetearContrasenaModalComponent } from './resetear-contrasena-modal.component';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AsyncPipe, AppShellComponent, NuevoUsuarioModalComponent, ResetearContrasenaModalComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent implements OnInit {
  private readonly usersService = inject(UsersService);

  private readonly usuariosSubject = new BehaviorSubject<UserListItem[]>([]);
  readonly usuarios$ = this.usuariosSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  mostrarModalNuevoUsuario = false;
  usuarioParaResetearClave: UserListItem | null = null;

  ngOnInit(): void {
    this.cargarUsuarios();
  }

  private cargarUsuarios(): void {
    this.usersService.listUsers().subscribe({
      next: (usuarios) => this.usuariosSubject.next(usuarios),
      error: () => this.errorSubject.next('No tienes permisos para ver esta página.'),
    });
  }

  resetAllowedIp(usuario: UserListItem): void {
    this.usersService.updateAllowedIp(usuario.id, null).subscribe({
      next: (updated) => {
        const usuarios = this.usuariosSubject.value.map((u) =>
          u.id === updated.id ? { ...u, allowed_ip: updated.allowed_ip } : u
        );
        this.usuariosSubject.next(usuarios);
      },
      error: () => this.errorSubject.next('No se pudo actualizar la IP. Intenta de nuevo.'),
    });
  }

  rolLabel(usuario: UserListItem): string {
    return usuario.is_admin ? 'Admin' : 'Employee';
  }

  estadoLabel(usuario: UserListItem): string {
    return usuario.is_active ? 'Activo' : 'Inactivo';
  }

  estadoBadgeClass(usuario: UserListItem): string {
    return usuario.is_active
      ? 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#e6f4ea] text-[#137333] border border-[#ceead6]'
      : 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#fce8e6] text-[#c5221f] border border-[#fad2cf]';
  }

  abrirModalNuevoUsuario(): void {
    this.mostrarModalNuevoUsuario = true;
  }

  cerrarModalNuevoUsuario(): void {
    this.mostrarModalNuevoUsuario = false;
  }

  onUsuarioCreado(): void {
    this.mostrarModalNuevoUsuario = false;
    this.cargarUsuarios();
  }

  abrirModalResetearClave(usuario: UserListItem): void {
    this.usuarioParaResetearClave = usuario;
  }

  cerrarModalResetearClave(): void {
    this.usuarioParaResetearClave = null;
  }

  onClaveReseteada(): void {
    this.usuarioParaResetearClave = null;
  }
}
```

Replace `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.html` in full with:

```html
<app-shell activeRoute="usuarios">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Administración de Usuarios</h2>
    <button type="button" data-testid="nuevo-usuario-btn" (click)="abrirModalNuevoUsuario()" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold flex items-center gap-2 transition-colors shadow-sm">
      <span class="material-symbols-outlined text-[18px]">add</span>
      Nuevo Usuario
    </button>
  </div>

  @if (error$ | async; as error) {
    <p class="text-error text-body-sm mb-md">{{ error }}</p>
  }

  <div class="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
    <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-bright">
      <div class="relative w-64">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">search</span>
        <input type="text" placeholder="Buscar usuarios..." class="w-full pl-10 pr-3 py-2 border border-outline-variant rounded-DEFAULT font-body-sm text-body-sm bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow" />
      </div>
    </div>
    @if (usuarios$ | async; as usuarios) {
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Nombre</th>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Email</th>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Rol</th>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">Estado</th>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant">IP anclada</th>
              <th class="py-3 px-md font-label-caps text-label-caps text-on-surface-variant"></th>
            </tr>
          </thead>
          <tbody class="font-body-sm text-body-sm divide-y divide-outline-variant/50">
            @for (usuario of usuarios; track usuario.id) {
              <tr class="hover:bg-surface-container-lowest/50 transition-colors">
                <td class="py-3 px-md font-medium text-on-surface">{{ usuario.full_name }}</td>
                <td class="py-3 px-md text-on-surface-variant">{{ usuario.email }}</td>
                <td class="py-3 px-md text-on-surface-variant">{{ rolLabel(usuario) }}</td>
                <td class="py-3 px-md">
                  <span [class]="estadoBadgeClass(usuario)">{{ estadoLabel(usuario) }}</span>
                </td>
                <td class="py-3 px-md text-on-surface-variant">{{ usuario.allowed_ip ?? 'Sin anclar' }}</td>
                <td class="py-3 px-md flex items-center gap-sm">
                  @if (usuario.allowed_ip) {
                    <button
                      type="button"
                      (click)="resetAllowedIp(usuario)"
                      class="text-primary hover:underline font-body-sm text-body-sm"
                    >
                      Resetear IP
                    </button>
                  }
                  <button
                    type="button"
                    data-testid="resetear-clave-btn"
                    (click)="abrirModalResetearClave(usuario)"
                    class="text-primary hover:underline font-body-sm text-body-sm"
                  >
                    Resetear Contraseña
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="p-md border-t border-outline-variant flex items-center justify-between bg-surface-bright">
        <span class="font-body-sm text-body-sm text-on-surface-variant">Mostrando {{ usuarios.length }} de {{ usuarios.length }} usuarios</span>
      </div>
    }
  </div>

  @if (mostrarModalNuevoUsuario) {
    <app-nuevo-usuario-modal
      (creado)="onUsuarioCreado()"
      (cancelado)="cerrarModalNuevoUsuario()"
    ></app-nuevo-usuario-modal>
  }

  @if (usuarioParaResetearClave) {
    <app-resetear-contrasena-modal
      [usuario]="usuarioParaResetearClave"
      (reseteado)="onClaveReseteada()"
      (cancelado)="cerrarModalResetearClave()"
    ></app-resetear-contrasena-modal>
  }
</app-shell>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts"`
Expected: PASS (all tests in the file, including every pre-existing one)

Then run the full frontend suite to confirm zero regressions:
Run: `cd apps/web && npx ng test --watch=false`
Expected: PASS (all tests). ALL FRONTEND TASKS COMPLETE at this point.

- [ ] **Step 5: Report your changes (do not commit)**

Files changed: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts`, `.html`, `.spec.ts`. Suggested commit message: `feat(web): wire Nuevo Usuario and Resetear Contraseña modals into Administración de Usuarios`. Do not run `git add` or `git commit`.

---

## Final verification

- [ ] Run the full backend suite: `cd apps/api && .venv/bin/pytest -v` → all green.
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` → all green.
- [ ] Manually smoke-test: log in as the admin user, open Administración de Usuarios, click "Nuevo Usuario", create a regular (non-admin) user with an 8+ character password, confirm it appears in the list; click "Nuevo Usuario" again and try the same email — confirm the duplicate-email message shows without closing the modal; click "Resetear Contraseña" on a row, set a new password, confirm the modal closes and that a fresh login with the new password works while the old password no longer does; open Auditoría and confirm both `usuarios.create_user` and `usuarios.reset_password` events appear with readable details and without any password value visible anywhere.
