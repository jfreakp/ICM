# Auditoría de accesos y consultas

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-12 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

Hoy el sistema no registra ningún evento de auditoría. Se pidió poder ver qué descargan los
usuarios, qué consultan, cuándo ingresan y salen, y en general "lo que se pueda auditar" —
acotado, tras aclarar con el usuario, a acciones significativas (las que ya disparan una llamada
al backend o un cambio de pantalla), no a tracking de clicks de UI a nivel de píxel.

El sistema actual (`apps/api`, FastAPI + JWT stateless; `apps/web`, Angular zoneless) tiene hoy:
- Login (`POST /api/auth/login`) con JWT sin sesión en servidor; el logout actual es 100% cliente
  (borra el token de `localStorage`, sin llamada al backend).
- Un único reporte real, Impugnaciones (`GET /api/reportes/impugnaciones`, con filtro/paginación,
  y `GET /api/reportes/impugnaciones/export` para CSV/Excel).
- Administración de Usuarios: listar usuarios y cambiar `allowed_ip` (no existen hoy endpoints de
  crear/activar/desactivar usuario).

## Alcance

**Incluido:**
- Tabla `app.audit_logs` para persistir eventos de auditoría.
- Registro de los siguientes eventos: login exitoso, login fallido (credenciales inválidas), login
  bloqueado por IP no autorizada, logout, búsqueda/filtro de Impugnaciones, descarga (export) de
  Impugnaciones, cambio de IP permitida de un usuario.
- Nuevo endpoint `POST /api/auth/logout` (el JWT sigue siendo stateless; el endpoint solo registra
  el evento de salida).
- Nuevo endpoint de lectura `GET /api/auditoria`, paginado, con filtros, protegido solo para
  administradores.
- Nueva pantalla `Auditoría` en el frontend, visible solo para administradores, con tabla paginada
  y filtros.

**Explícitamente fuera de alcance:**
- Tracking de clicks de UI que no disparan una llamada al backend (abrir un dropdown, expandir un
  submenu, foco en un campo). Ver "Hallazgo clave" abajo.
- Auditar la vista de "lista de usuarios" (`GET /api/auth/users`) — es una vista de bajo riesgo, sin
  datos sensibles de terceros; auditar cada apertura sería ruido sin valor.
- Auditar acciones de administración de usuarios que no existen hoy (crear, activar/desactivar) —
  se agregan a esta auditoría cuando esos endpoints se construyan, no antes.
- Export (CSV/Excel) del propio historial de auditoría — no se pidió; se agrega después si hace
  falta.
- Invalidación server-side del JWT en logout — el token sigue siendo válido hasta su expiración
  natural; el endpoint de logout solo deja constancia del evento.
- Cualquier reporte futuro distinto de Impugnaciones — cuando se agregue, su propio spec deberá
  incluir sus eventos de auditoría siguiendo el mismo patrón.

**Hallazgo clave que acotó el diseño:** "dónde hicieron clic" se interpretó, tras aclarar con el
usuario, como acciones con intención de negocio (buscar, descargar, iniciar/cerrar sesión, cambiar
un permiso), no como tracking de UI a nivel de evento DOM. Esto permite implementar toda la
auditoría desde el backend, sin agregar un servicio de tracking de eventos de UI en el frontend.

## Modelo de datos

Nueva tabla `app.audit_logs`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `serial`, PK | |
| `occurred_at` | `timestamptz`, `default now()`, not null | |
| `user_id` | `int`, nullable, FK `app.users.id` | `NULL` cuando el login falla con un email que no corresponde a ningún usuario |
| `user_email` | `text`, not null | Denormalizado: se guarda el email tal como se usó en la acción (incluye emails inexistentes en login fallido), así el registro sobrevive aunque el usuario se borre en el futuro |
| `action` | `text`, not null | Código del evento, ver catálogo abajo |
| `ip_address` | `text`, nullable | Misma función `get_client_ip` ya usada en `routers/auth.py` |
| `details` | `jsonb`, nullable | Payload específico de cada tipo de evento |

Se usa `JSONB` en `details` en vez de columnas separadas por evento porque cada acción audita datos
de forma distinta (una búsqueda tiene filtros de fecha/estado; un cambio de IP tiene la IP anterior
y la nueva). Esto evita una tabla ancha con columnas nullable para cada combinación posible, y
permite agregar el catálogo de eventos de reportes futuros sin migraciones de columnas nuevas.

Índices: `(occurred_at DESC)` para el orden por defecto de la pantalla de auditoría, y `(action)`
para el filtro por tipo de evento.

