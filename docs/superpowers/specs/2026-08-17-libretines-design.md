# Reporte de Libretines — Design

## Contexto

`axis_libretines` es la última de las 8 tablas del documento oficial de descripción de campos (AXIS Cloud/Yoveri) sin reporte propio. A diferencia de las demás tablas que este session ya construyó (CRV, Modificación de Infracciones, Títulos de Crédito), `axis_libretines` no tiene siquiera una definición mínima en `axis_tables.py` — el usuario la excluyó explícitamente del conteo del Dashboard en una decisión anterior de esta sesión. Se confirmó con el usuario que ahora sí se construye como reporte completo, siguiendo el mismo patrón ya usado para los demás: filtro de fecha, tabla paginada, descarga CSV/Excel, mostrando el 100% de las columnas reales.

Se verificó contra `information_schema` que la tabla real tiene 42 columnas (incl. `id` y `deleted_at`), con FK real en `identificacion_agente` hacia `axis.personas` (igual patrón que Juicios/Infracciones/CRV) y en 4 columnas `*_catalogo_item_id` hacia `axis.catalogo_items` (sin join, mismo patrón ya usado en todos los demás reportes).

A diferencia de los últimos 3 reportes construidos, esta vez **no hay ambigüedades de etiquetado** — todas las columnas mapean limpio 1:1 al texto oficial del documento fuente, usado literalmente (mismo criterio de fidelidad al texto original ya aplicado en Títulos de Crédito, Modificación de Infracciones y CRV).

## Columnas reales (42 incl. `id` y `deleted_at`; 40 se muestran)

| Columna | Etiqueta | Tipo real | Truncar a fecha |
|---|---|---|---|
| `id` | (interno, no se muestra) | bigint | |
| `registro` | Registro | text | |
| `hora_generacion` | Hora de Generación del Registro | time | no — ya es `time` puro |
| `codigo_libretin` | Código Libretin | text | |
| `prefijo_boleta` | Prefijo Boleta | text | |
| `rango_inicio_boleta` | Rango Inicio Boleta | text | |
| `rango_fin_boleta` | Rango Fin Boleta | text | |
| `cantidad_boletas` | Cantidad Boletas | text | |
| `longitud_boleta` | Longitud Boleta | text | |
| `estado` | Estado | text | |
| `codigo_tramite` | Código de Trámite | text | |
| `codigo_usuario_creacion` | Código de Usuario Creación | text | |
| `codigo_tramite_asignacion` | Código de Trámite Asignación | text | |
| `codigo_usuario_asignacion` | Código de Usuario Asignación | text | |
| `codigo_usuario_inactiva` | Código de Usuario Inactiva | text | |
| `observacion` | Observación | text | |
| `codigo_agente` | Código Agente | text | |
| `identificacion_agente` | Identificación Agente | text (FK → `axis.personas.identificacion`) | |
| `agente` | Agente | text | |
| `codigo_distrito` | Código Distrito | text | |
| `descripcion_distrito` | Descripción Distrito | text | |
| `codigo_oficina` | Código Oficina | text | |
| `descripcion_oficina` | Descripción Oficina | text | |
| `codigo_provincia` | Código Provincia | text | |
| `descripcion_provincia` | Descripción Provincia | text | |
| `codigo_localidad` | Código Localidad | text | |
| `descripcion_localidad` | Descripción Localidad | text | |
| `tipo` | Tipo | text | |
| `origen_tramite` | Origen Trámite | text | |
| `motivo_baja` | Motivo Baja | text | |
| `disponibles` | Disponibles | text | |
| `utilizadas` | Utilizadas | text | |
| `desactivadas` | Desactivadas | text | |
| `deleted_at` | (no se muestra, regla establecida) | timestamp with time zone | |
| `fecha_generacion` | Fecha de Generación del Registro | date | no — ya es `date` puro |
| `fecha_registro` | Fecha de Registro | timestamp without time zone | **sí** — es la columna del filtro/orden |
| `fecha_asignacion` | Fecha Asignación | timestamp without time zone | **sí** |
| `fecha_inactivacion` | Fecha Inactivación | timestamp without time zone | **sí** |
| `codigo_localidad_catalogo_item_id` | ID de Catálogo (Localidad) | integer (FK → `catalogo_items.id`) | |
| `codigo_provincia_catalogo_item_id` | ID de Catálogo (Provincia) | integer (FK → `catalogo_items.id`) | |
| `estado_catalogo_item_id` | ID de Catálogo (Estado) | integer (FK → `catalogo_items.id`) | |
| `tipo_catalogo_item_id` | ID de Catálogo (Tipo) | integer (FK → `catalogo_items.id`) | |

