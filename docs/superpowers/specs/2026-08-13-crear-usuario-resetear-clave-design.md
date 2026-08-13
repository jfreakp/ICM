# Crear Usuario y Resetear Contraseña (Administración de Usuarios)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-13 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

El usuario reportó que el botón "Nuevo Usuario" en Administración de Usuarios "no deja crear
usuarios". Se verificó que **no es un bug** — ese botón nunca tuvo funcionalidad: no tiene
`(click)` en el HTML, y el backend nunca tuvo un endpoint de creación de usuarios (solo
`POST /login`, `POST /logout`, `GET /me`, `GET /users`, `PATCH /users/{id}/allowed-ip`). Hoy la
única forma de crear un usuario es el script manual `apps/api/app/seed_user.py` por línea de
comandos. Durante la conversación se pidió agregar también, en el mismo alcance, la posibilidad de
resetear la contraseña de un usuario existente.

**Estado real de la pantalla, verificado antes de diseñar** (para no asumir sobre el mockup
original en `desing/administraci_n_de_usuarios/`, que muestra iconos de editar/eliminar y una
barra de búsqueda funcional que **nunca se implementaron** en el componente real): la tabla actual
tiene columnas Nombre/Email/Rol/Estado/IP anclada, y solo el botón "Resetear IP" (visible únicamente
cuando el usuario tiene una IP anclada) tiene lógica real. La barra de búsqueda es un `<input>`
estático sin binding.

## Alcance

**Incluido:**
- `POST /api/auth/users` — crea un usuario nuevo (email, nombre completo, contraseña inicial,
  si es administrador). Solo administradores.
- `PATCH /api/auth/users/{user_id}/password` — resetea la contraseña de un usuario existente a un
  valor nuevo que el administrador escribe. Solo administradores.
- Ambas acciones quedan auditadas (`usuarios.create_user`, `usuarios.reset_password`), siguiendo el
  mismo patrón ya usado para `usuarios.update_allowed_ip`.
- En el frontend: el botón "Nuevo Usuario" pasa a abrir un modal con el formulario de creación; se
  agrega un botón "Resetear Contraseña" por fila (visible siempre, a diferencia de "Resetear IP")
  que abre un modal para ese usuario puntual.
- Validación de contraseña: mínimo 8 caracteres, en cliente y servidor.

**Explícitamente fuera de alcance:**
- La barra de búsqueda de la tabla (sigue sin filtrar nada — no se pidió).
- Los iconos de editar/eliminar usuario del mockup original (nunca existieron en el componente
  real; no se agregan sin pedido explícito).
- Edición de otros campos de un usuario existente (nombre, email, rol) — hoy solo se puede resetear
  IP y (con este cambio) contraseña. Cambiar el rol de admin o el nombre de un usuario ya creado
  queda fuera de esta fase.
- Envío de email de invitación o de notificación de contraseña reseteada — no existe
  infraestructura de envío de correo en el proyecto; el administrador comunica la contraseña nueva
  por otro medio.
- Autoservicio de "olvidé mi contraseña" para el propio usuario — esto es una acción de
  administrador sobre otro usuario, no un flujo de recuperación propio.

## Backend

### Schemas nuevos (`apps/api/app/schemas.py`)

```python
class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    is_admin: bool = False


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
```

(`UserListItem`, ya existente, se reutiliza como `response_model` de ambos endpoints nuevos — ya
expone `id, email, full_name, is_admin, is_active, allowed_ip`, exactamente lo que la tabla del
frontend necesita mostrar tras crear o resetear.)

### Endpoints nuevos (`apps/api/app/routers/auth.py`)

