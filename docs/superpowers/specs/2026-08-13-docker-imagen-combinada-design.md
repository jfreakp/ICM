# Imagen Docker combinada (backend + frontend)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-13 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

El proyecto no tiene hoy ningún mecanismo de containerización ni de CI/CD — no existe `Dockerfile`,
`docker-compose.yml`, ni workflows de GitHub Actions. Se pidió empaquetar el backend (FastAPI,
`apps/api`) y el frontend (Angular, `apps/web`) en **una sola imagen Docker**, publicada en Docker
Hub bajo la cuenta `jptorresdota`, con el build y la publicación automatizados desde GitHub Actions.

**Hallazgo clave que simplificó el diseño:** el frontend ya usa `apiUrl: '/api'` (ruta relativa, en
`apps/web/src/environments/environment.ts`), no una URL absoluta. Esto significa que si el backend
sirve el build estático de Angular desde el mismo origen (mismo host:puerto), las llamadas a la API
funcionan sin ningún cambio de configuración en el frontend — el único cambio de código necesario es
en el backend, para que sirva esos archivos estáticos.

**Versiones verificadas:**
- Angular CLI 22 requiere Node `^22.22.3 || ^24.15.0 || >=26.0.0` (verificado con
  `node_modules/@angular/cli/package.json`). Se usa `node:24-alpine` para el stage de build.
- El build de producción de Angular (`ng build --configuration production`) genera su salida en
  `apps/web/dist/web/browser/` (verificado con un build real) — no en `dist/web/` directamente, ese
  es solo el directorio padre.
- El backend requiere Python `>=3.11` (`apps/api/pyproject.toml`); se usa `python:3.11-slim` para el
  stage de runtime.

## Alcance

**Incluido:**
- `Dockerfile` multi-stage en la raíz del repo: un stage construye el frontend, otro instala y
  empaqueta el backend, copiando el build del frontend adentro.
- Cambio en `apps/api/app/main.py` para que FastAPI sirva el build estático de Angular además de la
  API existente, con fallback a `index.html` para las rutas del router de Angular (SPA routing).
- Un script de entrypoint que corre `alembic upgrade head` antes de arrancar `uvicorn` — si la
  migración falla, el contenedor no arranca.
- El servidor escucha en el puerto **8100** dentro del contenedor.
- Workflow de GitHub Actions (`.github/workflows/docker-publish.yml`) que en cada push a `main`
  construye la imagen y la publica en Docker Hub como `jptorresdota/icm-loja:1.0.0` y
  `jptorresdota/icm-loja:latest`.
- `.dockerignore` para no copiar `.venv/`, `node_modules/`, `dist/`, `.git/`, etc. al contexto de
  build.

**Explícitamente fuera de alcance:**
- `docker-compose.yml` — el usuario ya tiene Postgres corriendo localmente para desarrollo y prueba
  la imagen apuntando `DATABASE_URL` a esa instancia; no se agrega orquestación adicional.
- Versionado automático de la imagen (bump de versión, tags por git-tag, etc.) — por ahora cada push
  a `main` sobrescribe los tags `1.0.0` y `latest` por igual. Se revisita si hace falta algo más
  sofisticado.
- Configuración de los secrets de GitHub (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) — el usuario los
  crea él mismo en la configuración del repositorio; este spec documenta los pasos pero no los
  ejecuta (requiere acceso a su cuenta de Docker Hub y a la UI de GitHub).
- Cualquier orquestador de producción (Kubernetes, ECS, etc.) — solo se cubre construir y publicar
  la imagen.
- HTTPS/TLS — la imagen sirve HTTP plano en el puerto 8100; TLS es responsabilidad de lo que esté
  delante en producción (load balancer, reverse proxy), no de esta imagen.

## Backend: servir el frontend

En `apps/api/app/main.py`, después de registrar los routers existentes, se monta el build estático
de Angular:

- El build llega a la imagen en `/app/static` (copiado ahí en el Dockerfile desde el stage de
  frontend).
- Se usa `StaticFiles` de Starlette para servir los assets (JS, CSS, favicon) bajo su nombre de
  archivo real.
- Un catch-all al final (después de todas las rutas `/api/*`) sirve `index.html` para cualquier otra
  ruta — esto es lo que permite que el router de Angular maneje rutas como `/reportes/infracciones`
  o `/auditoria` sin que el servidor intente (y falle) resolverlas como archivos.
- El orden de registro importa: los routers de `/api/*` deben registrarse **antes** del montaje
  estático/catch-all, para que una request a `/api/auth/login` nunca caiga en el fallback de
  `index.html`.

Este cambio solo se activa cuando el directorio estático existe (en la imagen Docker). En el entorno
de desarrollo local actual (backend y frontend corriendo por separado, `ng serve` en :4200 y
`uvicorn` en :8000), ese directorio no existe — el montaje debe tolerar su ausencia sin romper el
arranque del servidor en local (se verifica su existencia antes de montarlo).

## Dockerfile

Dos stages:

**Stage `frontend-build`** (`node:24-alpine`):
- Copia `apps/web/package.json` y `apps/web/package-lock.json`, corre `npm ci` (usa el lockfile
  exacto, no `npm install`).
- Copia el resto de `apps/web/`.
- Corre `npm run build -- --configuration production`.
- Resultado: `/app/dist/web/browser/`.

**Stage `runtime`** (`python:3.11-slim`):
- Copia `apps/api/pyproject.toml`, instala las dependencias del proyecto (`pip install .`, sin las
  dependencias de `dev`).