`cantidad_boletas`, `disponibles`, `utilizadas` y `desactivadas` son columnas `text` reales en la base (no numéricas) — se tipan `str | None`, no `int`/`float`, confirmado contra `information_schema`.

## Comportamiento del reporte

- **Filtro de fecha:** rango sobre `fecha_registro` (`fecha_desde`/`fecha_hasta`), truncado a solo-fecha con `cast(columna, Date).between(...)`.
- **Exclusión de eliminados:** `WHERE deleted_at IS NULL`.
- **Sin filtro de estado** — aunque existe la columna `estado`, no se usa como filtro, mismo criterio ya aplicado en Juicios/Pagos (que sí tienen `estado` mostrado pero no filtrado).
- **Orden:** por `fecha_registro DESC, id DESC` (columna completa, no truncada).
- **Paginación:** `PAGE_SIZE = 50`.
- **`identificacion_agente` tiene FK real a `axis.personas`** — los tests que le den un valor deben sembrar una persona primero, mismo patrón ya usado en Juicios/Infracciones/CRV.
- **Sin join a `catalogo_items`** para las 4 columnas `*_catalogo_item_id` — se muestran como ID numérico crudo.
- Ninguna columna aparte de `id` es `NOT NULL` sin default (confirmado contra `information_schema`), así que no hay bloqueos de sembrado de tests.

## Arquitectura

Mismo patrón de archivos que CRV (usa `_select_column`/`DATE_ONLY_COLUMNS` con TRES columnas timestamp a truncar, más el sembrado de persona de Juicios/Infracciones):

- **Backend:**
  - `apps/api/app/axis_tables.py` — agregar la definición completa de `axis_libretines` (no existe ninguna definición hoy, ni siquiera mínima).
  - `apps/api/app/routers/libretines.py` (nuevo) — `GET /api/reportes/libretines` (paginado) y `GET /api/reportes/libretines/export` (csv/xlsx), con `_select_column(name)` + `DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_asignacion", "fecha_inactivacion"}`.
  - `apps/api/app/schemas.py` — agregar `LibretinItem`/`LibretinListResponse`.
  - `apps/api/app/main.py` — incluir el nuevo router con `app.include_router(libretines_router)`.
  - `apps/api/tests/test_libretines_routes.py` (nuevo) — tests calcados de `test_crv_routes.py`, con sembrado de persona para `identificacion_agente`.

- **Frontend:**
  - `apps/web/src/app/core/models/libretin.model.ts` (nuevo).
  - `apps/web/src/app/core/libretines.service.ts` (nuevo).
  - `apps/web/src/app/features/reportes/libretines/libretines.component.ts` + `.html` + `.spec.ts` (nuevo), con el array `COLUMNAS` cubriendo las 40 columnas mostradas.
  - Ruta nueva `/reportes/libretines` + entrada "Libretines" en el submenú "Reportes" del sidebar.

## Fuera de alcance

- No se agrega `axis_libretines` al conteo del Dashboard — el usuario la excluyó explícitamente de esa vista en una decisión anterior de esta sesión, y esta tarea es solo sobre construir el reporte navegable independiente.

## Testing

Mismo enfoque que CRV: sembrado directo por SQL con persona para `identificacion_agente`, tests de truncado de fecha (`test_list_truncates_datetime_columns_to_date_only` / `test_export_truncates_datetime_columns_to_date_only`) cubriendo las tres columnas timestamp (`fecha_registro`, `fecha_asignacion`, `fecha_inactivacion`).
