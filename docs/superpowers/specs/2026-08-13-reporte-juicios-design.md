# Reporte de Juicios — Design

## Contexto

El sistema ya tiene dos reportes (Impugnaciones, Infracciones) que siguen el mismo patrón: filtro de rango de fechas + estado, tabla paginada, export CSV/XLSX, todo contra tablas reales de solo lectura en el schema `axis`. Se agrega un tercer reporte, Juicios, sobre la tabla real `axis.axis_juicios` (1009 filas hoy), que registra el proceso judicial de cobro coactivo de multas.

## Tabla de origen

`axis.axis_juicios` (confirmada contra la base de datos real):

| Columna | Tipo Postgres |
|---|---|
| id | bigint |
| registro | text |
| hora_generacion | time |
| codigo | text |
| tipo_identificacion | text (CED/RUC) |
| identificacion | text |
| nombre_completo | text |
| gestor_responsable | text |
| gestor_secretario | text |
| gestor_anulacion | text |
| gestor_suspension | text |
| gestor_reactivacion | text |
| motivo_anulacion | text |
| deleted_at | timestamptz |
| fecha_generacion | date |
| fecha_registro | date |
| fecha_inicio_juicio | date |
| fecha_notificacion | date |
| fecha_pago | date |
| fecha_fin | date |
| fecha_anulacion | date |
| fecha_suspension | date |
| fecha_reactivacion | date |
| valor_capital | numeric(14,2) |
| valor_interes | numeric(14,2) |
| valor_multas | numeric(14,2) |
| valor_costas | numeric(14,2) |
| valor_total | numeric(14,2) |
| tipo_identificacion_catalogo_item_id | integer |

## Alcance y decisiones

- **Sin filtro de "Estado".** A diferencia de Impugnaciones/Infracciones, esta tabla no tiene una columna de estado directa. No se deriva un estado a partir de las fechas de ciclo de vida en esta versión — queda fuera de alcance explícitamente.
- **Filtro de rango de fechas sobre `fecha_registro`**, igual criterio que los otros dos reportes. Única validación: `fecha_desde` no puede ser posterior a `fecha_hasta` (sin límite de mismo mes calendario, consistente con el cambio reciente que se le quitó a los otros dos reportes).
- **Excluir siempre los juicios con soft-delete**: el listado y el export filtran `WHERE deleted_at IS NULL`. Hoy no hay ninguna fila con `deleted_at` poblado, así que no cambia el resultado actual, pero deja el comportamiento correcto para el futuro.
- **27 de las 29 columnas se muestran/exportan.** Se excluyen:
  - `deleted_at`: uso puramente interno (para el filtro de soft-delete), no aporta valor al usuario del reporte.
  - `tipo_identificacion_catalogo_item_id`: es una clave foránea a `axis.catalogo_items` cuyo `value` es exactamente el mismo dato que ya está en la columna `tipo_identificacion` ("CED"/"RUC", confirmado contra la base: `catalogo_items.id=67 → value='CED'`, `id=68 → value='RUC'`). No se hace join con `catalogo_items` — se usa directamente `tipo_identificacion`.
  - La tabla SQLAlchemy Core (`axis_juicios` en `axis_tables.py`) sigue definiendo las 29 columnas reales (se necesita `deleted_at` para el filtro `WHERE`), pero la lista de columnas mostradas/exportadas (`COLUMN_HEADERS`/`COLUMN_NAMES`, mismo patrón que los otros reportes) contiene solo las 27.

## Backend

### `apps/api/app/axis_tables.py`

Agregar, siguiendo el mismo patrón que `axis_impugnaciones`/`axis_infracciones` (tabla `Core`, no ORM, de solo lectura):

```python
from sqlalchemy import Date, DateTime, Integer, Time

axis_juicios = Table(
    "axis_juicios",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("hora_generacion", Time),
    Column("codigo", Text),
    Column("tipo_identificacion", Text),
    Column("identificacion", Text),
    Column("nombre_completo", Text),
    Column("gestor_responsable", Text),
    Column("gestor_secretario", Text),
    Column("gestor_anulacion", Text),
    Column("gestor_suspension", Text),
    Column("gestor_reactivacion", Text),
    Column("motivo_anulacion", Text),
    Column("deleted_at", DateTime(timezone=True)),
    Column("fecha_generacion", Date),
    Column("fecha_registro", Date),
    Column("fecha_inicio_juicio", Date),
    Column("fecha_notificacion", Date),
    Column("fecha_pago", Date),
    Column("fecha_fin", Date),
    Column("fecha_anulacion", Date),
    Column("fecha_suspension", Date),
    Column("fecha_reactivacion", Date),
    Column("valor_capital", Numeric(14, 2)),
    Column("valor_interes", Numeric(14, 2)),
    Column("valor_multas", Numeric(14, 2)),
    Column("valor_costas", Numeric(14, 2)),
    Column("valor_total", Numeric(14, 2)),
    Column("tipo_identificacion_catalogo_item_id", Integer),
)
```

(`Date`, `DateTime`, `Integer`, `Time` se agregan al import existente de `sqlalchemy` en ese archivo; `BigInteger`, `Column`, `Numeric`, `Table`, `Text` ya están importados.)