- Copia el código de `apps/api/app/` y `apps/api/alembic/` (necesario para poder correr las
  migraciones dentro del contenedor).
- Copia `/app/dist/web/browser/` del stage anterior a `/app/static/` dentro de la imagen final.
- `EXPOSE 8100`.
- `ENTRYPOINT` un script (`docker-entrypoint.sh`) que corre `alembic upgrade head` y, si sale bien,
  hace `exec uvicorn app.main:app --host 0.0.0.0 --port 8100`.

No se copian `apps/api/.venv/`, `apps/api/tests/`, ni `apps/web/node_modules/` — se instalan
dependencias frescas dentro de la imagen. `.dockerignore` en la raíz excluye estos directorios (y
`.git/`, `dist/` locales, `__pycache__/`) del contexto de build para que sea rápido y no arrastre
artefactos del entorno de desarrollo del autor.

## Variables de entorno en runtime

Ninguna se hornea en la imagen. Deben pasarse al correr el contenedor (`docker run -e ...` o
`--env-file`):

| Variable | Requerida | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Sí | `postgresql+asyncpg://usuario:clave@host:5432/basededatos` |
| `JWT_SECRET` | Sí | cadena aleatoria larga, distinta por ambiente |
| `JWT_EXPIRE_MINUTES` | No (default 480) | `480` |
| `CORS_ORIGINS` | No (default `http://localhost:4200`) | no crítico en despliegue same-origin, pero se deja configurable |

Si `DATABASE_URL` o `JWT_SECRET` no se proveen, `Settings()` (Pydantic) falla al arrancar con un
error claro — comportamiento ya existente, no se cambia.

## GitHub Actions

`.github/workflows/docker-publish.yml`:
- Trigger: `push` a la rama `main`.
- Pasos: checkout, `docker/login-action` (usa los secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`),
  `docker/build-push-action` construyendo desde la raíz del repo con push a
  `jptorresdota/icm-loja:1.0.0` y `jptorresdota/icm-loja:latest`.

**Pasos que el usuario debe hacer él mismo** (documentados en el spec, no ejecutados por este
trabajo):
1. Generar un Access Token en Docker Hub (Account Settings → Security → New Access Token).
2. En el repo de GitHub: Settings → Secrets and variables → Actions → New repository secret, crear
   `DOCKERHUB_USERNAME` (su usuario de Docker Hub) y `DOCKERHUB_TOKEN` (el token generado).

## Manejo de errores y casos borde

- Migración falla al arrancar → el contenedor termina con código de salida distinto de cero, no
  queda un servidor corriendo con esquema desactualizado (comportamiento buscado, no un bug a
  manejar).
- Falta `DATABASE_URL`/`JWT_SECRET` → falla de arranque clara vía Pydantic (ya existente).
- Ruta no reconocida bajo `/api/*` → sigue devolviendo `404` de FastAPI, normal (el catch-all a
  `index.html` solo aplica a rutas que no empiezan con `/api`).
- Entorno de desarrollo local (sin build estático presente) → el montaje de archivos estáticos se
  omite sin error, `uvicorn` sigue sirviendo solo la API como hoy.
- Despliegue detrás de un reverse proxy → tanto la lista blanca de IPs por usuario
  (`apps/api/app/routers/auth.py`) como el registro de auditoría obtienen la IP del cliente a partir
  de `request.client.host`. Si esta imagen se ejecuta detrás de un reverse proxy o load balancer (por
  ejemplo, para terminar TLS, como anticipan las notas de despliegue de este spec), ese valor pasa a
  ser la IP del proxy en cada request, no la del cliente real — esto neutraliza silenciosamente la
  lista blanca de IPs (el primer login de cada usuario fijaría `allowed_ip` a la IP del proxy, y
  cualquier login posterior desde cualquier origen pasaría la verificación) y contamina el registro de
  auditoría con la IP del proxy en vez de la del cliente. Para evitarlo, `uvicorn` debe arrancarse con
  `--proxy-headers --forwarded-allow-ips=<IP del proxy>` (nunca con `--forwarded-allow-ips="*"`, que
  sería peligroso en un puerto públicamente alcanzable). Esto no se resuelve en este trabajo porque
  depende de conocer la IP real del proxy, algo que no se sabe en esta etapa.

## Testing / verificación

No aplica una suite de tests automatizados nueva (esto es infraestructura de build, no lógica de
negocio) — la verificación es manual:
- `docker build -t jptorresdota/icm-loja:1.0.0 .` completa sin errores.
- `docker run -p 8100:8100 -e DATABASE_URL=... -e JWT_SECRET=... jptorresdota/icm-loja:1.0.0`
  arranca, corre las migraciones, y responde en `http://localhost:8100`.
- Verificar manualmente: `http://localhost:8100/` sirve el `index.html` de Angular (login visible),
  `http://localhost:8100/api/auth/login` responde como API (no como `index.html`), y navegar a una
  ruta como `http://localhost:8100/reportes/impugnaciones` directamente (refresh completo del
  navegador, no solo navegación interna del SPA) también sirve `index.html` correctamente en vez de
  un 404 (esto confirma que el fallback de SPA routing funciona, no solo la navegación client-side).
- El workflow de GitHub Actions se verifica dejándolo correr en un push real a `main` una vez los
  secrets estén configurados, y confirmando en Docker Hub que la imagen con ambos tags aparece.
