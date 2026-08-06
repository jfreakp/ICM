# Monorepo Angular + FastAPI: login y home

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-06 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

Se necesita una aplicación web para el Municipio de Loja que, en fases posteriores, ofrecerá un
panel de administración y reportería sobre los datos migrados de AXIS Cloud (base `axis_migracion`,
esquema `axis` — infracciones, pagos, títulos de crédito, etc., ver
`~/.claude/skills/axis-loja-migracion/`). Esta primera fase construye solo el esqueleto: un
monorepo con login y una página de inicio (home), sin tocar el esquema `axis` existente.

## Alcance de esta fase

**Incluido:**
- Monorepo con Angular (frontend) y FastAPI (backend), en la raíz de este directorio.
- Login con usuario/contraseña propio (tabla nueva, esquema separado).
- Página de home protegida, con navegación preparada (no funcional) para admin/reportería futuros.

**Explícitamente fuera de alcance de esta fase** (se especificará por separado más adelante):
- Panel de administración.
- Reportería sobre los datos de `axis.*`.
- PostgREST (se evaluará cuando se construya la reportería).
- Registro de usuarios / recuperación de contraseña / refresh tokens.
- Roles y permisos (por ahora todo usuario autenticado tiene el mismo acceso).

## Arquitectura

Monorepo sin herramienta de orquestación (Nx/Turborepo) — dos apps independientes, cada una con
su tooling nativo:

```
matriculacion/
├── apps/
│   ├── web/                 Angular + Tailwind CSS
│   └── api/                 FastAPI + SQLAlchemy (async) + Alembic
└── docs/superpowers/specs/  Specs de diseño (este archivo)
```

**Por qué sin Nx/Turborepo**: solo 2 apps, cada una con su propio ciclo de vida y tooling maduro
(Angular CLI, uvicorn/pytest). Una herramienta de monorepo agrega configuración sin beneficio
claro a esta escala; se puede reconsiderar si el proyecto crece.

**Por qué no PostgREST ni Prisma en esta fase**: PostgREST expondría tablas directamente como API
REST — útil para reportería (fase futura), pero prematuro para login/home donde toda la lógica es
custom (hashing de contraseñas, JWT). Prisma es principalmente una herramienta de Node/TS; con un
backend Python, SQLAlchemy + Alembic es el par natural (ORM + migraciones) sin depender de un
paquete comunitario para hacerlo funcionar desde Python.

## Base de datos

- **Motor**: el PostgreSQL del contenedor Docker ya existente (`localhost:5433`, base
  `axis_migracion` — el mismo que aloja los datos migrados de AXIS Cloud).
- **Aislamiento**: todo lo nuevo vive en un esquema separado, **`app`** — nunca en `axis`. El
  backend se conecta con un usuario/rol cuyo `search_path` no necesita tocar `axis` para esta
  fase (puede tener acceso de solo lectura a `axis` más adelante, cuando se construya reportería;
  no se otorga ahora porque no se usa).
- **Tabla de esta fase**: `app.users`
  | Columna | Tipo | Notas |
  |---|---|---|
  | `id` | `BIGSERIAL PRIMARY KEY` | |
  | `email` | `TEXT UNIQUE NOT NULL` | login |
  | `password_hash` | `TEXT NOT NULL` | bcrypt |
  | `full_name` | `TEXT NOT NULL` | |
  | `is_active` | `BOOLEAN NOT NULL DEFAULT true` | permite desactivar sin borrar |
  | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
- **Migraciones**: Alembic, versionadas en `apps/api/alembic/versions/`.
- **Primer usuario**: no hay registro público. Se crea con un script CLI
  (`python -m app.seed_user --email ... --password ... --full-name ...`) que un desarrollador o
  administrador corre manualmente. Evita exponer un endpoint de registro en una herramienta
  interna de gobierno.

## Backend (FastAPI)

Estructura:
```
apps/api/
├── app/
│   ├── main.py          FastAPI app, monta los routers
│   ├── config.py        lee variables de entorno (.env): DATABASE_URL, JWT_SECRET, JWT_EXPIRE_MINUTES
│   ├── database.py      engine + sesión SQLAlchemy async
│   ├── models.py        modelo User (SQLAlchemy)
│   ├── schemas.py        esquemas Pydantic (LoginRequest, TokenResponse, UserOut)
│   ├── auth.py           hashing (bcrypt), creación/verificación de JWT, dependencia get_current_user
│   ├── routers/
│   │   └── auth.py       POST /api/auth/login, GET /api/auth/me
│   └── seed_user.py      script CLI para crear el primer usuario
├── alembic/
├── tests/
│   └── test_auth.py
├── pyproject.toml (o requirements.txt)
└── .env.example
```

