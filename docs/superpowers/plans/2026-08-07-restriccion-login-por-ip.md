# Restricción de login por IP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anclar cada usuario no-admin a una sola IP (auto-asignada en su primer login), rechazar accesos desde otra IP tanto en login como en cada request autenticado, y dar a los admins un mecanismo para ver y resetear esa IP.

**Architecture:** Dos columnas nuevas en `app.users` (`is_admin`, `allowed_ip`). El backend (FastAPI) compara la IP de la request (`request.client.host`, sin proxy) contra `allowed_ip` en el login y en la dependencia `get_current_user` que protege todos los endpoints autenticados; los admins quedan exentos. Nuevos endpoints admin-only exponen la lista de usuarios y el reseteo de su IP. El frontend (Angular) distingue el 403 de "IP no autorizada" (código `ip_not_allowed` en el body) de otros 401/403, cerrando sesión y mostrando un mensaje específico; `AdministracionUsuariosComponent` pasa de datos placeholder a datos reales con acción de reset.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (backend), Angular 22 standalone components + vitest (frontend), PostgreSQL.

## Global Constraints

- Una sola IP por usuario (no listas, no CIDR) — ver spec, sección "Explícitamente fuera de alcance".
- Sin soporte de proxy/`X-Forwarded-For` — se usa `request.client.host` directamente.
- Los errores de "IP no autorizada" deben ser identificables por el frontend sin parsear texto libre: se usa `detail: {"code": "ip_not_allowed", "message": "..."}` en vez de un string plano, para no confundirlos con otros 403 (ej. `require_admin` devuelve `code: "admin_required"`). Esto es una precisión de implementación no explícita en el spec, necesaria porque `AdministracionUsuariosComponent` también puede recibir un 403 por falta de permisos de admin, y ese caso NO debe disparar el logout automático que sí aplica al bloqueo por IP.
- No se toca `CRUD` general de usuarios (alta/edición) — sigue siendo `seed_user.py`.

---

### Task 1: Modelo de datos — `is_admin` y `allowed_ip`

**Files:**
- Modify: `apps/api/app/models.py:9-21`
- Create: `apps/api/alembic/versions/0002_add_is_admin_and_allowed_ip_to_users.py`

**Interfaces:**
- Produces: `User.is_admin: bool` (default `False`), `User.allowed_ip: str | None` (default `None`) — usados por todas las tareas siguientes.

- [ ] **Step 1: Agregar las columnas al modelo**

Editar `apps/api/app/models.py` — reemplazar el bloque de columnas para agregar `is_admin` y `allowed_ip` después de `is_active`:

