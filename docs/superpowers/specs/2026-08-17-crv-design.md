# Reporte de CRV (Centro de Retención Vehicular) — Design

## Contexto

`axis_crv` es la última de las tablas que hoy solo tiene una definición mínima en `axis_tables.py` (`id` + `deleted_at`), usada exclusivamente para el conteo del Dashboard. No existe como reporte navegable. Se construye siguiendo el mismo patrón ya usado para Juicios, Pagos, Títulos de Crédito y Modificación de Infracciones: filtro de fecha, tabla paginada, descarga CSV/Excel, mostrando el 100% de las columnas reales desde el día uno (regla establecida esta sesión).

Se verificó contra `information_schema` que la tabla real tiene 26 columnas (incl. `id` y `deleted_at`), con FK real en `identificacion_agente` hacia `axis.personas` (igual patrón que Juicios/Infracciones) y en `localidad_ciudad_catalogo_item_id`/`provincia_catalogo_item_id` hacia `axis.catalogo_items` (sin join, mismo patrón ya usado en los demás reportes).

## Decisiones tomadas con el usuario

1. **Columna del filtro de fecha:** a diferencia de todos los demás reportes, `axis_crv` no tiene columna `fecha_registro`. Se usa `fecha_ingreso` (fecha de ingreso del vehículo al CRV) como columna del filtro de rango — es el evento principal del registro, análogo al rol de `fecha_registro` en los demás reportes.
2. **Etiqueta de `km_remolque`:** el documento oficial la etiqueta literalmente "KM_REMOLQUE" (estilo identificador), inconsistente con el resto de etiquetas del mismo documento que son frases naturales. Se usa **"Km de Remolque"** para mantener consistencia visual con el resto del reporte.

## Columnas reales (26 incl. `id` y `deleted_at`; 24 se muestran)

| Columna | Etiqueta | Tipo real | Truncar a fecha |
|---|---|---|---|
| `id` | (interno, no se muestra) | bigint | |
| `registro` | Registro | text | |
| `hora_generacion` | Hora de Generación del Registro | time | no — ya es `time` puro |
| `codigo_orden_crv` | Código de Orden CRV | text | |
| `codigo_actividad` | Código de Actividad | text | |
| `codigo_oficina` | Código de Oficina | text | |
| `descripcion_oficina` | Descripción de Oficina | text | |
| `placa` | Placa | text | |
| `nombre_agente` | Nombre Agente | text | |
| `identificacion_agente` | Identificación de Agente | text (FK → `axis.personas.identificacion`) | |
| `motivo_ingreso_crv` | Motivo Ingreso al CRV | text | |
| `clase` | Clase | text | |
| `provincia` | Provincia | text | |
| `localidad_ciudad` | Localidad o Ciudad | text | |
| `ciudadela` | Ciudadela | text | |
| `area` | Área | text | |
| `direccion` | Dirección | text | |
| `remolque` | Remolque | text | |
| `km_remolque` | Km de Remolque | text | |
| `valor_remolque` | Valor Remolque | text | |
| `deleted_at` | (no se muestra, regla establecida) | timestamp with time zone | |
| `fecha_generacion` | Fecha de Generación del Registro | date | no — ya es `date` puro |
| `fecha_ingreso` | Fecha Ingreso | timestamp without time zone | **sí** — `CAST(fecha_ingreso AS DATE)`; también es la columna del filtro de rango |
| `fecha_salida` | Fecha Salida | timestamp without time zone | **sí** — `CAST(fecha_salida AS DATE)` |
| `localidad_ciudad_catalogo_item_id` | ID de Catálogo (Localidad o Ciudad) | integer (FK → `catalogo_items.id`) | |
| `provincia_catalogo_item_id` | ID de Catálogo (Provincia) | integer (FK → `catalogo_items.id`) | |

## Comportamiento del reporte

- **Filtro de fecha:** rango sobre `fecha_ingreso` (`fecha_desde`/`fecha_hasta`), truncado a solo-fecha con `cast(columna, Date).between(...)`.
- **Exclusión de eliminados:** `WHERE deleted_at IS NULL`.
- **Sin filtro de estado** — esta tabla no tiene columna `estado`.
- **Orden:** por `fecha_ingreso DESC, id DESC` (columna completa, no truncada).
- **Paginación:** `PAGE_SIZE = 50`.
- **`identificacion_agente` tiene FK real a `axis.personas`** — los tests que le den un valor deben sembrar una persona primero, mismo patrón ya usado en Juicios/Infracciones.
- **Sin join a `catalogo_items`** para `localidad_ciudad_catalogo_item_id`/`provincia_catalogo_item_id` — se muestran como ID numérico crudo.
- Ninguna columna aparte de `id` es `NOT NULL` sin default (confirmado contra `information_schema`), así que no hay bloqueos de sembrado de tests.

## Arquitectura

Mismo patrón de archivos que Modificación de Infracciones (usa `_select_column`/`DATE_ONLY_COLUMNS` por el truncado de `fecha_ingreso`/`fecha_salida`), más el sembrado de persona de Juicios/Infracciones:

- **Backend:**
  - `apps/api/app/axis_tables.py` — ampliar `axis_crv` con las 24 columnas reales que faltan (todo excepto `id`/`deleted_at`, que ya existen).
  - `apps/api/app/routers/crv.py` (nuevo) — `GET /api/reportes/crv` (paginado) y `GET /api/reportes/crv/export` (csv/xlsx), con `_select_column(name)` + `DATE_ONLY_COLUMNS = {"fecha_ingreso", "fecha_salida"}`.
  - `apps/api/app/schemas.py` — agregar `CrvItem`/`CrvListResponse`.
  - `apps/api/app/main.py` — incluir el nuevo router con `app.include_router(crv_router)`.
  - `apps/api/tests/test_crv_routes.py` (nuevo) — tests calcados de `test_modificacion_infracciones_routes.py`, agregando sembrado de persona para `identificacion_agente` (patrón de `test_juicios_routes.py`/`test_infracciones_routes.py`).

- **Frontend:**
  - `apps/web/src/app/core/models/crv.model.ts` (nuevo).
  - `apps/web/src/app/core/crv.service.ts` (nuevo).
  - `apps/web/src/app/features/reportes/crv/crv.component.ts` + `.html` + `.spec.ts` (nuevo), con el array `COLUMNAS` cubriendo las 24 columnas mostradas.
  - Ruta nueva `/reportes/crv` + entrada "CRV" en el submenú "Reportes" del sidebar.

## Testing

Mismo enfoque que Modificación de Infracciones, más el sembrado de persona (mismo helper que Juicios/Infracciones) para las pruebas que necesiten un valor real en `identificacion_agente`. Se agregan los tests de truncado de fecha (`test_list_truncates_datetime_columns_to_date_only` / `test_export_truncates_datetime_columns_to_date_only`) para `fecha_ingreso` y `fecha_salida`.