**Endpoints de esta fase:**
- `POST /api/auth/login` — recibe `{email, password}`, valida contra `app.users`, devuelve
  `{access_token, token_type: "bearer"}`. Credenciales inválidas → 401, sin distinguir "usuario no
  existe" de "contraseña incorrecta" (evita enumeración de usuarios).
- `GET /api/auth/me` — requiere `Authorization: Bearer <token>` válido, devuelve
  `{id, email, full_name}` del usuario actual. 401 si el token falta, expiró, o es inválido.

**JWT**: firmado con `JWT_SECRET` (variable de entorno, nunca en el código), expiración configurable
(default 8 horas, sin refresh token en esta fase — al expirar, el usuario vuelve a loguearse).

## Frontend (Angular + Tailwind)

Estructura (dentro de `apps/web/src/app/`):
```
core/
├── auth.service.ts       login(), logout(), currentUser$ (observable), isAuthenticated()
├── auth.guard.ts         protege rutas que requieren sesión
└── auth.interceptor.ts   agrega "Authorization: Bearer <token>" a cada request HTTP
features/
├── login/
│   └── login.component.ts    formulario email/password, maneja errores (401 → mensaje genérico)
└── home/
    └── home.component.ts     bienvenida + nombre de usuario + botón logout + nav placeholder
```

- **Persistencia de sesión**: el JWT se guarda en `localStorage` para sobrevivir un refresh de
  página; `AuthService` lo carga al iniciar la app y valida contra `/api/auth/me`.
- **Rutas**: `/login` (pública), `/home` (protegida por `AuthGuard`, redirige a `/login` si no hay
  sesión válida). Ruta raíz `/` redirige a `/home` (que a su vez redirige a `/login` si no hay
  sesión).
- **Home**: mensaje de bienvenida con `full_name`, botón "Cerrar sesión", y una barra de
  navegación lateral/superior con ítems "Admin" y "Reportería" visibles pero deshabilitados
  (`disabled` / sin `routerLink` activo) — comunica la dirección del producto sin implementar
  nada todavía.
- **Estilos**: Tailwind CSS, sin librería de componentes adicional.

## Manejo de errores

- Backend: credenciales inválidas → 401 con mensaje genérico ("Credenciales inválidas"); errores
  de validación de entrada (email vacío, etc.) → 422 (comportamiento default de FastAPI/Pydantic).
- Frontend: `AuthInterceptor` captura 401 en cualquier respuesta → limpia la sesión local y
  redirige a `/login`. El formulario de login muestra el mensaje de error del backend tal cual.

## Testing

- Backend: `pytest` — al menos: login con credenciales válidas devuelve token; login con
  credenciales inválidas devuelve 401; `/api/auth/me` sin token devuelve 401; `/api/auth/me` con
  token válido devuelve el usuario correcto.
- Frontend: Jasmine/Karma (default de Angular CLI) — `AuthService` (login exitoso/fallido,
  persistencia), `AuthGuard` (redirige sin sesión), `LoginComponent` (muestra error en 401).

## Flujo de desarrollo local

- Backend: `cd apps/api && uvicorn app.main:app --reload` (puerto 8000). Variables en `.env`
  (`DATABASE_URL=postgresql+asyncpg://...@localhost:5433/axis_migracion`, `JWT_SECRET`,
  `JWT_EXPIRE_MINUTES`).
- Frontend: `cd apps/web && ng serve` (puerto 4200). `environment.ts` con
  `apiUrl: 'http://localhost:8000/api'`.
- Primer usuario: `cd apps/api && python -m app.seed_user --email admin@loja.gob.ec --password ... --full-name "..."`.

## Próximos pasos (fuera de esta spec)

- Admin: CRUD sobre entidades de la app (a definir cuáles).
- Reportería: lectura sobre `axis.*` — probablemente el punto donde se reconsidera PostgREST.
- Roles/permisos si el municipio los requiere para admin vs. reportería.