```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "app"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 2: Crear la migración Alembic**

Crear `apps/api/alembic/versions/0002_add_is_admin_and_allowed_ip_to_users.py`:

```python
"""add is_admin and allowed_ip to users

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="app",
    )
    op.add_column(
        "users",
        sa.Column("allowed_ip", sa.Text(), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("users", "allowed_ip", schema="app")
    op.drop_column("users", "is_admin", schema="app")
```

- [ ] **Step 3: Correr la migración y verificar las columnas**

Run: `cd apps/api && alembic upgrade head`
Expected: sin errores, termina en la revisión `0002`.

Run: `psql "$DATABASE_URL" -c "\d app.users"` (o el equivalente con las variables de conexión del `.env` de `apps/api`)
Expected: la salida incluye `is_admin | boolean` y `allowed_ip | text`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/models.py apps/api/alembic/versions/0002_add_is_admin_and_allowed_ip_to_users.py
git commit -m "feat(api): add is_admin and allowed_ip columns to users"
```

---

### Task 2: Anclaje de IP en login y en cada request autenticado

**Files:**
- Modify: `apps/api/app/routers/auth.py` (todo el archivo)
- Modify: `apps/api/app/schemas.py:16-20` (`UserOut`)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `User.is_admin`, `User.allowed_ip` (Task 1).
- Produces:
  - `get_client_ip(request: Request) -> str | None` — usado por Task 3.
  - `get_current_user(request, credentials, db) -> User` — misma firma que hoy más el parámetro `request: Request` al inicio; usado por Task 3 (`require_admin`) y por cualquier endpoint protegido futuro.
  - Respuestas 403 de bloqueo por IP con body `{"detail": {"code": "ip_not_allowed", "message": "IP no autorizada"}}`.

- [ ] **Step 1: Escribir los tests que fallan (login)**

Agregar al final de `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_login_auto_binds_allowed_ip_on_first_login(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    assert user.allowed_ip is None

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.allowed_ip == "127.0.0.1"


@pytest.mark.asyncio
async def test_login_rejected_when_ip_does_not_match_allowed_ip(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    user.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ip_not_allowed"


@pytest.mark.asyncio
async def test_admin_login_is_exempt_from_ip_check(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="admin@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Admin User",
        is_admin=True,
        allowed_ip="10.0.0.9",
    )
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "admin@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.allowed_ip == "10.0.0.9"
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "auto_binds_allowed_ip or rejected_when_ip or admin_login_is_exempt" -v`
Expected: los 3 tests FALLAN porque hoy `allowed_ip` nunca se toca ni se chequea en `/login` (el primer test falla en el `assert user.allowed_ip == "127.0.0.1"`, el segundo porque hoy responde 200 en vez de 403).

- [ ] **Step 3: Implementar el chequeo de IP en `login`**

Reemplazar el contenido completo de `apps/api/app/routers/auth.py`:

```python
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, decode_access_token, verify_password
from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


def get_client_ip(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def _ip_not_allowed() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"code": "ip_not_allowed", "message": "IP no autorizada"},
    )


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    if credentials is None:
        raise unauthorized
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError:
        raise unauthorized
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise unauthorized
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    if not user.is_admin and user.allowed_ip is not None and user.allowed_ip != get_client_ip(request):
        raise _ip_not_allowed()
    return user


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_admin:
        client_ip = get_client_ip(request)
        if user.allowed_ip is None:
            user.allowed_ip = client_ip
            await db.commit()
        elif user.allowed_ip != client_ip:
            raise _ip_not_allowed()
    token = create_access_token(user_id=user.id, email=user.email)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "auto_binds_allowed_ip or rejected_when_ip or admin_login_is_exempt" -v`
Expected: los 3 tests PASAN.

- [ ] **Step 5: Correr toda la suite para verificar que no se rompió nada existente**

Run: `cd apps/api && pytest tests/test_auth_routes.py tests/test_auth_utils.py -v`
Expected: todos los tests (los nuevos y los preexistentes) PASAN. Los tests existentes no se ven afectados porque comparten el mismo `client` fixture (IP por defecto `127.0.0.1` tanto en login como en `/me` dentro del mismo test), así que login auto-ancla y el chequeo posterior siempre coincide.

- [ ] **Step 6: Escribir los tests que fallan (chequeo de IP en `/me`)**

Agregar a `apps/api/tests/test_auth_routes.py`:

```python
@pytest.mark.asyncio
async def test_me_returns_403_when_ip_changed_mid_session(client, db_session):
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    other_ip_client = AsyncClient(
        transport=ASGITransport(app=app, client=("10.0.0.9", 123)), base_url="http://test"
    )
    async with other_ip_client as oc:
        response = await oc.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ip_not_allowed"


@pytest.mark.asyncio
async def test_me_exempts_admin_from_ip_check(client, db_session):
    from app.auth import create_access_token, hash_password
    from app.models import User

    user = User(
        email="admin@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Admin User",
        is_admin=True,
        allowed_ip="10.0.0.9",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
```

- [ ] **Step 7: Correr los tests y verificar que fallan**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "me_returns_403_when_ip_changed or me_exempts_admin" -v`
Expected: `test_me_returns_403_when_ip_changed_mid_session` FALLA (hoy `/me` no chequea IP, devuelve 200). `test_me_exempts_admin_from_ip_check` puede pasar accidentalmente hoy (no hay chequeo de IP todavía) — confirmar que sigue pasando después de implementar, no antes de este step es lo crítico.

- [ ] **Step 8: Verificar la implementación**

El `get_current_user` del Step 3 ya incluye el chequeo de IP (fue implementado junto con el login). No hace falta código adicional.

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "me_returns_403_when_ip_changed or me_exempts_admin" -v`
Expected: ambos tests PASAN.

- [ ] **Step 9: Agregar `is_admin` a `UserOut`**

El frontend necesita saber si el usuario logueado es admin (para decidir si mostrar la acción de reset en Administración de Usuarios). Editar `apps/api/app/schemas.py`, reemplazar la clase `UserOut`:

```python
class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool

    model_config = {"from_attributes": True}
```

- [ ] **Step 10: Correr toda la suite de nuevo**

Run: `cd apps/api && pytest tests/test_auth_routes.py tests/test_auth_utils.py -v`
Expected: todos los tests PASAN (los existentes que comparan `body["email"]`/`body["full_name"]` no se ven afectados por el campo extra `is_admin`).

- [ ] **Step 11: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/app/schemas.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): enforce per-user IP lock on login and every authenticated request"
```

---

### Task 3: Endpoints admin-only (listar usuarios, resetear IP)

**Files:**
- Modify: `apps/api/app/routers/auth.py` (agregar al final)
- Modify: `apps/api/app/schemas.py` (agregar al final)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `get_current_user` (Task 2).
- Produces: `require_admin(current_user) -> User` dependency; `GET /api/auth/users`; `PATCH /api/auth/users/{user_id}/allowed-ip`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `apps/api/tests/test_auth_routes.py`:

```python
async def _create_admin(db_session, email="admin@example.com", password="Sup3rSecret!"):
    from app.auth import hash_password
    from app.models import User

    user = User(email=email, password_hash=hash_password(password), full_name="Admin", is_admin=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_admin_can_list_users(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200
    emails = {u["email"] for u in response.json()}
    assert emails == {"admin@example.com", "user@example.com"}


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_admin_can_reset_allowed_ip(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    target.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.patch(
        f"/api/auth/users/{target.id}/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert response.json()["allowed_ip"] is None


@pytest.mark.asyncio
async def test_non_admin_cannot_reset_allowed_ip(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        f"/api/auth/users/{user.id}/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_admin_reset_allowed_ip_for_unknown_user_returns_404(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.patch(
        "/api/auth/users/9999/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 404
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "list_users or reset_allowed_ip" -v`
Expected: los 5 tests FALLAN con 404 (las rutas no existen todavía).

- [ ] **Step 3: Agregar los schemas nuevos**

Al final de `apps/api/app/schemas.py`, agregar:

```python
class UserListItem(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool
    is_active: bool
    allowed_ip: str | None

    model_config = {"from_attributes": True}


class UpdateAllowedIpRequest(BaseModel):
    allowed_ip: str | None
```

- [ ] **Step 4: Implementar `require_admin` y los endpoints**

En `apps/api/app/routers/auth.py`:

1. Actualizar el import de schemas (línea `from app.schemas import LoginRequest, TokenResponse, UserOut`) a:

```python
from app.schemas import LoginRequest, TokenResponse, UpdateAllowedIpRequest, UserListItem, UserOut
```

2. Agregar después de `get_current_user` (antes de `@router.post("/login"...)`):

```python
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "admin_required", "message": "Requiere permisos de administrador"},
        )
    return current_user
```

3. Agregar al final del archivo:

```python
@router.get("/users", response_model=list[UserListItem])
async def list_users(
    db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)
) -> list[UserListItem]:
    result = await db.scalars(select(User).order_by(User.id))
    return [UserListItem.model_validate(u) for u in result.all()]


@router.patch("/users/{user_id}/allowed-ip", response_model=UserListItem)
async def update_allowed_ip(
    user_id: int,
    payload: UpdateAllowedIpRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserListItem:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    user.allowed_ip = payload.allowed_ip
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd apps/api && pytest tests/test_auth_routes.py -k "list_users or reset_allowed_ip" -v`
Expected: los 5 tests PASAN.

- [ ] **Step 6: Correr toda la suite del backend**

Run: `cd apps/api && pytest -v`
Expected: todos los tests PASAN (incluye `test_auth_utils.py`, sin relación con este cambio).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/auth.py apps/api/app/schemas.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): add admin-only endpoints to list users and reset allowed IP"
```

---

### Task 4: Frontend — modelos y `UsersService`

**Files:**
- Create: `apps/web/src/app/core/models/user-list-item.model.ts`
- Create: `apps/web/src/app/core/users.service.ts`
- Create: `apps/web/src/app/core/users.service.spec.ts`
- Modify: `apps/web/src/app/core/models/user.model.ts`

**Interfaces:**
- Produces: `UserListItem` interface, `UsersService.listUsers(): Observable<UserListItem[]>`, `UsersService.updateAllowedIp(id: number, allowedIp: string | null): Observable<UserListItem>` — usados por Task 6. `User.is_admin` — usado por Task 6 para decidir si el usuario logueado puede ver la sección de admin (no se agrega guard de ruta en este plan, ver spec "fuera de alcance": no se pidió restringir la navegación, solo el backend ya rechaza con 403 a los no-admin).

- [ ] **Step 1: Agregar `is_admin` al modelo `User`**

Editar `apps/web/src/app/core/models/user.model.ts`:

```typescript
export interface User {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
}
```

- [ ] **Step 2: Crear el modelo `UserListItem`**

Crear `apps/web/src/app/core/models/user-list-item.model.ts`:

```typescript
export interface UserListItem {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  allowed_ip: string | null;
}
```

- [ ] **Step 3: Escribir el test que falla para `UsersService`**

Crear `apps/web/src/app/core/users.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { UsersService } from './users.service';
import { UserListItem } from './models/user-list-item.model';
import { environment } from '../../environments/environment';

describe('UsersService', () => {
  let service: UsersService;
  let httpMock: HttpTestingController;

  const sampleUser: UserListItem = {
    id: 1,
    email: 'user@example.com',
    full_name: 'Test User',
    is_admin: false,
    is_active: true,
    allowed_ip: '10.0.0.5',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UsersService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listUsers fetches the user list', () => {
    let result: UserListItem[] | undefined;
    service.listUsers().subscribe((users) => (result = users));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users`);
    expect(req.request.method).toBe('GET');
    req.flush([sampleUser]);

    expect(result).toEqual([sampleUser]);
  });

  it('updateAllowedIp PATCHes the allowed IP and returns the updated user', () => {
    let result: UserListItem | undefined;
    service.updateAllowedIp(1, null).subscribe((user) => (result = user));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users/1/allowed-ip`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ allowed_ip: null });
    req.flush({ ...sampleUser, allowed_ip: null });

    expect(result?.allowed_ip).toBeNull();
  });
});
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd apps/web && npx ng test --watch=false --include='**/users.service.spec.ts'`
Expected: FALLA con un error de módulo no encontrado (`users.service` no existe).

- [ ] **Step 5: Implementar `UsersService`**

Crear `apps/web/src/app/core/users.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UserListItem } from './models/user-list-item.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  listUsers(): Observable<UserListItem[]> {
    return this.http.get<UserListItem[]>(`${environment.apiUrl}/auth/users`);
  }

  updateAllowedIp(id: number, allowedIp: string | null): Observable<UserListItem> {
    return this.http.patch<UserListItem>(`${environment.apiUrl}/auth/users/${id}/allowed-ip`, {
      allowed_ip: allowedIp,
    });
  }
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/web && npx ng test --watch=false --include='**/users.service.spec.ts'`
Expected: PASA.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/core/models/user.model.ts apps/web/src/app/core/models/user-list-item.model.ts apps/web/src/app/core/users.service.ts apps/web/src/app/core/users.service.spec.ts
git commit -m "feat(web): add UserListItem model and UsersService"
```

---

### Task 5: Frontend — distinguir bloqueo por IP en login e interceptor

**Files:**
- Modify: `apps/web/src/app/core/auth.interceptor.ts`
- Modify: `apps/web/src/app/core/auth.interceptor.spec.ts`
- Modify: `apps/web/src/app/features/login/login.component.ts`
- Modify: `apps/web/src/app/features/login/login.component.html`
- Test: (spec de login component no existe hoy — no se crea en este plan; se prueba manualmente en el Task 7 de verificación, ver spec "fuera de alcance" para no ampliar cobertura no solicitada. El interceptor sí tiene spec y se cubre con TDD.)

**Interfaces:**
- Consumes: respuestas 403 con `detail: {code: "ip_not_allowed", message: string}` (Task 2).
- Produces: `LoginComponent` muestra el mensaje de bloqueo por IP tanto al fallar el submit como al llegar redirigido con `?reason=ip_blocked`.

- [ ] **Step 1: Escribir el test que falla para el interceptor**

Agregar a `apps/web/src/app/core/auth.interceptor.spec.ts`, dentro del `describe('authInterceptor', ...)`:

```typescript
  it('logs out and redirects with reason=ip_blocked on a 403 ip_not_allowed response', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/auth/me').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/me');
    req.flush(
      { detail: { code: 'ip_not_allowed', message: 'IP no autorizada' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'ip_blocked' } });
  });

  it('does not log out on a 403 that is not an IP block (e.g. admin_required)', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/auth/users').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/users');
    req.flush(
      { detail: { code: 'admin_required', message: 'Requiere permisos de administrador' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd apps/web && npx ng test --watch=false --include='**/auth.interceptor.spec.ts'`
Expected: el primer test nuevo FALLA (hoy un 403 no dispara logout/redirect en absoluto). El segundo test PASA ya hoy (ningún 403 dispara logout todavía) — no es un problema, confirmar que sigue pasando después del Step 3.

- [ ] **Step 3: Implementar el manejo de 403 `ip_not_allowed` en el interceptor**

Reemplazar `apps/web/src/app/core/auth.interceptor.ts`:

```typescript
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

interface StructuredErrorDetail {
  code?: string;
  message?: string;
}

function isIpBlocked(error: HttpErrorResponse): boolean {
  const detail = error.error?.detail as StructuredErrorDetail | undefined;
  return error.status === 403 && detail?.code === 'ip_not_allowed';
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const isLoginRequest = req.url.includes('/auth/login');
      if (!isLoginRequest && error.status === 401) {
        authService.logout();
        router.navigate(['/login']);
      } else if (!isLoginRequest && isIpBlocked(error)) {
        authService.logout();
        router.navigate(['/login'], { queryParams: { reason: 'ip_blocked' } });
      }
      return throwError(() => error);
    })
  );
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd apps/web && npx ng test --watch=false --include='**/auth.interceptor.spec.ts'`
Expected: todos los tests (los 2 nuevos y los 4 existentes) PASAN.

- [ ] **Step 5: Manejar el error en `LoginComponent` y el query param `reason`**

Reemplazar `apps/web/src/app/features/login/login.component.ts`:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth.service';

interface StructuredErrorDetail {
  code?: string;
  message?: string;
}

const IP_BLOCKED_MESSAGE = 'Tu usuario está vinculado a otro equipo. Contacta al administrador.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  errorMessage: string | null = null;

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('reason') === 'ip_blocked') {
      this.errorMessage = IP_BLOCKED_MESSAGE;
    }
  }

  onSubmit(): void {
    this.errorMessage = null;
    if (this.form.invalid) {
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.authService.login(email, password).subscribe({
      next: () => this.router.navigate(['/home']),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail as string | StructuredErrorDetail | undefined;
        if (err.status === 403 && typeof detail === 'object' && detail?.code === 'ip_not_allowed') {
          this.errorMessage = IP_BLOCKED_MESSAGE;
        } else if (typeof detail === 'string') {
          this.errorMessage = detail;
        } else {
          this.errorMessage = 'Error al iniciar sesión';
        }
      },
    });
  }
}
```

No hace falta modificar `login.component.html` — ya tiene el bloque `@if (errorMessage) { ... }` que muestra cualquier valor de `errorMessage`.

- [ ] **Step 6: Verificar manualmente que la app compila**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/core/auth.interceptor.ts apps/web/src/app/core/auth.interceptor.spec.ts apps/web/src/app/features/login/login.component.ts
git commit -m "feat(web): distinguish IP-block errors from session-expiry and bad credentials"
```

---

### Task 6: Frontend — `AdministracionUsuariosComponent` con datos reales y reset de IP

**Files:**
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts`
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.html`
- Modify: `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts`

**Interfaces:**
- Consumes: `UsersService.listUsers()`, `UsersService.updateAllowedIp()` (Task 4).

- [ ] **Step 1: Escribir el test que falla**

Reemplazar `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdministracionUsuariosComponent } from './administracion-usuarios.component';
import { AuthService } from '../../core/auth.service';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('AdministracionUsuariosComponent', () => {
  let fixture: ComponentFixture<AdministracionUsuariosComponent>;
  let usersService: { listUsers: ReturnType<typeof vi.fn>; updateAllowedIp: ReturnType<typeof vi.fn> };

  const usuarios: UserListItem[] = [
    { id: 1, email: 'ana.silva@icmloja.gob.ec', full_name: 'Ana Silva Pérez', is_admin: true, is_active: true, allowed_ip: '10.0.0.5' },
    { id: 2, email: 'c.mendoza@icmloja.gob.ec', full_name: 'Carlos Mendoza', is_admin: false, is_active: true, allowed_ip: null },
  ];

  beforeEach(async () => {
    usersService = {
      listUsers: vi.fn().mockReturnValue(of(usuarios)),
      updateAllowedIp: vi.fn().mockReturnValue(of({ ...usuarios[0], allowed_ip: null })),
    };

    await TestBed.configureTestingModule({
      imports: [AdministracionUsuariosComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: UsersService, useValue: usersService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdministracionUsuariosComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Administración de Usuarios');
  });

  it('renders users fetched from UsersService', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Silva Pérez');
    expect(text).toContain('c.mendoza@icmloja.gob.ec');
    expect(text).toContain('10.0.0.5');
  });

  it('calls updateAllowedIp with null when resetting a user IP', () => {
    fixture.componentInstance.resetAllowedIp(usuarios[0]);
    expect(usersService.updateAllowedIp).toHaveBeenCalledWith(1, null);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/web && npx ng test --watch=false --include='**/administracion-usuarios.component.spec.ts'`
Expected: FALLA — `UsersService` no está inyectado en el componente, `resetAllowedIp` no existe, y el texto renderizado sigue siendo el placeholder ("Lucía Torres" en vez de "Carlos Mendoza").

- [ ] **Step 3: Implementar el componente**

Reemplazar `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts`:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AppShellComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent implements OnInit {
  private readonly usersService = inject(UsersService);

  usuarios: UserListItem[] = [];

  ngOnInit(): void {
    this.usersService.listUsers().subscribe((usuarios) => (this.usuarios = usuarios));
  }

  resetAllowedIp(usuario: UserListItem): void {
    this.usersService.updateAllowedIp(usuario.id, null).subscribe((updated) => {
      usuario.allowed_ip = updated.allowed_ip;
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
}
```

- [ ] **Step 4: Actualizar el template**

Reemplazar `apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.html`:

```html
<app-shell activeRoute="usuarios">
  <div class="flex justify-between items-center mb-lg">
    <h2 class="font-display-lg text-display-lg text-on-surface">Administración de Usuarios</h2>
    <button type="button" class="bg-primary hover:bg-primary-container text-on-primary px-sm py-2 rounded-DEFAULT font-body-sm text-body-sm font-semibold flex items-center gap-2 transition-colors shadow-sm">
      <span class="material-symbols-outlined text-[18px]">add</span>
      Nuevo Usuario
    </button>
  </div>

  <div class="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
    <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-bright">
      <div class="relative w-64">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">search</span>
        <input type="text" placeholder="Buscar usuarios..." class="w-full pl-10 pr-3 py-2 border border-outline-variant rounded-DEFAULT font-body-sm text-body-sm bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow" />
      </div>
    </div>
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
              <td class="py-3 px-md">
                @if (usuario.allowed_ip) {
                  <button
                    type="button"
                    (click)="resetAllowedIp(usuario)"
                    class="text-primary hover:underline font-body-sm text-body-sm"
                  >
                    Resetear IP
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="p-md border-t border-outline-variant flex items-center justify-between bg-surface-bright">
      <span class="font-body-sm text-body-sm text-on-surface-variant">Mostrando {{ usuarios.length }} de {{ usuarios.length }} usuarios</span>
    </div>
  </div>
</app-shell>
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/web && npx ng test --watch=false --include='**/administracion-usuarios.component.spec.ts'`
Expected: los 3 tests PASAN.

- [ ] **Step 6: Correr toda la suite de frontend**

Run: `cd apps/web && npx ng test --watch=false`
Expected: todos los tests PASAN (incluye `auth.service.spec.ts`, `auth.guard.spec.ts`, `auth.interceptor.spec.ts`, `users.service.spec.ts`, `administracion-usuarios.component.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.ts apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.html apps/web/src/app/features/administracion-usuarios/administracion-usuarios.component.spec.ts
git commit -m "feat(web): wire AdministracionUsuariosComponent to real user data and IP reset"
```

---

### Task 7: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Crear un usuario admin y uno normal**

Run:
```bash
cd apps/api
python -m app.seed_user --email admin@icmloja.gob.ec --password AdminPass123! --full-name "Admin Loja"
python -m app.seed_user --email empleado@icmloja.gob.ec --password EmpleadoPass123! --full-name "Empleado Loja"
```

Luego, marcar al primero como admin directamente en la base (no hay endpoint de alta con `is_admin=true` en este plan — es intencional, ver alcance):
```bash
psql "$DATABASE_URL" -c "UPDATE app.users SET is_admin = true WHERE email = 'admin@icmloja.gob.ec';"
```

- [ ] **Step 2: Levantar backend y frontend**

Run: `cd apps/api && uvicorn app.main:app --reload` (en una terminal)
Run: `cd apps/web && npm start` (en otra terminal)

- [ ] **Step 3: Verificar el auto-anclaje**

En el navegador, entrar a `http://localhost:4200/login` y loguearse como `empleado@icmloja.gob.ec`. Debe entrar normalmente. Verificar en la base:
```bash
psql "$DATABASE_URL" -c "SELECT email, allowed_ip FROM app.users WHERE email = 'empleado@icmloja.gob.ec';"
```
Expected: `allowed_ip` ya no es `NULL`.

- [ ] **Step 4: Verificar el bloqueo desde otra IP**

Simular otra IP forzando el valor en la base a algo que no sea la IP real de tu navegador:
```bash
psql "$DATABASE_URL" -c "UPDATE app.users SET allowed_ip = '10.10.10.10' WHERE email = 'empleado@icmloja.gob.ec';"
```
Intentar loguearse de nuevo con `empleado@icmloja.gob.ec`. Expected: mensaje "Tu usuario está vinculado a otro equipo. Contacta al administrador." y el login es rechazado.

- [ ] **Step 5: Verificar el reset desde la UI de admin**

Loguearse como `admin@icmloja.gob.ec`, ir a "Administración de Usuarios", confirmar que aparece `empleado@icmloja.gob.ec` con IP `10.10.10.10`, hacer clic en "Resetear IP", confirmar que la columna pasa a "Sin anclar". Volver a loguearse como `empleado@icmloja.gob.ec` desde el navegador real y confirmar que ahora sí entra (se re-ancla a la IP real).

- [ ] **Step 6: Reportar resultados al usuario**

No hay commit en este task — es solo verificación manual. Reportar si algún paso no se comportó como se esperaba antes de dar la funcionalidad por terminada.