### Catálogo de eventos (fase 1)

| `action` | Cuándo se registra | `details` |
|---|---|---|
| `auth.login_success` | Login exitoso | `{}` |
| `auth.login_failed` | Email inexistente o contraseña incorrecta | `{}` (el email ya queda en `user_email`) |
| `auth.login_blocked_ip` | Login rechazado por `allowed_ip` no coincidente | `{"ip_esperada": str}` |
| `auth.logout` | Llamada a `POST /api/auth/logout` | `{}` |
| `reportes.impugnaciones.search` | Cada `GET /api/reportes/impugnaciones` | `{"fecha_desde", "fecha_hasta", "estado", "page", "total"}` |
| `reportes.impugnaciones.export` | Cada `GET /api/reportes/impugnaciones/export` | `{"fecha_desde", "fecha_hasta", "estado", "formato", "filas_exportadas"}` |
| `usuarios.update_allowed_ip` | Cada `PATCH /api/auth/users/{id}/allowed-ip` | `{"usuario_objetivo_id", "ip_anterior", "ip_nueva"}` |

## Backend

### Servicio de auditoría (`apps/api/app/audit.py`, nuevo)

```python
async def registrar_evento(
    db: AsyncSession,
    *,
    user_id: int | None,
    user_email: str,
    action: str,
    ip_address: str | None = None,
    details: dict | None = None,
) -> None
```

Hace `db.add(AuditLog(...))`, sin `commit()` propio: se apoya en el `commit()` que cada endpoint ya
ejecuta como parte de su flujo normal, de modo que el evento de auditoría queda atómico con la
acción que audita. Excepción: `login_failed` y `login_blocked_ip`, donde no hay otro cambio que
commitear en ese request — ahí `registrar_evento` hace su propio `commit()`.

No se agrega manejo de errores especial alrededor de la inserción de auditoría: si la base de datos
no está disponible, la acción de negocio (que también depende de la misma base) ya habría fallado
antes, así que no existe un caso real de "la acción de negocio funciona pero la auditoría falla"
que requiera una rama de manejo de errores separada.

### Endpoints modificados

- **`POST /api/auth/login`** (`routers/auth.py`): registra `login_success` tras emitir el token;
  `login_blocked_ip` en la rama de IP no autorizada (con `ip_esperada` = `user.allowed_ip`);
  `login_failed` cuando el email no existe, el usuario está inactivo, o `verify_password` falla
  (`user_id=None` si el email no corresponde a ningún usuario).
- **`GET /api/reportes/impugnaciones`** (`routers/reportes.py`): registra
  `reportes.impugnaciones.search` después de calcular `total`, con los filtros recibidos y el
  `total` resultante.
- **`GET /api/reportes/impugnaciones/export`**: registra `reportes.impugnaciones.export` con los
  filtros, el `formato`, y `len(rows)` como `filas_exportadas`.
- **`PATCH /api/auth/users/{user_id}/allowed-ip`**: registra `usuarios.update_allowed_ip` con el
  `allowed_ip` previo (leído antes de sobrescribirlo) y el nuevo.

### Endpoint nuevo: logout

- **`POST /api/auth/logout`**, protegido con `get_current_user`. Registra `auth.logout` y responde
  `204 No Content`. No invalida el JWT (sigue siendo válido hasta su expiración natural) — es
  puramente un registro de auditoría del evento de salida.

### Endpoint nuevo: lectura de auditoría

- **`GET /api/auditoria`**, protegido con `require_admin` (mismo patrón que
  `GET /api/auth/users`). Query params, todos opcionales: `desde: date`, `hasta: date`,
  `accion: str`, `usuario_email: str`, `page: int = 1`. Tamaño de página fijo: 50. Responde
  `{ items: AuditLogItem[], total: int, page: int, page_size: int }`, ordenado
  `ORDER BY occurred_at DESC, id DESC`. Página fuera de rango → `items: []`, no error (mismo
  patrón que `list_impugnaciones`).

## Frontend

- **Ruta** `/auditoria` → `AuditoriaComponent`, agregada a `app.routes.ts` con
  `canActivate: [authGuard]` (igual que `/usuarios` — el control de rol admin lo hace el backend
  con `403`, no un guard de rol en el router, siguiendo el patrón ya establecido).
- **Sidebar** (`app-shell.component.html`): nuevo ítem "Auditoría", junto a "Administración de
  Usuarios", dentro del mismo bloque `@if ((currentUser$ | async)?.is_admin)` ya existente.