### `apps/api/app/routers/juicios.py` (nuevo)

Mismo esqueleto que `infracciones.py`: `_validate_date_range` (solo chequeo de orden), `_date_range_conditions` (rango sobre `fecha_registro` + `deleted_at IS NULL`), y dos endpoints:

`COLUMN_HEADERS` (27 columnas, orden fijo — identificación del juicio, luego del deudor, luego gestores, luego fechas de ciclo de vida, luego valores):

```python
COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "codigo": "Código",
    "hora_generacion": "Hora de Generación",
    "tipo_identificacion": "Tipo de Identificación",
    "identificacion": "Identificación",
    "nombre_completo": "Nombre Completo",
    "gestor_responsable": "Gestor Responsable",
    "gestor_secretario": "Gestor Secretario",
    "gestor_anulacion": "Gestor de Anulación",
    "gestor_suspension": "Gestor de Suspensión",
    "gestor_reactivacion": "Gestor de Reactivación",
    "motivo_anulacion": "Motivo de Anulación",
    "fecha_generacion": "Fecha de Generación",
    "fecha_registro": "Fecha de Registro",
    "fecha_inicio_juicio": "Fecha de Inicio de Juicio",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_fin": "Fecha de Fin",
    "fecha_anulacion": "Fecha de Anulación",
    "fecha_suspension": "Fecha de Suspensión",
    "fecha_reactivacion": "Fecha de Reactivación",
    "valor_capital": "Valor Capital",
    "valor_interes": "Valor Interés",
    "valor_multas": "Valor Multas",
    "valor_costas": "Valor Costas",
    "valor_total": "Valor Total",
}
COLUMN_NAMES = list(COLUMN_HEADERS)
```

(27 keys, matching the table's 29 real columns minus `deleted_at` and `tipo_identificacion_catalogo_item_id`, per the exclusions above.)

Endpoints:

- `GET /api/reportes/juicios` (paginado, 50/página, `fecha_desde`/`fecha_hasta` requeridos, sin parámetro `estado`), audita `reportes.juicios.search`.
- `GET /api/reportes/juicios/export?formato=csv|xlsx` (sin paginar, todo el rango), audita `reportes.juicios.export`.

Ambos requieren solo `get_current_user`/`require_active_user` (no admin) — igual que los otros dos reportes, cualquier usuario autenticado con la contraseña ya cambiada puede usarlos.

Se registra el router nuevo en `apps/api/app/main.py`, igual que los otros dos.

### `apps/api/app/schemas.py`

Nuevo `JuicioItem` (27 campos, `model_config = {"from_attributes": True}`) y `JuicioListResponse` (`items`, `total`, `page`, `page_size`), mismo patrón que `InfraccionItem`/`InfraccionListResponse`.

## Frontend

- `apps/web/src/app/core/models/juicio.model.ts`: interfaz `JuicioItem` + `JuicioListResponse` (mismos 27 campos).
- `apps/web/src/app/core/juicios.service.ts`: `getJuicios(filters, page)`, `exportJuicios(filters, formato)` — mismo patrón que `InfraccionesService`.
- `apps/web/src/app/features/reportes/juicios/juicios.component.{ts,html,spec.ts}` (nuevo): formulario reactivo con `fechaDesde`/`fechaHasta` (sin campo de estado), tabla con las 27 columnas, paginación, botones de export CSV/XLSX. Mismo patrón `BehaviorSubject`/`AsyncPipe` y validación de orden de fechas (sin chequeo de mismo mes) que ya tienen los otros dos componentes.
- Ruta nueva `{ path: 'reportes/juicios', component: JuiciosComponent, canActivate: [authGuard] }` en `app.routes.ts`.
- Nuevo ítem "Juicios" en el submenú "Reportes" de `AppShellComponent` (`apps/web/src/app/shared/app-shell/app-shell.component.{ts,html,spec.ts}`), junto a Impugnaciones e Infracciones.
- `apps/web/src/app/features/auditoria/auditoria.component.ts`: agregar `reportes.juicios.search` y `reportes.juicios.export` al catálogo `ACCIONES` (la revisión final de Infracciones encontró que faltaban sus dos acciones ahí — se agregan las de Juicios desde el principio esta vez).

## Fuera de alcance

- No se deriva ni se filtra por "estado" calculado a partir de las fechas de ciclo de vida.
- No se hace join con `axis.catalogo`/`axis.catalogo_items`.
- No se agrega ningún límite de rango de fechas (consistente con el cambio reciente en los otros dos reportes).

## Testing

- Backend (`apps/api/tests/test_juicios_routes.py`, nuevo): listado dentro de rango, paginación, rechazo de `fecha_desde > fecha_hasta`, exclusión de filas con `deleted_at` no nulo, export CSV y XLSX (headers, BOM, streaming, mismo patrón que `test_infracciones_routes.py`), auditoría de `reportes.juicios.search`/`.export`.
- Frontend: `juicios.component.spec.ts` (validación de formulario, tabla, paginación, exportación, zoneless async rendering), actualización de `app-shell.component.spec.ts` (nuevo ítem de menú) y `auditoria.component.spec.ts` si aplica (nuevas acciones en el catálogo).
