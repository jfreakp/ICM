# Reporte de Modificación de Infracciones — Design

## Contexto

`axis_modificacion_infracciones` es otra de las tablas que hoy solo tiene una definición mínima en `axis_tables.py` (`id` + `deleted_at`), usada exclusivamente para el conteo del Dashboard. No existe como reporte navegable. Se construye siguiendo el mismo patrón ya usado para Juicios, Pagos y Títulos de Crédito: filtro de fecha, tabla paginada, descarga CSV/Excel, mostrando el 100% de las columnas reales desde el día uno (regla establecida esta sesión).

Se verificó contra `information_schema` que la tabla real tiene 12 columnas (incl. `id` y `deleted_at`), sin ninguna llave foránea (a diferencia de Juicios/Títulos de Crédito, que sí tienen `identificacion` con FK a `axis.personas`).

## Hallazgo resuelto con el usuario: etiquetas ambiguas

El documento oficial de campos (AXIS Cloud/Yoveri) describe dos conceptos distintos con el mismo texto "Código de la Infracción" en la sección "MODIFICACIÓN DE INFRACCIONES": el código de la infracción original, y el código de la infracción generada en el acta de juzgamiento cuando la sentencia es condenatoria con modificación. La base real sí los separa en dos columnas (`codigo_infraccion_original` y `codigo_infraccion_acta`). Se acordó etiquetarlas como **"Código de la Infracción (Original)"** y **"Código de la Infracción (Acta)"** — mantiene el texto exacto del documento fuente y las distingue con el sufijo real de la columna, mismo estilo que "ID de Catálogo (X)" ya usado en los demás reportes.

## Columnas reales (12 incl. `id` y `deleted_at`; 10 se muestran)

| Columna | Etiqueta | Tipo real | Truncar a fecha |
|---|---|---|---|
| `id` | (interno, no se muestra) | bigint | |
| `registro` | Registro | text | |
| `hora_generacion` | Hora de Generación del Registro | time | no — ya es `time` puro |
| `codigo_infraccion_original` | Código de la Infracción (Original) | text | |
| `contravencion` | Contravención | text | |
| `observacion` | Observación | text | |
| `codigo_infraccion_acta` | Código de la Infracción (Acta) | text | |
| `codigo_usuario_modifica` | Código de Usuario que Modifica | text | |
| `numero_credito` | Número de Crédito | text | |
| `deleted_at` | (no se muestra, regla establecida) | timestamp with time zone | |
| `fecha_generacion` | Fecha de Generación del Registro | date | no — ya es `date` puro |
| `fecha_registro` | Fecha de Registro | timestamp without time zone | **sí** — se selecciona con `CAST(fecha_registro AS DATE)` |

## Comportamiento del reporte

- **Filtro de fecha:** rango sobre `fecha_registro` (`fecha_desde`/`fecha_hasta`), truncado a solo-fecha con `cast(columna, Date).between(...)`, mismo patrón que Impugnaciones/Infracciones/Pagos.
- **Exclusión de eliminados:** `WHERE deleted_at IS NULL`.
- **Sin filtro de estado** — esta tabla ni siquiera tiene columna `estado`.
- **Orden:** por `fecha_registro DESC, id DESC` (usando la columna de fecha completa, no la truncada, igual convención que los demás reportes).
- **Paginación:** `PAGE_SIZE = 50`.
- **Sin FKs que sembrar en los tests** — ninguna columna tiene llave foránea a `personas` ni a `catalogo_items` en esta tabla.
- Ninguna columna aparte de `id` es `NOT NULL` sin default (confirmado contra `information_schema`), así que no hay bloqueos de sembrado de tests.

## Arquitectura

Mismo patrón de archivos que Impugnaciones/Infracciones/Pagos (usa `_select_column`/`DATE_ONLY_COLUMNS` por el truncado de `fecha_registro`), en vez del patrón de Juicios/Títulos (que no necesitan truncado):

- **Backend:**
  - `apps/api/app/axis_tables.py` — ampliar `axis_modificacion_infracciones` con las 10 columnas reales que faltan (todo excepto `id`/`deleted_at`, que ya existen).
  - `apps/api/app/routers/modificacion_infracciones.py` (nuevo) — `GET /api/reportes/modificacion-infracciones` (paginado) y `GET /api/reportes/modificacion-infracciones/export` (csv/xlsx), con `_select_column(name)` + `DATE_ONLY_COLUMNS = {"fecha_registro"}` igual patrón que `reportes.py`/`infracciones.py`/`pagos.py`.
  - `apps/api/app/schemas.py` — agregar `ModificacionInfraccionItem`/`ModificacionInfraccionListResponse`.
  - `apps/api/app/main.py` — incluir el nuevo router con `app.include_router(modificacion_infracciones_router)`.
  - `apps/api/tests/test_modificacion_infracciones_routes.py` (nuevo) — tests calcados de `test_pagos_routes.py` (sin sembrado de personas): rango, cruce de mes, rango invertido, exclusión de eliminados, paginación, página fuera de rango, sin token, truncado de fecha en list y export, export csv/xlsx con headers y conteo de columnas completos.

- **Frontend:**
  - `apps/web/src/app/core/models/modificacion-infraccion.model.ts` (nuevo).
  - `apps/web/src/app/core/modificacion-infracciones.service.ts` (nuevo) — calcado de `pagos.service.ts`.
  - `apps/web/src/app/features/reportes/modificacion-infracciones/modificacion-infracciones.component.ts` + `.html` + `.spec.ts` (nuevo) — calcado de `pagos.component.*`, con el array `COLUMNAS` cubriendo las 10 columnas mostradas.
  - Ruta nueva `/reportes/modificacion-infracciones` + entrada "Modificación de Infracciones" en el submenú "Reportes" del sidebar.

## Testing

Mismo enfoque que Pagos: sembrado directo por SQL, sin necesidad de sembrar personas (no hay FK). Se agrega el test de truncado de fecha (`test_list_truncates_datetime_columns_to_date_only` / `test_export_truncates_datetime_columns_to_date_only`) para `fecha_registro`, igual patrón ya usado en los otros 3 reportes con columnas timestamp.