- **`AuditoriaComponent`** (`apps/web/src/app/features/auditoria/`):
  - Filtros, todos opcionales: rango de fechas (`desde`/`hasta`), tipo de evento (`<select>` con
    las 7 acciones del catálogo, valor legible en español, ej. "Inicio de sesión exitoso"),
    email de usuario (texto libre).
  - Tabla paginada (50 filas/página, controles anterior/siguiente + indicador de página, mismo
    patrón que `ImpugnacionesComponent`). Columnas: Fecha/Hora, Usuario (`user_email`), Acción
    (etiqueta legible), Detalle (resumen legible de `details`, ej. "Buscó impugnaciones
    01/07–15/07, estado=A, 340 resultados"), IP.
  - Sin botón de descarga en esta fase.
  - Estados: carga ("Cargando..."), vacío ("No hay eventos para estos filtros"), error 403
    ("No tienes permisos para ver esta página." — mismo mensaje que
    `AdministracionUsuariosComponent`).
- **`AuditoriaService`** (`apps/web/src/app/core/auditoria.service.ts`, nuevo): `listEventos(filtros)`
  que llama a `GET /api/auditoria` con los query params vigentes.
- **`AuthService.logout()`**: llama a `POST /api/auth/logout` antes de borrar el token de
  `localStorage`. La llamada es "fire and forget" (no bloquea ni condiciona el borrado del token
  ni la navegación a `/login`, incluso si la request falla — el usuario nunca debe quedar
  bloqueado para salir de la sesión por un problema de red o de backend).

**Principio obligatorio para la implementación** (heredado de la sesión de Impugnaciones): toda la
carga de datos sigue el patrón `BehaviorSubject` + `AsyncPipe` — esta app corre con change
detection zoneless, y un `.subscribe(v => this.campo = v)` sobre un campo plano no dispara
re-render. Se considera un defecto, no una variación aceptable.

## Manejo de errores y casos borde

- Login fallido con email inexistente: se registra igual, con `user_id=None` y `user_email` tal
  como fue tipeado (típicamente un typo, o un intento de acceso indebido — dato de valor para la
  auditoría).
- Fallo de inserción de auditoría (ej. DB caída): no se maneja como caso especial — ver
  justificación en la sección de Backend.
- `GET /api/auditoria` sin filtros: devuelve los eventos más recientes primero, paginado.
- Página de paginación fuera de rango (tanto en Auditoría como ya en Impugnaciones): `items: []`,
  no error.
- Acceso a `/auditoria` o `GET /api/auditoria` sin ser admin: `403`, mensaje de error visible en
  pantalla (mismo patrón que Usuarios).
- Sin token en cualquier endpoint nuevo o modificado: `401` (ya cubierto por el interceptor global
  existente en el frontend).
- Logout con red caída o backend caído: el frontend igual borra el token local y navega a
  `/login` — el evento de auditoría de logout simplemente no queda registrado ese caso, pero el
  usuario no debe notar ninguna diferencia en el flujo de salida.

## Testing

**Backend** (`apps/api/tests/test_audit_routes.py`, nuevo; y ampliar
`test_auth_routes.py`/`test_reportes_routes.py` existentes):
- Login exitoso, fallido (credenciales inválidas, email inexistente) y bloqueado por IP → cada uno
  crea la fila esperada en `audit_logs` con el `action` correcto y `user_id`/`user_email`
  correctos.
- `POST /api/auth/logout` → crea fila `auth.logout`, responde `204`; sin token → `401`.
- `GET /api/reportes/impugnaciones` y `.../export` → crean fila con `details` conteniendo los
  filtros recibidos y el conteo correcto (`total` / `filas_exportadas`).
- `PATCH /api/auth/users/{id}/allowed-ip` → crea fila con `ip_anterior` e `ip_nueva` correctas.
- `GET /api/auditoria`: filtros por fecha/acción/email de usuario acotan resultados
  correctamente; paginación (página 2 con offset correcto; fuera de rango → `items: []`); `403`
  sin admin; `401` sin token.

**Frontend**:
- `AuditoriaService`: `listEventos` manda los parámetros correctos (`HttpTestingController`,
  mismo patrón que `ImpugnacionesService`).
- `AuditoriaComponent`: filtros; paginación; estado vacío; estado de carga; error 403 — con la
  misma rigurosidad de timing async (`Subject` + `whenStable()`, no mocks síncronos) establecida
  en los fixes de `c4b6a2c`/`c363ca4`.
- `AuthService.logout()`: verifica que se llama a `POST /api/auth/logout` y que el token se borra
  de `localStorage` incluso si esa llamada falla.
