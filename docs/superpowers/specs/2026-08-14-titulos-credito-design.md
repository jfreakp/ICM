# Reporte de Títulos de Crédito — Design

## Contexto

`axis_titulos` es una de las tablas que hoy solo tiene una definición mínima en `axis_tables.py` (`id` + `deleted_at`), usada exclusivamente para el conteo del Dashboard. No existe como reporte navegable. El usuario pidió construirlo siguiendo el mismo patrón ya usado para Juicios y Pagos: filtro de fecha, tabla paginada, descarga CSV/Excel, mostrando el 100% de las columnas reales desde el día uno (regla establecida esta sesión).

El documento oficial de descripción de campos (AXIS Cloud/Yoveri) incluye una sección "TÍTULOS DE CRÉDITOS" con la etiqueta de negocio exacta para cada campo. Se verificó contra `information_schema` que las 29 columnas documentadas (más `id`) mapean 1:1 con las columnas reales de `axis_titulos` — no hay huecos ni campos documentados ausentes de la base (a diferencia de lo que pasó con Juicios y su campo `estado` faltante).

## Columnas reales (31 incl. `id` y `deleted_at`; 29 se muestran), con etiqueta oficial y tipo

| Columna | Etiqueta oficial | Tipo real |
|---|---|---|
| `id` | (interno, no se muestra) | bigint |
| `registro` | Registro | text |
| `hora_generacion` | Hora de Generación del Registro | time |
| `codigo_titulo_credito` | Código Título Crédito | text |
| `tipo_identificacion` | Tipo de Identificación | text |
| `identificacion` | Identificación | text (FK → `axis.personas.identificacion`) |
| `nombre_completo` | Nombre Completo | text |
| `etapa_cobranza` | Etapa Cobranza | text |
| `estado` | Estado | text |
| `codigo_referencia` | Código de Referencia | text |
| `concepto` | Concepto | text |
| `nombre_elabora_titulo` | Nombre Elabora Título de Crédito | text |
| `nombre_solicita` | Nombre que Solicita | text |
| `nombre_aprobacion` | Nombre de Aprobación | text |
| `motivo_anulacion` | Motivo de Anulación | text |
| `fecha_generacion` | Fecha de Generación del Registro | date |
| `fecha_registro` | Fecha de Registro | date |
| `fecha_elaboracion` | Fecha de Elaboración | date |
| `fecha_solicitud` | Fecha de Solicitud | date |
| `fecha_aprobacion` | Fecha de Aprobación | date |
| `fecha_notificacion` | Fecha de Notificación | date |
| `fecha_pago` | Fecha de Pago | date |
| `fecha_anulacion` | Fecha de Anulación | date |
| `valor` | Valor | numeric |
| `multas` | Multas | numeric |
| `interes` | Interés | numeric |
| `valor_total` | Valor Total | numeric |
| `estado_catalogo_item_id` | ID de Catálogo (Estado) | integer (FK → `catalogo_items.id`) |
| `etapa_cobranza_catalogo_item_id` | ID de Catálogo (Etapa de Cobranza) | integer (FK → `catalogo_items.id`) |
| `tipo_identificacion_catalogo_item_id` | ID de Catálogo (Tipo de Identificación) | integer (FK → `catalogo_items.id`) |

`deleted_at` (timestamp with time zone) existe en la tabla pero, por la regla establecida esta sesión, no se muestra ni exporta en ningún reporte — se usa únicamente como filtro (`WHERE deleted_at IS NULL`).

**Ninguna columna es `timestamp`** — todas las fechas ya son `date` puro y `hora_generacion` ya es `time` puro. A diferencia de Impugnaciones/Infracciones/Pagos, este reporte **no necesita** truncado SQL (`CAST(... AS DATE)`): los valores ya llegan sin componente de hora.

## Comportamiento del reporte

- **Filtro de fecha:** rango sobre `fecha_registro` (`fecha_desde`/`fecha_hasta`), igual patrón que Juicios/Impugnaciones.
- **Exclusión de eliminados:** `WHERE deleted_at IS NULL`, igual que Juicios/Pagos.
- **Sin filtro de estado** (dropdown) — el campo `estado` se muestra en la tabla pero no filtra, igual que Juicios/Pagos.
- **Orden:** por `fecha_registro DESC, id DESC`, igual patrón que los demás reportes.
- **Paginación:** `PAGE_SIZE = 50`, igual que los demás.
- **Sin join a `catalogo_items`** para los `*_catalogo_item_id` — se muestran como ID numérico crudo, etiquetados `"ID de Catálogo (<concepto>)"`, igual convención que Impugnaciones/Infracciones/Pagos/Juicios.
- **`identificacion` tiene FK real a `axis.personas`** — los tests que le den un valor deben sembrar una persona primero, mismo patrón ya usado en Juicios/Infracciones.
- Ninguna columna aparte de `id` es `NOT NULL` sin default (confirmado contra `information_schema`), así que no hay bloqueos de sembrado de tests por columnas nuevas.

## Arquitectura

Mismo patrón de archivos que Juicios/Pagos:

- **Backend:**
  - `apps/api/app/axis_tables.py` — ampliar `axis_titulos` con las 28 columnas reales que faltan (todo excepto `id`/`deleted_at`, que ya existen).
  - `apps/api/app/routers/titulos.py` (nuevo) — `GET /api/reportes/titulos` (paginado) y `GET /api/reportes/titulos/export` (csv/xlsx), calcado de `juicios.py`.
  - `apps/api/app/schemas.py` — agregar `TituloItem`/`TituloListResponse`.
  - `apps/api/app/main.py` — incluir el nuevo router con `app.include_router(titulos_router)`, mismo patrón que `juicios_router` (línea 30).
  - `apps/api/tests/test_titulos_routes.py` (nuevo) — tests calcados de `test_juicios_routes.py`: listar dentro de rango, cruce de mes, rechazo de rango invertido, exclusión de eliminados, paginación, página fuera de rango, sin token, export csv/xlsx con headers y conteo de columnas completos.

- **Frontend:**
  - `apps/web/src/app/core/models/titulo.model.ts` (nuevo) — `TituloItem`, `TituloListResponse`, `TituloFilters`.
  - `apps/web/src/app/core/titulos.service.ts` (nuevo) — calcado de `juicios.service.ts`.
  - `apps/web/src/app/features/reportes/titulos/titulos.component.ts` + `.html` + `.spec.ts` (nuevo) — calcado de `juicios.component.*`, con el array `COLUMNAS` cubriendo las 29 columnas mostradas (todas menos `id`/`deleted_at`).
  - Ruta nueva `/reportes/titulos` + entrada en el submenú "Reportes" del sidebar (mismo lugar donde ya están Impugnaciones/Infracciones/Juicios/Pagos).

## Testing

Se sigue el mismo enfoque de test ya usado en Juicios/Pagos: sembrado directo por SQL de filas de `axis_titulos` (incluyendo sembrado de persona para `identificacion` cuando el test necesite un valor específico), aserciones de headers/conteo de columnas exactos en export CSV/XLSX, y test de exclusión de soft-delete. Al no haber truncado de fechas, no se necesita el test de truncado que sí existe en los otros 3 reportes.
