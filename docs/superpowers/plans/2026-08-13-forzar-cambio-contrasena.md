# Forzar Cambio de Contraseña en Primer Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin creates a user or resets someone's password, that account must change its password on next login before it can use anything else in the system.

**Architecture:** A new `must_change_password` boolean column on `app.users` (default `False`) gets set to `True` by the admin-create and admin-reset-password endpoints. A new FastAPI dependency `require_active_user` blocks any request from an account with the flag set (`403 password_change_required`), applied everywhere `get_current_user`/`require_admin` currently gate a route except `GET /me`, the new self-service `PATCH /me/password`, and `POST /logout`. The Angular frontend gets a new `/cambiar-contrasena` page, a post-login redirect based on the flag, and an HTTP-interceptor branch that redirects there whenever the backend returns the new 403 code.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic (backend); Angular 22 standalone components + zoneless change detection + vitest (frontend).

## Global Constraints

- `must_change_password` defaults to `False`; migration must set `server_default=false` so existing rows are unaffected.
- Only `create_user` (`POST /api/auth/users`) and `reset_password` (`PATCH /api/auth/users/{id}/password`) set the flag to `True`. `seed_user.py` is untouched — it never sets the flag.
- Enforcement happens in the backend, not just the frontend: any endpoint gated by `get_current_user` or `require_admin`, in ANY router, must reject with `403 {"code": "password_change_required", "message": "Debes cambiar tu contraseña"}` when the authenticated user has `must_change_password=True`. The only three exceptions, repo-wide: `GET /api/auth/me`, `PATCH /api/auth/me/password`, `POST /api/auth/logout`.
- The new self-service endpoint requires the caller's current password before accepting a new one.
- Password length rules match the rest of the app: `Field(min_length=8, max_length=72)` (72 to stay inside bcrypt's byte-truncation safety margin, same as `CreateUserRequest`/`ResetPasswordRequest`).
- Frontend password validators mirror the existing modals: `Validators.minLength(8)`, `Validators.maxLength(72)`, plus a cross-field match validator between new password and confirmation.
- On a 403 `password_change_required`, the frontend interceptor redirects to `/cambiar-contrasena` but does **not** log the user out (unlike the existing `ip_not_allowed` handling) — the token must remain valid so the browser can call the self-service endpoint.

---

### Task 1: `must_change_password` column and model field

**Files:**
- Create: `apps/api/alembic/versions/0004_add_must_change_password_to_users.py`
- Modify: `apps/api/app/models.py:19-20`
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Produces: `User.must_change_password: bool` (default `False`), used by every later task.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_new_user_defaults_must_change_password_to_false(db_session):
    user = await _create_user(db_session, email="defaultflag@example.com")
    assert user.must_change_password is False


@pytest.mark.asyncio
async def test_user_can_be_created_with_must_change_password_true(db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="flagged@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Flagged User",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    assert user.must_change_password is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password" -v`
Expected: FAIL with `TypeError: 'must_change_password' is an invalid keyword argument for User` (or `AttributeError`).

- [ ] **Step 3: Add the model field**

In `apps/api/app/models.py`, the `User` class currently reads (lines 19-20):

```python
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_ip: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Change to:

```python
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

- [ ] **Step 4: Write the migration**

Create `apps/api/alembic/versions/0004_add_must_change_password_to_users.py`:

```python
"""add must_change_password to users

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password", schema="app")
```

- [ ] **Step 5: Apply the migration to the local dev database**

Run: `cd apps/api && alembic upgrade head`
Expected: output ends with `Running upgrade 0003 -> 0004, add must_change_password to users`

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password" -v`
Expected: `2 passed`

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/models.py apps/api/alembic/versions/0004_add_must_change_password_to_users.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): add must_change_password column to users"
```

---

### Task 2: `require_active_user` dependency, applied repo-wide

**Files:**
- Modify: `apps/api/app/routers/auth.py:60-66` (add dependency, rewire `require_admin`)
- Modify: `apps/api/app/routers/reportes.py:16,60,80,135`
- Modify: `apps/api/app/routers/infracciones.py:17,92,112,167`
- Test: `apps/api/tests/test_auth_routes.py`
- Test: `apps/api/tests/test_reportes_routes.py`
- Test: `apps/api/tests/test_infracciones_routes.py`

**Interfaces:**
- Consumes: `User.must_change_password` (Task 1).
- Produces: `require_active_user` dependency function in `app/routers/auth.py`, importable as `from app.routers.auth import require_active_user`. Raises `HTTPException(403, detail={"code": "password_change_required", "message": "Debes cambiar tu contraseña"})` when `current_user.must_change_password` is `True`; otherwise returns the `User` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_admin_action_blocked_when_must_change_password_is_true(client, db_session):
    from app.auth import hash_password
    from app.models import User

    admin = User(
        email="pendiente@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Admin Pendiente",
        is_admin=True,
        must_change_password=True,
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"


@pytest.mark.asyncio
async def test_admin_action_allowed_when_must_change_password_is_false(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_logout_is_exempt_from_the_password_change_block(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="logoutpendiente@example.com",
        password_hash=hash_password("Temporal123!"),
        full_name="Usuario",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204
```

Note: unlike the other tests in this task, `test_logout_is_exempt_from_the_password_change_block` already passes before Step 3's implementation — `logout` depends directly on `get_current_user` and is never wired to `require_active_user`, so nothing in this task changes its behavior. It's included here as a regression lock on that exemption (per the Global Constraints list of three exempt endpoints), not as a RED-then-GREEN test. Step 2 below only expects the *other* two tests to fail.

Append to `apps/api/tests/test_reportes_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_estados_blocked_when_must_change_password_is_true(client, db_session):
    from app.auth import create_access_token, hash_password
    from app.models import User

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
        "/api/reportes/impugnaciones/estados", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
```

Append to `apps/api/tests/test_infracciones_routes.py`:

```python
@pytest.mark.asyncio
async def test_list_estados_infracciones_blocked_when_must_change_password_is_true(client, db_session):
    from app.auth import create_access_token, hash_password
    from app.models import User

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
        "/api/infracciones/infracciones/estados", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_is_true or must_change_password_is_false" -v`
Expected: FAIL — `test_admin_action_blocked_when_must_change_password_is_true` gets `200` instead of `403` (the block doesn't exist yet). `test_admin_action_allowed_when_must_change_password_is_false` already passes (nothing blocks it yet either) — it exists to guard against a future regression, not to go RED here.

(`test_logout_is_exempt_from_the_password_change_block` is not part of this RED check — it already passes, per the note above it — but it does get run and confirmed in Step 6 below.)

Run: `cd apps/api && pytest tests/test_reportes_routes.py -k "must_change_password" -v`
Expected: FAIL — gets `200` instead of `403`.

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -k "must_change_password" -v`
Expected: FAIL — gets `200` instead of `403`.

- [ ] **Step 3: Add `require_active_user` and rewire `require_admin`**

In `apps/api/app/routers/auth.py`, replace lines 60-66:

```python
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "admin_required", "message": "Requiere permisos de administrador"},
        )
    return current_user
