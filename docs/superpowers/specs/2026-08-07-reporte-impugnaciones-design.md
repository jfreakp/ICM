# Reporte de Impugnaciones (submenu de Reportes)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-07 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

`ReportesComponent` hoy es una página placeholder con datos de multas inventados (commit `8c3ae8e`).
Se pidió construir el primer reporte real, sobre `axis.axis_impugnaciones` (99,788 filas migradas por
el skill `axis-loja-migracion`), como el primero de una futura familia de reportes bajo un submenu
"Reportes" en el sidebar.

**Hallazgo clave de los datos que cambió el diseño original:** el pedido original decía filtrar por
"fecha de generación", que coincide con la columna `fecha_generacion`. Esa columna tiene el **mismo
valor en las 99,788 filas** (`2026-07-20`, junto con `hora_generacion = 16:14:31`) — es la fecha en
que AXIS Cloud generó el archivo de exportación completo, no una fecha por impugnación. Como
`load_data.py` hace `TRUNCATE` antes de cada recarga (ver `~/.claude/skills/axis-loja-migracion/`),
nunca coexisten en la tabla dos fechas de generación distintas — filtrar por rango ahí no tendría
efecto hasta una recarga futura. Se usa en su lugar `fecha_registro`, que sí varía por fila (3,032
fechas distintas, min/max con algunas filas de fecha inválida — 4 filas con año fuera de
[1900, 2027], ignoradas, no requieren manejo especial).

## Alcance

**Incluido:**
- Endpoint de listado paginado de `axis.axis_impugnaciones` con filtros de fecha (obligatorio) y
  estado (opcional).
- Endpoint de descarga (CSV y Excel) del resultado completo del filtro, sin paginar.
- Endpoint auxiliar que devuelve los valores distintos de `estado` presentes en la tabla, para
  poblar el dropdown sin hardcodear valores.
- Página `Impugnaciones` en el frontend, accesible desde un submenu "Reportes" en el sidebar.
- Validación (cliente y servidor) de que el rango de fechas cae dentro de un mismo mes calendario.

**Explícitamente fuera de alcance:**
- Cualquier otro reporte (`axis_infracciones`, `axis_pagos`, etc.) — queda como trabajo futuro, cada
  uno con su propio spec.
- Filtros adicionales más allá de `estado` y `fecha_registro` (la tabla tiene otros campos
  filtrables — `tipo_acta`, `juzgado`, `provincia`/`localidad`, `contravencion` — pero no se pidieron
  y no se agregan sin pedido explícito).
- PostgREST — se evaluó y se descarta para esta fase: la validación de "mismo mes calendario" es
  lógica de negocio que vive mejor en la app que en un passthrough REST genérico.
- Restricción por rol de quién puede ver Reportes/Impugnaciones — hoy cualquier usuario autenticado
  puede, igual que el resto de páginas salvo Administración de Usuarios.

## Columnas del reporte

Mismas columnas en pantalla y en la descarga (CSV/Excel), elegidas porque tienen dato en el 100% de
las filas (se descartaron explícitamente las que están mayormente vacías):

| Columna (DB) | Encabezado en el reporte |
|---|---|
| `registro` | Registro |
| `fecha_registro` | Fecha de Registro |
| `fecha_acta` | Fecha de Acta |
| `estado` | Estado |
| `codigo_infraccion_axis` | Código de Infracción AXIS |
| `contravencion` | Contravención |
| `tipo_acta` | Tipo de Acta |
| `articulo_original` | Artículo Original |
| `monto_capital_original` | Monto Capital Original |
| `observacion` | Observación |

**Descartadas por estar mayormente vacías** (verificado contra los datos reales, no una suposición):
`juzgado`, `codigo_provincia`, `codigo_localidad`, `numero_tramite` (65% nulas), `sancion_original`
(84% nula), `fecha_vencimiento_original` (91% nula), `fecha_aprobacion`, `numero_credito`,
`numero_proceso` (100% vacías — cero datos en toda la tabla).

## Filtros y validación de fechas

- `fecha_registro`: **obligatorio**, rango (`fecha_desde`, `fecha_hasta`).
- `estado`: opcional, dropdown poblado desde `SELECT DISTINCT estado FROM axis.axis_impugnaciones`
  (hoy solo devolvería `'A'`; se ajusta solo cuando aparezcan valores nuevos, sin tocar código).
- **Regla del mismo mes**: `fecha_desde` y `fecha_hasta` deben caer en el mismo mes y año calendario
  (`fecha_desde.year == fecha_hasta.year and fecha_desde.month == fecha_hasta.month`) y
  `fecha_desde <= fecha_hasta`. Válido: 1 al 15, 5 al 25 del mismo mes. Inválido: 15 de un mes al 5
  del mes siguiente. Se valida en el cliente (feedback inmediato, sin llamar al backend) y se
  re-valida en el servidor como autoridad final (`400` con detalle si no cumple, por si llega una
  request directa que se salte la validación del cliente).

## Backend

### Endpoints (`apps/api/app/routers/reportes.py`, protegidos con `get_current_user` — cualquier
usuario autenticado, sin restricción de rol)

- **`GET /api/reportes/impugnaciones/estados`** → `list[str]`.
- **`GET /api/reportes/impugnaciones`** — query params `fecha_desde: date`, `fecha_hasta: date`
  (ambos obligatorios), `estado: str | None`, `page: int = 1`. Tamaño de página fijo: 50. Responde
  `{ items: ImpugnacionItem[], total: int, page: int, page_size: int }`. Orden estable:
  `ORDER BY fecha_registro DESC, id DESC` (evita filas repetidas/saltadas entre páginas cuando
  varias comparten `fecha_registro`). Página fuera de rango → `items: []`, no error.