- **`POST /api/auth/users`** — protegido con `require_admin` (mismo patrón que `list_users`).
  - Verifica explícitamente si el email ya existe (`select(User).where(User.email == payload.email)`)
    y devuelve `409 Conflict` con un mensaje claro si es así — mismo estilo explícito que el `404`
    de `update_allowed_ip`, no se depende de capturar una excepción de integridad de la base.
  - Si no existe, crea el `User` con `password_hash = hash_password(payload.password)`,
    `is_active=True`, `allowed_ip=None` (se ancla solo en el primer login, comportamiento ya
    existente, sin cambios).
  - Registra `usuarios.create_user` vía `registrar_evento`, con `user_id`/`user_email` del
    **administrador que crea** (no del usuario nuevo), y `details = {"usuario_creado_id": ...,
    "usuario_creado_email": ..., "es_admin": ...}`.
  - Responde `201 Created` con `UserListItem` del usuario creado.

- **`PATCH /api/auth/users/{user_id}/password`** — protegido con `require_admin`.
  - `404` si `user_id` no existe (mismo patrón que `update_allowed_ip`).
  - Actualiza `password_hash = hash_password(payload.new_password)`.
  - Registra `usuarios.reset_password` con `user_id`/`user_email` del administrador, y
    `details = {"usuario_objetivo_id": user.id}` — **nunca** se guarda la contraseña nueva, ni en
    texto plano ni hasheada, dentro del registro de auditoría.
  - Responde `UserListItem` del usuario actualizado (la contraseña nunca aparece en ninguna
    respuesta, ni en la de creación ni en la de reseteo — `UserListItem` no tiene ese campo).

Ninguno de los dos endpoints invalida sesiones activas del usuario afectado (el JWT sigue siendo
stateless, sin cambios sobre ese comportamiento ya establecido) — si el usuario cuya contraseña se
resetea tiene una sesión abierta, esa sesión sigue viva hasta que el token expire por su cuenta.

## Frontend

- **`UsersService`** (`apps/web/src/app/core/users.service.ts`) gana dos métodos:
  - `createUser(payload: { email, full_name, password, is_admin }): Observable<UserListItem>`
  - `resetPassword(userId: number, newPassword: string): Observable<UserListItem>`

- **`NuevoUsuarioModalComponent`** (nuevo, `apps/web/src/app/features/administracion-usuarios/`):
  componente standalone con su propio formulario reactivo (email, nombre completo, contraseña,
  confirmar contraseña, checkbox "Es administrador" — default sin marcar). Valida en cliente:
  email con formato válido, contraseña mínimo 8 caracteres, confirmación debe coincidir con la
  contraseña. Al enviar, llama a `UsersService.createUser`; en éxito emite un evento `creado` con
  el `UserListItem` recibido; en error 409 (email duplicado) muestra el mensaje inline sin cerrar
  el modal; en cancelar, emite `cancelado`.

- **`ResetearContrasenaModalComponent`** (nuevo, misma carpeta): recibe el usuario objetivo como
  `@Input()` (id + nombre, para mostrar "Resetear contraseña de <nombre>"). Formulario reactivo con
  contraseña nueva + confirmación, misma validación de 8 caracteres mínimo. Llama a
  `UsersService.resetPassword(usuario.id, ...)`; emite `reseteado` en éxito (sin necesidad de
  devolver nada más — la lista de la tabla no depende de la contraseña) o `cancelado`.

- **`AdministracionUsuariosComponent`**: dos estados booleanos simples de UI (no `BehaviorSubject`
  — son puros toggles de visibilidad, igual que `reportesExpanded` en el sidebar, no datos
  asíncronos): `mostrarModalNuevoUsuario` y `usuarioParaResetearClave: UserListItem | null` (su
  presencia/ausencia decide si el modal de reseteo está abierto y para quién). El botón "Nuevo
  Usuario" del header ahora tiene `(click)="mostrarModalNuevoUsuario = true"`. Cada fila gana un
  botón "Resetear Contraseña" (visible siempre, junto al condicional "Resetear IP") con
  `(click)="usuarioParaResetearClave = usuario"`. Cuando `NuevoUsuarioModalComponent` emite
  `creado`, el componente vuelve a pedir la lista completa a `UsersService.listUsers()` (no se
  empalma el usuario nuevo a mano en el array local — se confía en el estado real del servidor,
  mismo criterio simple ya usado en el resto de la app).

