# Dashboard con Totales Reales por Tabla — Design

## Contexto

El Dashboard (`HomeComponent`) muestra hoy 4 tarjetas de KPI y una tabla "Actividad Reciente", ambas con datos inventados hardcodeados en el componente (`Total Multas Registradas: 12,450`, nombres de ciudadanos ficticios, etc.). Se reemplazan las 4 tarjetas por 7, una por cada tabla del schema `axis` que respalda un reporte real, mostrando el conteo real de filas de cada una. La tabla "Actividad Reciente" queda fuera de alcance — se resuelve en otro momento.

## Tablas incluidas (confirmado contra la base de datos real)

| Tabla | Etiqueta | Filas hoy (referencia, cambia con el tiempo) |
|---|---|---|
| `axis.axis_crv` | CRV | 16 |
| `axis.axis_impugnaciones` | Impugnaciones | 99,788 |
| `axis.axis_infracciones` | Infracciones | 314,460 |
| `axis.axis_juicios` | Juicios Coactivos | 1,009 |
| `axis.axis_modificacion_infracciones` | Modificación de Infracciones | 514 |
| `axis.axis_pagos` | Pagos | 95,749 |
| `axis.axis_titulos` | Títulos de Crédito | 1,654 |

`axis.axis_libretines` (3,920 filas) queda explícitamente afuera — no está en la lista de referencia del usuario.

Las 7 tarjetas se muestran siempre en este orden fijo.

## Regla de conteo

Cada total es `COUNT(*) WHERE deleted_at IS NULL`. Las 7 tablas tienen columna `deleted_at` (confirmado contra la base real: `timestamp with time zone`, nullable). Hoy no hay ninguna fila con `deleted_at` poblado en ninguna de las 7 tablas, así que el resultado es idéntico a un `COUNT(*)` sin filtro — pero esta es la definición correcta a futuro, y es consistente con cómo ya funciona el reporte de Juicios.

**Nota al margen (no se toca en este trabajo):** `axis_impugnaciones` y `axis_infracciones` también tienen `deleted_at`, pero sus reportes existentes (`GET /api/reportes/impugnaciones`, `GET /api/reportes/infracciones`) nunca lo filtran. No afecta el resultado actual (0 filas borradas), y corregir esos reportes queda fuera de alcance de este trabajo.

## Backend

### `apps/api/app/axis_tables.py`

Se agregan definiciones mínimas (`id`, `deleted_at`) para las 4 tablas que el código todavía no conocía — no se modelan sus demás columnas reales porque este endpoint no las necesita (si en el futuro se construye un reporte completo sobre alguna de ellas, ahí se completa el resto, siguiendo el mismo patrón que `axis_juicios`):

```python
axis_crv = Table(
    "axis_crv",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_modificacion_infracciones = Table(
    "axis_modificacion_infracciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_pagos = Table(
    "axis_pagos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)

axis_titulos = Table(
    "axis_titulos",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("deleted_at", DateTime(timezone=True)),
)
```

Además, se agrega la columna `deleted_at` (mismo tipo) a las definiciones ya existentes de `axis_impugnaciones` y `axis_infracciones` — cambio puramente aditivo, no afecta ninguna query existente de esos dos reportes (no seleccionan ni filtran esa columna hoy).

### `apps/api/app/schemas.py`

```python
class ResumenTablaItem(BaseModel):
    tabla: str
    etiqueta: str
    total: int


class DashboardResumenResponse(BaseModel):
    tablas: list[ResumenTablaItem]
```

`tabla` usa los slugs: `crv`, `impugnaciones`, `infracciones`, `juicios`, `modificacion_infracciones`, `pagos`, `titulos` (sufijo del nombre real de tabla, sin el prefijo `axis_`).

### `apps/api/app/routers/dashboard.py` (nuevo)

Un único endpoint:

`GET /api/dashboard/resumen` — requiere `require_active_user` (igual que los reportes: cualquier usuario autenticado sin cambio de contraseña pendiente, no admin-only). Ejecuta un `SELECT COUNT(*) WHERE deleted_at IS NULL` por cada una de las 7 tablas y devuelve `DashboardResumenResponse` con los 7 ítems en el orden fijo de la tabla de arriba. No audita evento (es solo lectura de un conteo agregado, no una búsqueda ni una descarga — mismo criterio implícito que ya se usa: `GET /me` tampoco audita).

Se registra el router nuevo en `apps/api/app/main.py`, igual que los demás.

## Frontend

- `apps/web/src/app/core/models/dashboard-resumen.model.ts` (nuevo): interfaces `ResumenTablaItem { tabla: string; etiqueta: string; total: number }` y `DashboardResumenResponse { tablas: ResumenTablaItem[] }`.
- `apps/web/src/app/core/dashboard.service.ts` (nuevo): `getResumen(): Observable<DashboardResumenResponse>` → `GET {apiUrl}/dashboard/resumen`.
- `apps/web/src/app/features/home/home.component.ts`: se elimina el array `kpis` hardcodeado. Se agrega `DashboardService`, un `BehaviorSubject<ResumenTablaItem[]>` (`resumen$`) poblado en `ngOnInit` (mismo patrón `BehaviorSubject`/`AsyncPipe` que el resto de la app), con manejo de error mostrando un mensaje si la carga falla. `actividadReciente` no se toca.
- `apps/web/src/app/features/home/home.component.html`: el bloque de tarjetas itera sobre `resumen$ | async` en vez del array `kpis` fijo — mismo grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`, ahora con 7 tarjetas en vez de 4, se acomodan solas por el wrap del grid), mismo estilo visual de tarjeta. Cada tarjeta muestra `etiqueta` y `total` (formateado con separador de miles vía `number` pipe de Angular). Se usa un ícono genérico único (`table_rows`) para las 7, ya que no hay un ícono distintivo por tabla definido — no son clickeables (3 de las 7 tablas no tienen reporte propio todavía).

## Fuera de alcance

- La tabla "Actividad Reciente" (mock) no se toca.
- No se corrige el filtro `deleted_at` faltante en los reportes existentes de Impugnaciones/Infracciones.
- Las tarjetas no son clickeables ni navegan a sus reportes.
- No se modelan las columnas reales de `axis_crv`, `axis_modificacion_infracciones`, `axis_pagos`, `axis_titulos` más allá de `id`/`deleted_at` — no hace falta para este conteo.
- `axis_libretines` no se incluye.

## Testing

- Backend (`apps/api/tests/test_dashboard_routes.py`, nuevo): siembra un par de filas por tabla (incluyendo alguna con `deleted_at` poblado) usando SQL crudo similar a los fixtures de Infracciones/Juicios, y verifica que el total excluye las borradas; verifica el orden y las 7 etiquetas exactas; verifica `401` sin token y `403 password_change_required` con el flag activo.
- Frontend: `dashboard.service.spec.ts` (nuevo) y actualización de `home.component.spec.ts` para las tarjetas reales (reemplaza las aserciones sobre los KPIs mock).