- **`GET /api/reportes/impugnaciones/export`** — mismos filtros (sin `page`) + `formato: "csv" |
  "xlsx"`. Devuelve el archivo completo del filtro (sin paginar, hasta ~6,400 filas en el mes más
  cargado — cabe cómodo en memoria) como descarga (`Content-Disposition: attachment;
  filename=impugnaciones_<fecha_desde>_<fecha_hasta>.<ext>`). Encabezados de columna en español
  legible (tabla de arriba), no los nombres crudos de columna.

**Consulta**: `SELECT` con SQLAlchemy Core (no hace falta un modelo ORM de las 41 columnas de la
tabla — se define un `Table` reflejado o declarado manualmente solo con las 10 columnas usadas más
`id` para el orden estable). `total` viene de una segunda consulta `COUNT(*)` con el mismo `WHERE`.

**Nueva dependencia**: `openpyxl`, para generar `.xlsx` real (no un CSV con extensión falsa) —
agregar a `apps/api/pyproject.toml`.

## Frontend

- **Sidebar** (`app-shell.component.html`/`.ts`): "Reportes" pasa a ser un ítem expandible (estado
  local de UI, sin relación con auth — un booleano en el componente, sin persistencia). Al
  expandirse muestra "Impugnaciones" como único sub-ítem por ahora, indentado, listo para agregar
  hermanos después. Se auto-expande y resalta el sub-ítem cuando la ruta activa es `impugnaciones`.
- **Se elimina** `ReportesComponent` (página placeholder) y su ruta `/reportes` — se reemplaza por
  `ImpugnacionesComponent` en `/reportes/impugnaciones`
  (`apps/web/src/app/features/reportes/impugnaciones/`), dejando el folder `reportes/` listo para
  futuros reportes hermanos.
- **`ImpugnacionesComponent`**:
  - Formulario: fecha desde, fecha hasta (`<input type="date">`, ambas obligatorias), estado
    (`<select>` poblado desde `GET /estados`), botón "Filtrar". Validación de "mismo mes calendario"
    en cliente antes de habilitar el submit — mensaje inmediato si el rango cruza de mes.
  - Tabla paginada (50 filas/página, controles anterior/siguiente + indicador de página).
  - Botones "Descargar CSV" y "Descargar Excel" — mandan los filtros vigentes al endpoint de
    export y disparan la descarga del archivo completo (no la página visible). Deshabilitados
    cuando el filtro no tiene resultados.
  - Estados: carga ("Cargando..."), vacío ("No hay impugnaciones para estos filtros"), error del
    backend (ej. si la validación de fechas se salta en el cliente y el servidor la rechaza).

**Principio obligatorio para la implementación**: toda la carga de datos (resultados, estados,
export) sigue el patrón `BehaviorSubject` + `AsyncPipe` ya establecido en esta sesión
(`HomeComponent.currentUser$`, y los fixes de `AdministracionUsuariosComponent`/`LoginComponent` en
los commits `c4b6a2c` y `c363ca4`). Esta app corre con change detection zoneless — un
`.subscribe(v => this.campo = v)` sobre un campo plano no dispara re-render. Cualquier tarea que
reintroduzca ese patrón se considera un defecto, no una variación aceptable.

## Manejo de errores y casos borde

- Rango cruza de mes o `fecha_desde > fecha_hasta`: bloqueado en cliente; re-validado en servidor
  (`400` con detalle) por si llega una request que se salte la validación del cliente.
- Sin resultados: mensaje explícito en la tabla, no un espacio en blanco sin explicación.
- Botones de descarga deshabilitados sin resultados.
- 401 / bloqueo por IP: sin manejo especial — ya lo cubre el interceptor global existente.
- Página de paginación fuera de rango: `items: []`, no error; la tabla muestra el estado vacío.

## Testing

**Backend** (`apps/api/tests/test_reportes_routes.py`):
- Rango válido dentro del mismo mes → `items`/`total`/`page`/`page_size` correctos.
- Rango que cruza de mes → `400`.
- `fecha_desde > fecha_hasta` → `400`.
- Filtro por `estado` acota resultados.
- Paginación: página 2 con offset correcto; página fuera de rango → `items: []`.
- `GET /estados` devuelve los valores distintos reales de la tabla.
- `GET /export` (csv y xlsx): `Content-Type`/`Content-Disposition` correctos, cantidad de filas
  igual al total del filtro (no a una página).
- Sin token → `401`.

**Frontend**:
- `ImpugnacionesService`: `listImpugnaciones`, `getEstados`, `exportImpugnaciones` mandan los
  parámetros correctos (`HttpTestingController`, mismo patrón que `UsersService`).
- `ImpugnacionesComponent`: bloqueo en cliente de rango cruzando de mes; resultados paginados;
  estado vacío; estado de carga; botones de descarga llaman al servicio con los filtros vigentes —
  con la misma rigurosidad de timing async (`Subject` + `whenStable()`, no mocks síncronos) que se
  estableció en los fixes de `c4b6a2c`/`c363ca4` de esta sesión.
- `AppShellComponent`: el submenu de Reportes se expande/colapsa y se auto-expande en la ruta
  `impugnaciones`.
