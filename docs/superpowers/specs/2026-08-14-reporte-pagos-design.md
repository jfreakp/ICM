# Reporte de Pagos — Design

## Contexto

Tercer reporte de este tipo (después de Impugnaciones/Infracciones y Juicios), sobre la tabla real de solo lectura `axis.axis_pagos` (95,749 filas hoy), que registra las transacciones de pago procesadas por recaudadores externos (bancos).

## Tabla de origen

`axis.axis_pagos` (confirmada contra la base de datos real):

| Columna | Tipo Postgres |
|---|---|
| id | bigint |
| registro | text |
| hora_generacion | time |
| tipo_recaudador | text |
| recaudador | text |
| comprobante_pago_interno | text |
| comprobante_pago_recaudador | text |
| tipo_servicio | text |
| tipo_documento | text |
| numero_documento | text |
| deleted_at | timestamptz |
| fecha_generacion | date |
| fecha_operacion | timestamp (sin timezone) |
| fecha_transaccion | timestamp (sin timezone) |
| monto_recaudado | numeric(14,2) |
| monto_cuenta_1 | numeric(14,2) |
| monto_cuenta_2 | numeric(14,2) |
| tipo_documento_catalogo_item_id | integer |
| tipo_recaudador_catalogo_item_id | integer |
| tipo_servicio_catalogo_item_id | integer |

Sin FK a `axis.personas` (a diferencia de Juicios/Títulos). Las 3 columnas `*_catalogo_item_id` tienen FK a `axis.catalogo_items.id`, pero son redundantes: `tipo_documento`, `tipo_recaudador` y `tipo_servicio` ya traen el valor de texto legible directamente en la tabla.

## Alcance y decisiones

- **Sin filtro de "Estado"** — la tabla no tiene esa columna.
- **Filtro de rango de fechas sobre `fecha_transaccion`**, con la misma única validación que los demás reportes: `fecha_desde` no puede ser posterior a `fecha_hasta` (sin límite de mismo mes calendario).
- **Excluir siempre los pagos con soft-delete**: `WHERE deleted_at IS NULL`.
- **16 de las 20 columnas reales** se muestran/exportan (15 nombradas + `id`, mismo patrón que los otros reportes). Se excluyen:
  - `deleted_at`: uso interno.
  - `tipo_documento_catalogo_item_id`, `tipo_recaudador_catalogo_item_id`, `tipo_servicio_catalogo_item_id`: redundantes con `tipo_documento`/`tipo_recaudador`/`tipo_servicio`. No se hace join con `catalogo_items`.
- La tabla SQLAlchemy Core (`axis_pagos` en `axis_tables.py`) modela las 20 columnas reales (se necesita `deleted_at` para el filtro `WHERE`), pero `COLUMN_HEADERS`/`COLUMN_NAMES` contiene solo las 15 mostradas/exportadas.

## Backend

### `apps/api/app/axis_tables.py`

```python
axis_pagos = Table(
    "axis_pagos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("tipo_recaudador", Text),
    Column("recaudador", Text),
    Column("comprobante_pago_interno", Text),
    Column("comprobante_pago_recaudador", Text),
    Column("tipo_servicio", Text),
    Column("tipo_documento", Text),
    Column("numero_documento", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_operacion", DateTime),
    Column("fecha_transaccion", DateTime),
    Column("monto_recaudado", Numeric(14, 2)),
    Column("monto_cuenta_1", Numeric(14, 2)),
    Column("monto_cuenta_2", Numeric(14, 2)),
    Column("tipo_documento_catalogo_item_id", Integer),
    Column("tipo_recaudador_catalogo_item_id", Integer),
    Column("tipo_servicio_catalogo_item_id", Integer),
)
```

Nota: esta plan ya usa un nombre de tabla `axis_pagos` — coincide con el que el trabajo anterior del Dashboard ya agregó como definición **mínima** (solo `id`/`deleted_at`) para el conteo de totales. Este reporte reemplaza esa definición mínima por la completa de arriba (superset de columnas, cambio aditivo — el endpoint del Dashboard sigue funcionando igual porque solo usa `id`/`deleted_at`, ambas presentes).