```

with:

```python
async def require_active_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Debes cambiar tu contraseña"},
        )
    return current_user


async def require_admin(current_user: User = Depends(require_active_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "admin_required", "message": "Requiere permisos de administrador"},
        )
    return current_user
```

- [ ] **Step 4: Rewire `reportes.py` to use `require_active_user`**

In `apps/api/app/routers/reportes.py:16`, change:

```python
from app.routers.auth import get_client_ip, get_current_user
```

to:

```python
from app.routers.auth import get_client_ip, require_active_user
```

Then replace all 3 occurrences of `Depends(get_current_user)` in that file (lines 60, 80, 135) with `Depends(require_active_user)`. The surrounding code (parameter names `_user`/`current_user`, everything else) stays exactly the same — only the dependency function changes.

- [ ] **Step 5: Rewire `infracciones.py` to use `require_active_user`**

In `apps/api/app/routers/infracciones.py:17`, change:

```python
from app.routers.auth import get_client_ip, get_current_user
```

to:

```python
from app.routers.auth import get_client_ip, require_active_user
```

Then replace all 3 occurrences of `Depends(get_current_user)` in that file (lines 92, 112, 167) with `Depends(require_active_user)`.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_is_true or must_change_password_is_false or logout_is_exempt" -v`
Expected: `3 passed`