**Principio obligatorio heredado:** toda carga de datos asíncrona sigue `BehaviorSubject` +
`AsyncPipe`. Los dos booleanos de visibilidad de modal son la única excepción permitida — no cargan
datos del servidor, solo controlan qué se muestra, y no violan el principio (que existe para evitar
que una respuesta HTTP se pierda bajo change detection zoneless, no para prohibir estado de UI
puro).

## Validación y manejo de errores

- Contraseña: mínimo 8 caracteres, validado en el `FormGroup` de Angular (`Validators.minLength(8)`)
  y en el schema de Pydantic (`Field(min_length=8)`) — dos capas, la del servidor es la autoridad
  final si algo se salta la del cliente.
- Confirmación de contraseña: validador de cliente que compara ambos campos del formulario; no
  existe un campo de confirmación en el backend (el servidor solo recibe la contraseña final, ya
  confirmada por el cliente).
- Email duplicado al crear: `409 Conflict`, mensaje "Ya existe un usuario con ese email" mostrado
  inline en el modal, sin cerrarlo — el administrador puede corregir el email y reintentar sin
  perder lo demás que ya escribió.
- `user_id` inexistente al resetear contraseña: `404`, mismo patrón que `update_allowed_ip`.
- Sin permisos de administrador: `403` con el mismo `code: "admin_required"` ya usado en los otros
  endpoints admin-only — el interceptor global existente ya sabe mostrar esto, sin lógica nueva.
- Sin token: `401`, ya cubierto por el interceptor global.

## Testing

**Backend** (`apps/api/tests/test_auth_routes.py`, ampliando los tests ya existentes de este
router):
- Admin crea usuario con datos válidos → `201`, el usuario queda en la base con `password_hash`
  hasheado (nunca en texto plano), `allowed_ip=None`.
- Admin crea usuario con email ya existente → `409`.
- Admin crea usuario como `is_admin=True` → el usuario resultante tiene `is_admin=True`.
- No-admin intenta crear usuario → `403` con `code: "admin_required"`.
- Sin token → `401`.
- Admin resetea contraseña de un usuario existente → `200`, y el usuario puede loguearse con la
  contraseña nueva (verificado end-to-end: reset, luego `POST /login` con la contraseña nueva
  funciona; la vieja ya no funciona).
- Admin resetea contraseña de un `user_id` inexistente → `404`.
- No-admin intenta resetear contraseña → `403`.
- Ambas acciones crean el evento de auditoría esperado (`usuarios.create_user` /
  `usuarios.reset_password`) con los `details` correctos — mismo patrón de test ya usado para
  `usuarios.update_allowed_ip` en `test_audit_routes.py`. El evento de reseteo de contraseña se
  verifica explícitamente que **no** contiene la contraseña nueva en ningún campo de `details`.

**Frontend**:
- `UsersService`: `createUser`/`resetPassword` mandan los parámetros correctos
  (`HttpTestingController`).
- `NuevoUsuarioModalComponent`: validación de contraseña corta, de confirmación no coincidente, de
  email inválido; envío exitoso emite `creado` con el usuario recibido; error 409 muestra el
  mensaje sin cerrar el modal.
- `ResetearContrasenaModalComponent`: mismas validaciones de contraseña/confirmación; envío exitoso
  emite `reseteado`.
- `AdministracionUsuariosComponent`: clic en "Nuevo Usuario" abre el modal; evento `creado` cierra
  el modal y vuelve a cargar la lista (con la rigurosidad async ya establecida —
  `Subject`+`whenStable()`, no mocks síncronos); clic en "Resetear Contraseña" de una fila abre el
  modal de reseteo con el usuario correcto.
