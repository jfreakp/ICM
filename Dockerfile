# ---- Stage 1: build the Angular frontend ----
FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build -- --configuration production

# ---- Stage 2: backend runtime, serving the built frontend ----
FROM python:3.11-slim AS runtime
WORKDIR /app

COPY apps/api/pyproject.toml ./
COPY apps/api/app/ ./app/
RUN pip install --no-cache-dir . && rm -rf build matriculacion_api.egg-info

COPY apps/api/alembic/ ./alembic/
COPY apps/api/alembic.ini ./

COPY --from=frontend-build /app/dist/web/browser/ ./static/

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8100

RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

ENTRYPOINT ["./docker-entrypoint.sh"]