Run: `cd apps/api && pytest tests/test_reportes_routes.py -k "must_change_password" -v`
Expected: `1 passed`

Run: `cd apps/api && pytest tests/test_infracciones_routes.py -k "must_change_password" -v`
Expected: `1 passed`

- [ ] **Step 7: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (the pre-existing `test_decode_access_token_rejects_tampered_token` flake is unrelated and may occasionally fail independently of this change).

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/app/routers/reportes.py apps/api/app/routers/infracciones.py apps/api/tests/test_auth_routes.py apps/api/tests/test_reportes_routes.py apps/api/tests/test_infracciones_routes.py
git commit -m "feat(api): block pending-password-change users from all protected endpoints"
```

---

### Task 3: Self-service `PATCH /api/auth/me/password` endpoint

**Files:**
- Modify: `apps/api/app/schemas.py` (add `ChangeOwnPasswordRequest`, add field to `UserOut`)
- Modify: `apps/api/app/routers/auth.py` (add endpoint, update import list)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `require_active_user` (Task 2, used to prove the new endpoint is exempt from it), `verify_password`/`hash_password` (already imported in `auth.py`).
- Produces: `PATCH /api/auth/me/password` — request `{current_password: str, new_password: str}`, response `UserOut` (now including `must_change_password: bool`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_me_includes_must_change_password_field(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["must_change_password"] is False


@pytest.mark.asyncio
async def test_change_own_password_succeeds_and_clears_flag(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="cambiar@example.com",
        password_hash=hash_password("Temporal123!"),
        full_name="Usuario",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        "/api/auth/me/password",
        json={"current_password": "Temporal123!", "new_password": "Definitiva456!"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["must_change_password"] is False

    old_login = await client.post(
        "/api/auth/login", json={"email": "cambiar@example.com", "password": "Temporal123!"}
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/auth/login", json={"email": "cambiar@example.com", "password": "Definitiva456!"}
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_change_own_password_with_wrong_current_password_returns_401(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="malaclave@example.com",
        password_hash=hash_password("Temporal123!"),
        full_name="Usuario",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        "/api/auth/me/password",
        json={"current_password": "Incorrecta!", "new_password": "Definitiva456!"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    await db_session.refresh(user)
    assert user.must_change_password is True


@pytest.mark.asyncio
async def test_change_own_password_works_even_while_flag_is_active(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="bloqueado@example.com",
        password_hash=hash_password("Temporal123!"),
        full_name="Usuario",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    blocked = await client.get(
        "/api/reportes/impugnaciones/estados", headers={"Authorization": f"Bearer {token}"}
    )
    assert blocked.status_code == 403

    allowed = await client.patch(
        "/api/auth/me/password",
        json={"current_password": "Temporal123!", "new_password": "Definitiva456!"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_change_own_password_with_short_new_password_returns_422(client, db_session):
    await _create_user(db_session, email="cortita@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "cortita@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    response = await client.patch(
        "/api/auth/me/password",
        json={"current_password": "Sup3rSecret!", "new_password": "short"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_field or change_own_password" -v`