### `apps/api/app/routers/pagos.py` (nuevo)

Mismo esqueleto que `juicios.py`: `_validate_date_range` (solo chequeo de orden), `_date_range_conditions` (rango sobre `fecha_transaccion` + `deleted_at IS NULL`), `COLUMN_HEADERS` (15 columnas, orden fijo):

```python
COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación",
    "tipo_recaudador": "Tipo de Recaudador",
    "recaudador": "Recaudador",
    "comprobante_pago_interno": "Comprobante de Pago Interno",
    "comprobante_pago_recaudador": "Comprobante de Pago del Recaudador",
    "tipo_servicio": "Tipo de Servicio",
    "tipo_documento": "Tipo de Documento",
    "numero_documento": "Número de Documento",
    "fecha_generacion": "Fecha de Generación",
    "fecha_operacion": "Fecha de Operación",
    "fecha_transaccion": "Fecha de Transacción",
    "monto_recaudado": "Monto Recaudado",
    "monto_cuenta_1": "Monto Cuenta 1",
    "monto_cuenta_2": "Monto Cuenta 2",
}
COLUMN_NAMES = list(COLUMN_HEADERS)
```

Dos endpoints:

- `GET /api/reportes/pagos` (paginado, 50/página), audita `reportes.pagos.search` (`fecha_desde`, `fecha_hasta`, `page`, `total`).
- `GET /api/reportes/pagos/export?formato=csv|xlsx` (sin paginar), audita `reportes.pagos.export` (`fecha_desde`, `fecha_hasta`, `formato`, `filas_exportadas`).

Ambos requieren solo `require_active_user` (no admin-only), igual que los otros reportes. Se registra el router en `apps/api/app/main.py`.

### `apps/api/app/schemas.py`

`PagoItem` (16 campos: `id` + 15 nombrados, tipos: `str | None` para textos, `time | None` para `hora_generacion`, `date | None` para `fecha_generacion`, `datetime | None` para `fecha_operacion`/`fecha_transaccion`, `float | None` para los 3 montos) y `PagoListResponse` (`items`, `total`, `page`, `page_size`), mismo patrón que `JuicioItem`/`JuicioListResponse`.

## Frontend

- `apps/web/src/app/core/models/pago.model.ts`: `PagoItem` + `PagoListResponse` + `PagoFilters` (`fecha_desde`, `fecha_hasta`).
- `apps/web/src/app/core/pagos.service.ts`: `listPagos(filters, page)`, `exportPagos(filters, formato)`.
- `apps/web/src/app/features/reportes/pagos/pagos.component.{ts,html,spec.ts}` (nuevo): mismo patrón que `JuiciosComponent` (sin campo de estado), 15 columnas en la tabla.
- Ruta `{ path: 'reportes/pagos', component: PagosComponent, canActivate: [authGuard] }` en `app.routes.ts`.
- Nuevo ítem "Pagos" en el submenú "Reportes" de `AppShellComponent`.
- `apps/web/src/app/features/auditoria/auditoria.component.ts`: agregar `reportes.pagos.search`/`.export` al catálogo `ACCIONES` (sin caso en `detalle()`, mismo nivel de completitud que Infracciones/Juicios).

## Fuera de alcance

- No se deriva ningún "estado" para los pagos.
- No se hace join con `axis.catalogo`/`axis.catalogo_items`.
- No se agrega ningún límite de rango de fechas.

## Testing

- Backend (`apps/api/tests/test_pagos_routes.py`, nuevo): listado dentro de rango, paginación, rechazo de `fecha_desde > fecha_hasta`, exclusión de filas con `deleted_at` no nulo, export CSV y XLSX (headers, BOM, streaming), auditoría de `reportes.pagos.search`/`.export`, bloqueo por `must_change_password`. Sin necesidad de sembrar `axis.personas` (no hay FK a esa tabla).
- Frontend: `pagos.component.spec.ts` (validación de formulario, tabla, paginación, exportación, zoneless async rendering), actualización de `app-shell.component.spec.ts` (nuevo ítem de menú).
