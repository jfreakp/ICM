# Restricción de login por IP (anclaje de usuario a una máquina)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-07 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

El módulo de auth actual (`apps/api/app/routers/auth.py`, `apps/web/src/app/core/*`) permite a
cualquier usuario activo iniciar sesión desde cualquier máquina. Se pidió agregar una restricción:
cada usuario debe quedar "anclado" a una IP, de forma que si intenta entrar desde otra máquina no
pueda, incluso con credenciales correctas.

Hoy no existe ningún concepto de rol/admin en el backend — `app.users` solo tiene `email`,
`password_hash`, `full_name`, `is_active`, `created_at`. `AdministracionUsuariosComponent` en el
frontend muestra roles ("Admin"/"Employee") pero son datos de placeholder, no conectados a nada
real (ver commit `88bed41`). Esta funcionalidad requiere agregar un rol admin mínimo porque el
propio anclaje de IP lo necesita (exención + reseteo).

## Alcance

**Incluido:**
- Anclaje de IP por usuario (una sola IP, no lista).
- Auto-anclaje en el primer login exitoso de cada usuario (si no tiene IP asignada).
- Chequeo de IP tanto en login como en cada request autenticado subsiguiente (`/me` y futuros
  endpoints protegidos), no solo en login.
- Campo `is_admin` mínimo en `users`, exclusivamente para: (a) exentar a los admins del chequeo de
  IP, y (b) autorizar el reseteo de la IP de otros usuarios.
- Endpoints admin-only para listar usuarios y resetear/asignar la IP de un usuario.
- Conectar `AdministracionUsuariosComponent` a esos endpoints reales (reemplaza el arreglo
  hardcodeado), agregando una columna de IP anclada y una acción "Resetear IP".
- Manejo diferenciado en el frontend entre credenciales inválidas (401) e IP no autorizada (403).

**Explícitamente fuera de alcance:**
- Múltiples IPs permitidas por usuario (se evaluará si en el futuro se pide explícitamente).
- Soporte para proxy/balanceador (`X-Forwarded-For`) — el backend conecta directo, se usa
  `request.client.host`. Si en el futuro se agrega un proxy delante, este mecanismo deja de
  funcionar correctamente y habrá que revisarlo.
- CRUD completo de usuarios (alta/edición general) en `AdministracionUsuariosComponent` — se
  mantiene la creación vía `seed_user.py`. Solo se agrega lo mínimo para ver usuarios y
  resetear su IP.
- Rangos de IP / CIDR — se compara IP exacta (string), no subredes.

## Modelo de datos

Migración Alembic nueva sobre `app.users`:

| Columna | Tipo | Notas |
|---|---|---|
| `is_admin` | `BOOLEAN NOT NULL DEFAULT false` | exento de chequeo de IP; puede resetear la IP de otros |
| `allowed_ip` | `TEXT NULL` | `NULL` = sin anclar todavía (se anclará sola en el próximo login exitoso) |

No se crea tabla aparte para IPs: al ser una sola IP por usuario, una columna nullable en `users`
es suficiente y evita joins innecesarios.

## Backend (FastAPI)

### Reglas de negocio

**`POST /api/auth/login`** (usa `request: Request` para leer `request.client.host`):
1. Credenciales inválidas o `is_active=False` → 401 (sin cambios respecto a hoy).
2. `is_admin=True` → login normal, no se toca ni se chequea `allowed_ip`.
3. `allowed_ip IS NULL` → se asigna a la IP de esta request (`UPDATE`) y el login continúa.
4. `allowed_ip` tiene valor y **no coincide** con la IP de la request → 403, detail
   `"IP no autorizada"`.

**`get_current_user`** (dependencia usada por `/me` y cualquier endpoint protegido futuro), recibe
`request: Request` y aplica la misma regla 2/4 de arriba (sin la 3 — el auto-anclaje solo ocurre en
login). Mismatch → 403, no 401, para que el frontend lo distinga de "sesión expirada".

### Endpoints nuevos (admin-only, vía dependencia `require_admin` que envuelve `get_current_user` y
valida `is_admin`)

- `GET /api/auth/users` → lista `id`, `email`, `full_name`, `is_admin`, `is_active`, `allowed_ip`.
- `PATCH /api/auth/users/{id}/allowed-ip` → body `{ "allowed_ip": string | null }`.
  `null` desancla al usuario (se reasigna solo en su próximo login). 404 si el usuario no existe.

## Frontend (Angular)

- **`AdministracionUsuariosComponent`**: reemplaza el arreglo hardcodeado por datos de
  `GET /api/auth/users` (nuevo método en `AuthService`, o un `UsersService` dedicado). Cada fila
  muestra la IP anclada (o "sin anclar") y un botón "Resetear IP" que llama al `PATCH` con
  `allowed_ip: null`.
- **`LoginComponent`**: distingue 403 (IP no autorizada) de 401 (credenciales inválidas), muestra
  mensaje específico para el primero: *"Tu usuario está vinculado a otro equipo. Contacta al
  administrador."*
- **`auth.interceptor.ts`**: hoy solo trata 401 fuera de `/login` como sesión expirada (logout +
  redirect a `/login`). Se agrega el mismo manejo para 403 en requests autenticados fuera de login
  (ej. `/me` a mitad de sesión con IP cambiada) — logout + redirect con `?reason=ip_blocked` para
  que `LoginComponent` muestre el mensaje correcto en vez del genérico de sesión expirada.

## Casos borde cubiertos

- Un admin nunca se bloquea a sí mismo (exento en login y en cada request).
- Usuario nuevo sin IP asignada se ancla solo, sin intervención del admin.
- Un token válido usado desde otra IP a mitad de sesión activa se corta en la siguiente llamada
  autenticada (403 → logout del lado del cliente), no solo al momento del login.

## Testing

**Backend** (`test_auth_routes.py`), simulando distintas IPs de request con
`ASGITransport(app=app, client=("1.2.3.4", 123))` en vez del transporte por defecto de `conftest.py`:
- Login con `allowed_ip=NULL` lo asigna automáticamente a la IP de la request.
- Login con `allowed_ip` distinto a la IP de la request → 403.
- Admin puede loguear desde cualquier IP sin que se le asigne ni se le chequee `allowed_ip`.
- `/me` devuelve 403 si la IP de la request no coincide con `allowed_ip` (usuario no-admin).
- `/me` ignora el chequeo de IP para un usuario admin.
- `PATCH /api/auth/users/{id}/allowed-ip`: 200 para admin; 403 para no-admin; 404 si el usuario no
  existe.
- `GET /api/auth/users`: 200 para admin; 403 para no-admin.

**Frontend**:
- `auth.interceptor.spec.ts`: un 403 en un request autenticado (no-login) dispara logout + redirect
  a `/login?reason=ip_blocked`, igual que hoy lo hace un 401.
- `administracion-usuarios.component.spec.ts`: renderiza usuarios desde el servicio (no el arreglo
  hardcodeado) y ejercita la acción de resetear IP.