Expected: FAIL — `must_change_password` missing from the `/me` response (`KeyError`/`AssertionError`), and `PATCH /api/auth/me/password` returns `404 Not Found` (route doesn't exist yet).

- [ ] **Step 3: Add `ChangeOwnPasswordRequest` and update `UserOut`**

In `apps/api/app/schemas.py`, replace:

```python
class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool

    model_config = {"from_attributes": True}
```

with:

```python
class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool
    must_change_password: bool

    model_config = {"from_attributes": True}
```

Then add, near `ResetPasswordRequest`:

```python
class ChangeOwnPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)
```

- [ ] **Step 4: Add the endpoint**

In `apps/api/app/routers/auth.py`, update the import block (lines 11-19) to include the new schema:

```python
from app.schemas import (
    ChangeOwnPasswordRequest,
    CreateUserRequest,
    LoginRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateAllowedIpRequest,
    UserListItem,
    UserOut,
)
```

Then add this endpoint right after the `me` endpoint (after line 124, before `@router.get("/users", ...)`):

```python
@router.patch("/me/password", response_model=UserOut)
async def change_own_password(
    payload: ChangeOwnPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Contraseña actual incorrecta"
        )
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="auth.change_own_password",
        ip_address=get_client_ip(request),
    )
    await db.commit()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)
```

Note this depends on `get_current_user` directly (not `require_active_user`) — it must keep working while the flag is set.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_field or change_own_password" -v`
Expected: `5 passed`

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (aside from the pre-existing unrelated flake noted in Task 2).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/schemas.py apps/api/app/routers/auth.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): add self-service password change endpoint"
```

---

### Task 4: `create_user` and `reset_password` set the flag

**Files:**
- Modify: `apps/api/app/routers/auth.py:148-153` (`create_user`)
- Modify: `apps/api/app/routers/auth.py:214` (`reset_password`)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `User.must_change_password` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_created_user_must_change_password_is_true(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    await client.post(
        "/api/auth/users",
        json={
            "email": "flagcreado@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    result = await db_session.execute(select(User).where(User.email == "flagcreado@example.com"))
    created = result.scalar_one()
    assert created.must_change_password is True


@pytest.mark.asyncio
async def test_reset_password_sets_must_change_password_true(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="flagreset@example.com", password="Original123!")

    await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    await db_session.refresh(target)
    assert target.must_change_password is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_is_true" -v`
Expected: FAIL — both assertions get `False` instead of `True`.

- [ ] **Step 3: Update `create_user`**

In `apps/api/app/routers/auth.py`, replace:

```python
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        is_admin=payload.is_admin,
    )
```

with:

```python
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        is_admin=payload.is_admin,
        must_change_password=True,
    )
```

- [ ] **Step 4: Update `reset_password`**

Replace:

```python
    user.password_hash = hash_password(payload.new_password)
```

with:

```python
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = True
```

(this line appears once, inside the `reset_password` function)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "must_change_password_is_true" -v`
Expected: `2 passed`

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd apps/api && pytest -v`
Expected: all tests pass (aside from the pre-existing unrelated flake noted in Task 2).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): flag newly created and password-reset users for mandatory change"
```

---

### Task 5: Frontend `User` model and `AuthService.changeOwnPassword`

**Files:**
- Modify: `apps/web/src/app/core/models/user.model.ts`
- Modify: `apps/web/src/app/core/auth.service.ts`
- Test: `apps/web/src/app/core/auth.service.spec.ts`

**Interfaces:**
- Produces: `User.must_change_password: boolean`; `AuthService.changeOwnPassword(currentPassword: string, newPassword: string): Observable<User>` — `PATCH {apiUrl}/auth/me/password`, updates `currentUser$` with the response.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/app/core/auth.service.spec.ts`, inside the existing `describe('AuthService', ...)` block:

```ts
  it('calls the change-password endpoint and updates the current user', () => {
    let emittedUser: User | null = null;
    service.currentUser$.subscribe((user) => {
      emittedUser = user;
    });

    service.changeOwnPassword('Temporal123!', 'Definitiva456!').subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/me/password`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      current_password: 'Temporal123!',
      new_password: 'Definitiva456!',
    });
    req.flush({
      id: 1,
      email: 'user@example.com',
      full_name: 'Test User',
      is_admin: false,
      must_change_password: false,
    });

    expect((emittedUser as User | null)?.must_change_password).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/auth.service.spec.ts"`
Expected: FAIL with `TypeError: service.changeOwnPassword is not a function`

- [ ] **Step 3: Update the `User` model**

Replace the full contents of `apps/web/src/app/core/models/user.model.ts`:

```ts
export interface User {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  must_change_password: boolean;
}
```

- [ ] **Step 4: Add `changeOwnPassword` to `AuthService`**

In `apps/web/src/app/core/auth.service.ts`, add this method inside the `AuthService` class, after `loadCurrentUser()`:

```ts
  changeOwnPassword(currentPassword: string, newPassword: string): Observable<User> {
    return this.http
      .patch<User>(`${environment.apiUrl}/auth/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .pipe(tap((user) => this.currentUserSubject.next(user)));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/auth.service.spec.ts"`
Expected: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/core/models/user.model.ts apps/web/src/app/core/auth.service.ts apps/web/src/app/core/auth.service.spec.ts
git commit -m "feat(web): add changeOwnPassword to AuthService"
```

---

### Task 6: `CambiarContrasenaComponent` and its route

**Files:**
- Create: `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.ts`
- Create: `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.html`
- Create: `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `AuthService.changeOwnPassword` (Task 5), `authGuard` (existing, unchanged).

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { Mock, vi } from 'vitest';
import { CambiarContrasenaComponent } from './cambiar-contrasena.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

describe('CambiarContrasenaComponent', () => {
  let fixture: ComponentFixture<CambiarContrasenaComponent>;
  let authService: { changeOwnPassword: Mock };
  let router: { navigate: Mock };

  function fillForm(
    overrides: Partial<{ currentPassword: string; newPassword: string; confirmPassword: string }> = {}
  ): void {
    fixture.componentInstance.form.setValue({
      currentPassword: overrides.currentPassword ?? 'Temporal123!',
      newPassword: overrides.newPassword ?? 'Definitiva456!',
      confirmPassword: overrides.confirmPassword ?? 'Definitiva456!',
    });
  }

  beforeEach(async () => {
    authService = { changeOwnPassword: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CambiarContrasenaComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CambiarContrasenaComponent);
    fixture.detectChanges();
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="guardar-cambiar-contrasena"]'
    );
    expect(button.disabled).toBe(true);
  });

  it('disables submit when the new password is shorter than 8 characters', () => {
    fillForm({ newPassword: 'short1', confirmPassword: 'short1' });
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="guardar-cambiar-contrasena"]'
    );
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the new passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls changeOwnPassword and navigates to /home on success', () => {
    const updated: User = {
      id: 1,
      email: 'a@b.com',
      full_name: 'A',
      is_admin: false,
      must_change_password: false,
    };
    authService.changeOwnPassword.mockReturnValue(of(updated));

    fillForm();
    fixture.componentInstance.onSubmit();

    expect(authService.changeOwnPassword).toHaveBeenCalledWith('Temporal123!', 'Definitiva456!');
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows the wrong-current-password message on a 401 without navigating', async () => {
      const result$ = new Subject<User>();
      authService.changeOwnPassword.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.onSubmit();

      result$.error(new HttpErrorResponse({ status: 401 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Contraseña actual incorrecta.');
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('shows a generic error message on a non-401 failure', async () => {
      const result$ = new Subject<User>();
      authService.changeOwnPassword.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.onSubmit();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo cambiar la contraseña. Intenta de nuevo.');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/cambiar-contrasena/cambiar-contrasena.component.spec.ts"`
Expected: FAIL — `Cannot find module './cambiar-contrasena.component'`

- [ ] **Step 3: Create the component**

Create `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.ts`:

```ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';

const WRONG_CURRENT_PASSWORD_MESSAGE = 'Contraseña actual incorrecta.';
const GENERIC_ERROR_MESSAGE = 'No se pudo cambiar la contraseña. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const newPassword = group.get('newPassword')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return newPassword && confirmPassword && newPassword !== confirmPassword
    ? { passwordMismatch: true }
    : null;
}

@Component({
  selector: 'app-cambiar-contrasena',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './cambiar-contrasena.component.html',
})
export class CambiarContrasenaComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.value;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.authService.changeOwnPassword(currentPassword, newPassword).subscribe({
      next: () => this.router.navigate(['/home']),
      error: (err: HttpErrorResponse) => {
        this.errorSubject.next(err.status === 401 ? WRONG_CURRENT_PASSWORD_MESSAGE : GENERIC_ERROR_MESSAGE);
      },
    });
  }
}
```

- [ ] **Step 4: Create the template**

Create `apps/web/src/app/features/cambiar-contrasena/cambiar-contrasena.component.html`:

```html
<div class="min-h-screen flex items-center justify-center bg-surface p-margin-mobile md:p-margin-desktop font-body-lg text-body-lg text-on-surface">
  <main class="w-full max-w-[440px] bg-surface-container-lowest rounded-xl border border-outline-variant shadow-[0_4px_12px_rgba(0,0,0,0.05)] p-lg flex flex-col gap-lg">
    <div class="flex flex-col items-center text-center gap-sm">
      <div class="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center overflow-hidden border border-outline-variant">
        <span class="material-symbols-outlined text-primary text-[40px]">lock_reset</span>
      </div>
      <div>
        <h1 class="font-headline-md text-headline-md text-on-surface">Cambiar Contraseña</h1>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-base">Debes definir una nueva contraseña antes de continuar.</p>
      </div>
    </div>

    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-md">
      <div class="flex flex-col gap-xs">
        <label class="font-label-caps text-label-caps text-on-surface-variant uppercase" for="current-password">Contraseña Actual</label>
        <input
          id="current-password"
          type="password"
          formControlName="currentPassword"
          class="w-full h-12 px-4 rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors duration-200"
        />
      </div>

      <div class="flex flex-col gap-xs">
        <label class="font-label-caps text-label-caps text-on-surface-variant uppercase" for="new-password">Nueva Contraseña</label>
        <input
          id="new-password"
          type="password"
          formControlName="newPassword"
          class="w-full h-12 px-4 rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors duration-200"
        />
      </div>

      <div class="flex flex-col gap-xs">
        <label class="font-label-caps text-label-caps text-on-surface-variant uppercase" for="confirm-password">Confirmar Nueva Contraseña</label>
        <input
          id="confirm-password"
          type="password"
          formControlName="confirmPassword"
          class="w-full h-12 px-4 rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors duration-200"
        />
        @if (passwordMismatch) {
          <p class="text-error text-body-sm">Las contraseñas no coinciden.</p>
        }
      </div>

      @if (error$ | async; as error) {
        <p class="text-error text-body-sm">{{ error }}</p>
      }

      <button
        type="submit"
        data-testid="guardar-cambiar-contrasena"
        [disabled]="form.invalid"
        class="mt-sm h-12 w-full bg-primary text-on-primary rounded-md font-headline-md text-headline-md hover:bg-primary-container active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Guardar Nueva Contraseña
      </button>
    </form>
  </main>
</div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/cambiar-contrasena/cambiar-contrasena.component.spec.ts"`
Expected: `5 passed`

- [ ] **Step 6: Add the route**

In `apps/web/src/app/app.routes.ts`, add the import:

```ts
import { CambiarContrasenaComponent } from './features/cambiar-contrasena/cambiar-contrasena.component';
```

and add this route (right after the `home` route):

```ts
  { path: 'cambiar-contrasena', component: CambiarContrasenaComponent, canActivate: [authGuard] },
```

The full `routes` array should read:

```ts
export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'cambiar-contrasena', component: CambiarContrasenaComponent, canActivate: [authGuard] },
  { path: 'reportes/impugnaciones', component: ImpugnacionesComponent, canActivate: [authGuard] },
  { path: 'reportes/infracciones', component: InfraccionesComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
  { path: 'auditoria', component: AuditoriaComponent, canActivate: [authGuard] },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];
```

- [ ] **Step 7: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/cambiar-contrasena apps/web/src/app/app.routes.ts
git commit -m "feat(web): add mandatory password-change page and route"
```

---

### Task 7: Post-login redirect and interceptor handling

**Files:**
- Modify: `apps/web/src/app/features/login/login.component.ts`
- Modify: `apps/web/src/app/core/auth.interceptor.ts`
- Test: `apps/web/src/app/features/login/login.component.spec.ts`
- Test: `apps/web/src/app/core/auth.interceptor.spec.ts`

**Interfaces:**
- Consumes: `User.must_change_password` (Task 5), `/cambiar-contrasena` route (Task 6).

- [ ] **Step 1: Write the failing tests**

Append to the top-level `describe('LoginComponent', ...)` block in `apps/web/src/app/features/login/login.component.spec.ts` (as a sibling to the existing `it('navigates to /home on successful login', ...)`):

```ts
  it('navigates to /cambiar-contrasena when the user must change their password', () => {
    authService.login.mockReturnValue(
      of({ id: 1, email: 'a@b.com', full_name: 'A', is_admin: false, must_change_password: true })
    );
    component.form.setValue({ email: 'a@b.com', password: 'secret' });

    component.onSubmit();

    expect(router.navigate).toHaveBeenCalledWith(['/cambiar-contrasena']);
  });
```

Append to the `describe('authInterceptor', ...)` block in `apps/web/src/app/core/auth.interceptor.spec.ts`:

```ts
  it('redirects to /cambiar-contrasena without logging out on a 403 password_change_required response', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/reportes/impugnaciones/estados').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/reportes/impugnaciones/estados');
    req.flush(
      { detail: { code: 'password_change_required', message: 'Debes cambiar tu contraseña' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/cambiar-contrasena']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/login/login.component.spec.ts"`
Expected: FAIL — expects `router.navigate` called with `['/cambiar-contrasena']`, but the component still always navigates to `['/home']`.

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/auth.interceptor.spec.ts"`
Expected: FAIL — `router.navigate` was never called for this response.

- [ ] **Step 3: Update `LoginComponent.onSubmit()`**

In `apps/web/src/app/features/login/login.component.ts`, replace:

```ts
    this.authService.login(email, password).subscribe({
      next: () => this.router.navigate(['/home']),
```

with:

```ts
    this.authService.login(email, password).subscribe({
      next: (user) => this.router.navigate([user.must_change_password ? '/cambiar-contrasena' : '/home']),
```

- [ ] **Step 4: Update `auth.interceptor.ts`**

In `apps/web/src/app/core/auth.interceptor.ts`, add this function after `isIpBlocked`:

```ts
function isPasswordChangeRequired(error: HttpErrorResponse): boolean {
  const detail = error.error?.detail as StructuredErrorDetail | undefined;
  return error.status === 403 && detail?.code === 'password_change_required';
}
```

Then replace the `catchError` block:

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

with:

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
      } else if (!isLoginRequest && !isLogoutRequest && isPasswordChangeRequired(error)) {
        router.navigate(['/cambiar-contrasena']);
      }
      return throwError(() => error);
    })
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx ng test --watch=false --include="src/app/features/login/login.component.spec.ts"`
Expected: `5 passed`

Run: `cd apps/web && npx ng test --watch=false --include="src/app/core/auth.interceptor.spec.ts"`
Expected: `7 passed`

- [ ] **Step 6: Run the full frontend suite to check for regressions**

Run: `cd apps/web && npx ng test --watch=false`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/login/login.component.ts apps/web/src/app/core/auth.interceptor.ts apps/web/src/app/features/login/login.component.spec.ts apps/web/src/app/core/auth.interceptor.spec.ts
git commit -m "feat(web): redirect to mandatory password-change page based on backend flag"
```

---

## Final Verification

- [ ] Run the full backend suite: `cd apps/api && pytest -v` — expect all green (aside from the pre-existing `test_decode_access_token_rejects_tampered_token` flake).
- [ ] Run the full frontend suite: `cd apps/web && npx ng test --watch=false` — expect all green.
- [ ] Manually smoke-test: create a user through the admin panel, log in as that user, confirm the app redirects straight to `/cambiar-contrasena`, confirm the old password no longer works after the change, confirm the new password logs in straight to `/home` without another forced redirect.
