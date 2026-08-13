# Forzar Cambio de Contraseña en Primer Login — Design

## Contexto

Cuando un administrador crea un usuario nuevo (`POST /api/auth/users`) o resetea la contraseña de uno existente (`PATCH /api/auth/users/{id}/password`), define él mismo una contraseña temporal que la otra persona no eligió. Hoy esa persona puede iniciar sesión y seguir usando el sistema indefinidamente con esa contraseña sin nunca cambiarla. Este feature obliga a cambiarla antes de poder usar el resto de la aplicación.

## Alcance

- Se activa la obligación de cambio en dos casos: creación de usuario nuevo y reseteo de contraseña por un admin.
- `seed_user.py` (script CLI de bootstrap, usado para crear el primer admin directo en el servidor) **no** activa la obligación — es una herramienta de arranque, no representa "un admin le asigna clave temporal a otra persona".
- El enforcement es real en el backend (no solo una redirección de UI): mientras la cuenta tenga el flag activo, el backend rechaza con `403` cualquier endpoint que no sea ver el propio perfil, cambiar la propia contraseña, o cerrar sesión.
- El endpoint de autocambio de contraseña pide la contraseña actual (la temporal) además de la nueva, como verificación adicional.

## Backend

### Modelo y migración

Nueva columna en `app.users`:

```python
must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Migración `0004_add_must_change_password_to_users.py`, agrega la columna con `server_default=false` para que las filas existentes queden en `False` sin intervención manual.

### Cuándo se marca `True`

- `create_user` (`POST /api/auth/users`): el usuario creado siempre nace con `must_change_password=True`.
- `reset_password` (`PATCH /api/auth/users/{id}/password`): el usuario objetivo queda con `must_change_password=True`.

### Endpoint nuevo: autocambio de contraseña

`PATCH /api/auth/me/password`

Request:
```python
class ChangeOwnPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)
```

Comportamiento:
1. Requiere solo `get_current_user` (no pasa por el bloqueo nuevo — debe funcionar incluso con el flag activo, es la única puerta de salida).
2. Verifica `current_password` contra `user.password_hash` con `verify_password`; si no coincide, `401` con detalle `"Contraseña actual incorrecta"`.
3. Hashea `new_password`, actualiza `password_hash`, pone `must_change_password=False`.
4. Audita `auth.change_own_password` (sin loguear contraseñas), con la IP del request.
5. Responde `UserOut` actualizado.

### Enforcement (bloqueo real)

Nueva dependencia `require_active_user`:

```python
async def require_active_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Debes cambiar tu contraseña"},
        )
    return current_user
```

- `require_admin` pasa a depender de `require_active_user` en vez de `get_current_user` directamente (un admin con el flag activo también queda bloqueado del resto del panel hasta cambiar su contraseña).
- Endpoints que deben migrar su dependencia de `get_current_user`/`require_admin` a pasar por este bloqueo: `list_users`, `create_user`, `update_allowed_ip`, `reset_password` (ya dependen de `require_admin`, que queda cubierto automáticamente).
- Exentos del bloqueo (siguen usando `get_current_user` sin pasar por `require_active_user`): `GET /me`, `PATCH /me/password` (nuevo), `POST /logout`.

### Schemas afectados

- `UserOut` gana `must_change_password: bool`.
- Nuevo `ChangeOwnPasswordRequest` (arriba).

## Frontend

### Modelo

`User` (en `core/models/user.model.ts`) gana `must_change_password: boolean`.

### Servicio

`AuthService` gana:

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

### Componente nuevo: `CambiarContrasenaComponent`

`features/cambiar-contrasena/cambiar-contrasena.component.ts` (standalone), mismo patrón de formulario reactivo que `NuevoUsuarioModalComponent`/`ResetearContrasenaModalComponent`:

- Campos: `current_password`, `new_password`, `confirm_password`.
- Validadores: `Validators.required` en los tres, `Validators.minLength(8)` y `Validators.maxLength(72)` en `new_password`, validador cruzado `passwordsMatch` entre `new_password` y `confirm_password`.
- `BehaviorSubject<string | null>` + `AsyncPipe` para el mensaje de error (mismo patrón que el resto de la app).
- Al enviar: llama `authService.changeOwnPassword(...)`. Éxito → `router.navigate(['/home'])`. Error `401` → mensaje "Contraseña actual incorrecta". Otro error → mensaje genérico.
- Sin botón cancelar: mientras el flag siga activo no hay a dónde volver.

### Ruta

En `app.routes.ts`:

```ts
{ path: 'cambiar-contrasena', component: CambiarContrasenaComponent, canActivate: [authGuard] }
```

Solo exige `authGuard` (sesión iniciada). No tiene lógica de redirección si el flag ya está en `false` — si alguien entra ahí sin necesitarlo, el formulario simplemente funciona igual (queda como una pantalla genérica de "cambiar mi contraseña", reutilizable).

### Redirección post-login

En `LoginComponent.onSubmit()`, el `next` del `login()` (que ya trae el `User` completo vía `/me`) chequea `user.must_change_password`:

```ts
next: (user) => this.router.navigate([user.must_change_password ? '/cambiar-contrasena' : '/home']),
```

### Interceptor

`auth.interceptor.ts` gana una función paralela a `isIpBlocked`:

```ts
function isPasswordChangeRequired(error: HttpErrorResponse): boolean {
  const detail = error.error?.detail as StructuredErrorDetail | undefined;
  return error.status === 403 && detail?.code === 'password_change_required';
}
```

En el `catchError`, si `isPasswordChangeRequired(error)` es cierto (y no es login/logout), navega a `/cambiar-contrasena` **sin** hacer logout (a diferencia de `ip_not_allowed`: acá el token sigue siendo válido y hace falta para poder llamar `PATCH /me/password`).

Esto cubre el caso de alguien que ya estaba navegando en otra pantalla protegida y el flag se activó (o recargó la página estando en una pantalla que sí llama a un endpoint bloqueado, como `/usuarios`).

**Limitación aceptada:** si alguien recarga la página parado en una pantalla que no dispara ninguna llamada bloqueada (ej. `/home`, si ese componente solo llama a `/me`), no se lo redirige automáticamente hasta que intente algo real. Se acepta este caso borde por simplicidad (YAGNI) en vez de agregar un guard adicional que llame a `/me` en cada navegación — la redirección explícita post-login y el interceptor cubren el flujo real de uso.

## Fuera de alcance

- No se agrega expiración de contraseñas (forzar cambio periódico) — solo el caso de contraseña temporal asignada por un admin.
- No se agrega un guard adicional que consulte `/me` en cada navegación (ver limitación aceptada arriba).
- `seed_user.py` no cambia.

## Testing

- Backend: tests para `require_active_user` (bloquea con `must_change_password=True`, permite con `False`), para `PATCH /me/password` (éxito, contraseña actual incorrecta, valida que limpia el flag), y para que `create_user`/`reset_password` efectivamente pongan el flag en `True`.
- Frontend: tests para `CambiarContrasenaComponent` (validación de formulario, éxito navega a `/home`, error 401 muestra mensaje), para el interceptor (nuevo caso `password_change_required` redirige sin logout), y para `LoginComponent` (redirige a `/cambiar-contrasena` cuando `must_change_password` es `true`).
