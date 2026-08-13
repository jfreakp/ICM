# Reporte de Infracciones (submenu de Reportes)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-12 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario, pendiente de plan de implementación |

## Contexto

Segundo reporte de la familia bajo el submenu "Reportes" (el primero, Impugnaciones, ya está en
producción). Se pidió construir el reporte sobre `axis.axis_infracciones` — la tabla principal de
infracciones de tránsito migrada por el skill `axis-loja-migracion` — con la misma mecánica de
filtros y descarga que Impugnaciones, pero eligiendo las columnas según un criterio de "cuánto dato
real tienen" en vez de copiar la lista curada a mano de Impugnaciones.

**Tabla de referencia:** `axis.axis_infracciones`, 314,460 filas, 85 columnas — mucho más grande que
`axis_impugnaciones` (99,788 filas, 41 columnas).

**Hallazgos clave del análisis de columnas que ajustaron el criterio original:**

- El pedido inicial decía "más de 10 registros con datos" como umbral de inclusión. Aplicado
  literalmente, 81 de las 85 columnas calificarían — incluyendo columnas casi vacías como
  `geo_referencia_x`/`geo_referencia_y` (12 filas de 314,460, el 0.004%). Se acordó con el usuario
  subir el umbral a **≥80% de filas pobladas**, el mismo criterio de fondo usado en Impugnaciones.
- Igual que pasó con `fecha_generacion` en Impugnaciones, **`fecha_generacion` y
  `hora_generacion` tienen un único valor en las 314,460 filas** (`2026-07-20`, `17:00:52`) — es la
  fecha de exportación del archivo completo, no un dato por fila. Se excluyen del reporte.
- Varias columnas están "100% pobladas" pero son **constantes sin valor informativo**, verificado
  contra los datos reales (no una suposición): `tipo_infraccion` (siempre `'INFRACCIÓN DE
  TRÁNSITO'`), `codigo_infraccion_origen` (siempre ceros), `porcentaje_principal`,
  `porcentaje_convenio`, `cuenta_bancaria_principal`, `cuenta_bancaria_convenio` (los cuatro
  siempre `'0000000000'`). Se excluyen por no aportar información, no por estar vacías.
- Las columnas `*_catalogo_item_id` (ej. `estado_catalogo_item_id`, `provincia_catalogo_item_id`)
  son claves foráneas numéricas internas hacia un catálogo, duplicadas de su columna de texto
  legible correspondiente (`estado`, `provincia`, etc.). Se excluyen todas — se usa siempre la
  columna de texto.
- El mes con más filas de `fecha_registro` es **2017-09, con 35,450 filas** (vs. 6,421 el peor mes
  de Impugnaciones) — casi 6x más grande. Se decidió mantener la misma regla de "mismo mes
  calendario" que Impugnaciones: 35k filas × 41 columnas es grande pero manejable en un export
  puntual del servidor.
- `estado` tiene 8 valores reales y bien distribuidos (`ANULADA`, `DESCARTADA`, `EMITIDA`, `EN
  COACTIVA`, `EN CONVENIO`, `IMPUGNADA`, `PAGADA`, `POR EMITIR`), a diferencia de Impugnaciones
  donde en la práctica solo existía `'A'`. El filtro por estado es más útil acá.

## Alcance

**Incluido:**
- Endpoint de listado paginado de `axis.axis_infracciones` con filtros de fecha (obligatorio,
  `fecha_registro`) y estado (opcional).
- Endpoint de descarga (CSV y Excel) del resultado completo del filtro, sin paginar.
- Endpoint auxiliar que devuelve los valores distintos de `estado` presentes en la tabla.
- Página `Infracciones` en el frontend, accesible como segundo ítem del submenu "Reportes" en el
  sidebar (junto a "Impugnaciones").
- Validación (cliente y servidor) de que el rango de fechas cae dentro de un mismo mes calendario.
- Auditoría de búsqueda y descarga (`reportes.infracciones.search` / `.export`), siguiendo
  exactamente el mismo patrón ya implementado para Impugnaciones y para el resto del sistema de
  auditoría (`docs/superpowers/specs/2026-08-12-auditoria-design.md`).

**Explícitamente fuera de alcance:**
- Cualquier otro reporte futuro (ej. sobre `axis_pagos`, `axis_juicios_coactivos`) — queda para su
  propio spec.
- Filtros adicionales más allá de `estado` y `fecha_registro` — la tabla tiene muchos otros campos
  filtrables (`provincia`, `localidad`, `oficina`, `tipo_deudor`, `origen_registro`, etc.), pero no
  se pidieron y no se agregan sin pedido explícito.
- Restricción por rol de quién puede ver este reporte — igual que Impugnaciones, cualquier usuario
  autenticado puede acceder.
- Cualquier cambio a los datos (esto es un reporte de solo lectura).

## Columnas del reporte

Mismas columnas en pantalla y en la descarga (CSV/Excel). Se muestran las 41 que superan el umbral
de ≥80% de filas pobladas y tienen valores variados (no constantes), agrupadas aquí por claridad —
el orden real en la tabla/export es el de esta lista:

| Columna (DB) | Encabezado en el reporte | % poblado |
|---|---|---|
| `registro` | Registro | 100% |
| `fecha_registro` | Fecha de Registro | 100% |
| `fecha_emision` | Fecha de Emisión | 100% |
| `fecha_aprobacion` | Fecha de Aprobación | 99.47% |
| `fecha_vencimiento` | Fecha de Vencimiento | 100% |
| `estado` | Estado | 100% |
| `codigo_infraccion` | Código de Infracción | 100% |
| `codigo_infraccion_ant` | Código de Infracción Anterior | 99.54% |
| `contravencion` | Contravención | 100% |
| `articulo` | Artículo | 100% |
| `literal` | Literal | 99.95% |
| `descripcion_articulo` | Descripción del Artículo | 100% |
| `periodo_fiscal` | Período Fiscal | 100% |
| `oficina` | Oficina | 100% |
| `origen_registro` | Origen de Registro | 100% |
| `tipo_registro_infraccion` | Tipo de Registro | 100% |
| `tipo_emision` | Tipo de Emisión | 100% |
| `tipo_deudor` | Tipo de Deudor | 100% |
| `codigo_usuario_registra` | Usuario que Registra | 83.21% |
| `observacion` | Observación | 89.69% |
| `provincia` | Provincia | 82.98% |
| `localidad` | Localidad | 100% |
| `lugar_infraccion` | Lugar de Infracción | 83.18% |
| `canal` | Canal | 83.20% |
| `placa` | Placa | 82.15% |
| `tipo_identificacion_infractor` | Tipo de Identificación (Infractor) | 100% |
| `numero_identificacion_infractor` | Número de Identificación (Infractor) | 100% |
| `nombre_infractor` | Nombre del Infractor | 100% |
| `tipo_identificacion_propietario` | Tipo de Identificación (Propietario) | 82.14% |
| `numero_identificacion_propietario` | Número de Identificación (Propietario) | 82.14% |
| `nombre_propietario` | Nombre del Propietario | 82.14% |
| `indicador_bloqueada` | Bloqueada | 100% |
| `indicador_acta_juzgamiento` | Acta de Juzgamiento | 100% |
| `indicador_modificada` | Modificada | 100% |
| `indicador_calcula_recargo` | Calcula Recargo | 99.998% |
| `valor_capital` | Valor Capital | 100% |
| `valor_capital_exonerado` | Valor Capital Exonerado | 100% |
| `valor_recargo` | Valor Recargo | 100% |
| `valor_recargo_exonerado` | Valor Recargo Exonerado | 100% |
| `valor_intereses` | Valor Intereses | 100% |
| `valor_total` | Valor Total | 100% |

**Descartadas por ser constantes sin valor informativo** (100% pobladas pero un único valor en toda
la tabla, verificado contra los datos reales): `tipo_infraccion`, `tipo_infraccion_2`,
`codigo_infraccion_origen`, `porcentaje_principal`, `porcentaje_convenio`,
`cuenta_bancaria_principal`, `cuenta_bancaria_convenio`, `fecha_generacion`, `hora_generacion`.

**Descartadas por ser claves foráneas internas duplicadas** (mismo dato que su columna de texto
correspondiente, en forma de ID numérico): todas las columnas `*_catalogo_item_id`.

**Descartadas por estar mayormente vacías** (<80% poblado): `codigo_usuario_notifica`,
`codigo_empresa_convenio`, `deleted_at`, `fecha_convenio` (8 filas de 314,460), `fecha_notificacion`
(22.96%), `fecha_impugnacion` (5.91%), `fecha_anulacion` (17.99%), `fecha_coactiva` (2.12%),
`fecha_pago` (68.70%), `zona` (28.27%), `tipo_licencia` (23.33%), `codigo_agente_transito`
(28.18%), `dispositivo` (2.95%), `circuito` (1.99%), `distrito` (56.14%), `geo_referencia_x`/`_y`
(0.00%), `tipo_identificacion_agente`/`numero_identificacion_agente`/`nombre_agente` (54.90%).

## Filtros y validación de fechas

- `fecha_registro`: **obligatorio**, rango (`fecha_desde`, `fecha_hasta`). Misma regla que
  Impugnaciones: deben caer en el mismo mes y año calendario, `fecha_desde <= fecha_hasta`,
  validado en cliente y re-validado en servidor (`400` si no cumple).
- `estado`: opcional, dropdown poblado desde `SELECT DISTINCT estado FROM axis.axis_infracciones`
  (hoy: `ANULADA`, `DESCARTADA`, `EMITIDA`, `EN COACTIVA`, `EN CONVENIO`, `IMPUGNADA`, `PAGADA`,
  `POR EMITIR` — se ajusta solo si aparecen valores nuevos).
- El mes más cargado tiene 35,450 filas (2017-09) — el límite de "mismo mes" se mantiene igual que
  en Impugnaciones a pesar de este volumen mayor; no se reduce a una ventana más corta.

## Backend

### Nuevo módulo `apps/api/app/routers/infracciones.py`

Separado de `routers/reportes.py` (que ya contiene Impugnaciones más la instrumentación de
auditoría) para que cada reporte tenga su propio archivo, testeable de forma independiente. Mismo
prefijo de URL bajo `/api/reportes`, protegido con `get_current_user` (cualquier usuario
autenticado, sin restricción de rol) — mismo patrón que `routers/reportes.py`.

- **`GET /api/reportes/infracciones/estados`** → `list[str]`.
- **`GET /api/reportes/infracciones`** — query params `fecha_desde: date`, `fecha_hasta: date`
  (obligatorios), `estado: str | None`, `page: int = 1`. Página fija: 50. Responde
  `{ items: InfraccionItem[], total: int, page: int, page_size: int }`. Orden estable:
  `ORDER BY fecha_registro DESC, id DESC`. Página fuera de rango → `items: []`, no error. Registra
  `reportes.infracciones.search` vía `registrar_evento` (mismo `app/audit.py` ya existente), con
  `details = {fecha_desde, fecha_hasta, estado, page, total}` — idéntico a como lo hace
  `list_impugnaciones`.
- **`GET /api/reportes/infracciones/export`** — mismos filtros (sin `page`) + `formato: "csv" |
  "xlsx"`. Devuelve el archivo completo del filtro (sin paginar, hasta ~35,450 filas en el mes más
  cargado). Encabezados de columna en español legible (tabla de arriba). Registra
  `reportes.infracciones.export` con `details = {fecha_desde, fecha_hasta, estado, formato,
  filas_exportadas}`.

**Definición de tabla**: nueva entrada en `app/axis_tables.py`, `axis_infracciones` como `Table`
declarado manualmente solo con las 41 columnas usadas más `id` para el orden estable (mismo patrón
que `axis_impugnaciones`).

**Consulta**: mismo patrón SQLAlchemy Core que Impugnaciones — `SELECT` con `COLUMN_NAMES`, `total`
de una segunda consulta `COUNT(*)`. `COLUMN_NAMES = list(COLUMN_HEADERS)`, derivado automáticamente
del diccionario de encabezados (lección aplicada del fix final de Impugnaciones — evita que
encabezados y datos de columnas se desalineen si alguien reordena una lista pero no la otra).

**Schemas** (`apps/api/app/schemas.py`): `InfraccionItem` (41 campos + `id`, tipos según
nulabilidad real de cada columna — `str | None` o `datetime | None` para las que están por debajo
del 100%) e `InfraccionListResponse` (`items`, `total`, `page`, `page_size`), mismo patrón que
`ImpugnacionItem`/`ImpugnacionListResponse`.

**Registro en `main.py`**: nuevo `include_router` para el router de infracciones, junto a los
existentes.

## Frontend

- **Sidebar** (`app-shell.component.html`/`.ts`): el submenu "Reportes" gana un segundo sub-ítem
  "Infracciones", debajo de "Impugnaciones". `AppShellRoute` gana el valor `'infracciones'`. El
  submenu se auto-expande y resalta el sub-ítem activo también cuando la ruta es `infracciones`
  (se generaliza la condición que hoy solo chequea `'impugnaciones'`).
- **Nueva carpeta** `apps/web/src/app/features/reportes/infracciones/`
  (`InfraccionesComponent` + template + spec), ruta `/reportes/infracciones`.
- **`InfraccionesComponent`**:
  - Formulario: fecha desde, fecha hasta (`<input type="date">`, obligatorias), estado
    (`<select>` poblado desde `GET /estados`), botón "Filtrar". Misma validación de "mismo mes
    calendario" en cliente que Impugnaciones.
  - **Tabla renderizada dinámicamente**: un arreglo `COLUMNAS: { clave: keyof InfraccionItem;
    encabezado: string }[]` en el componente, con las 41 entradas de la tabla de columnas de
    arriba. El template genera el `<thead>` y cada `<tr>` con `@for (columna of COLUMNAS; ...)`,
    leyendo `item[columna.clave]` — no se escribe cada `<th>`/`<td>` a mano como en
    `ImpugnacionesComponent` (10 columnas). Esto es una diferencia deliberada de patrón frente a
    Impugnaciones, justificada por el volumen de columnas (41 vs. 10): escribir cada celda a mano
    sería un template enorme y repetitivo, y agregar/quitar una columna después pasaría de ser un
    cambio de plantilla a un cambio de una línea en el arreglo.
  - Tabla paginada (50 filas/página, controles anterior/siguiente + indicador de página) — mismo
    patrón que Impugnaciones, con scroll horizontal (`overflow-x-auto`, ya usado) dado el ancho de
    41 columnas.
  - Botones "Descargar CSV" y "Descargar Excel" — mandan los filtros vigentes al endpoint de
    export, deshabilitados sin resultados.
  - Estados: carga, vacío ("No hay infracciones para estos filtros"), error del backend.
- **`InfraccionesService`** (`apps/web/src/app/core/infracciones.service.ts`): `getEstados`,
  `listInfracciones`, `exportInfracciones` — mismo patrón que `ImpugnacionesService`.
- **Modelo** (`apps/web/src/app/core/models/infraccion.model.ts`): `InfraccionItem` (41 campos +
  `id`), `InfraccionListResponse`, `InfraccionFilters` — mismo patrón que `impugnacion.model.ts`.

**Principio obligatorio (heredado, no negociable)**: toda la carga de datos sigue el patrón
`BehaviorSubject` + `AsyncPipe`. Esta app corre zoneless — un `.subscribe(v => this.campo = v)`
sobre un campo plano no dispara re-render y es un defecto, no una variación aceptable.

## Manejo de errores y casos borde

- Rango cruza de mes o `fecha_desde > fecha_hasta`: bloqueado en cliente; re-validado en servidor
  (`400`).
- Sin resultados: mensaje explícito en la tabla.
- Botones de descarga deshabilitados sin resultados.
- 401 / bloqueo por IP: sin manejo especial — cubierto por el interceptor global existente.
- Página fuera de rango: `items: []`, no error.
- Valores nulos en columnas parcialmente pobladas (ej. `placa`, `provincia`, `canal`,
  `nombre_propietario`): se muestran como celda vacía en la tabla y como celda vacía en CSV/Excel
  (mismo comportamiento que columnas nulas ya existente en Impugnaciones).

## Testing

**Backend** (`apps/api/tests/test_infracciones_routes.py`, nuevo — mismo patrón que
`test_reportes_routes.py`, con sus propios helpers locales `_auth_headers`, `_seed_infracciones`,
`_row`, y su propio prefijo de datos de prueba `TEST-INF-` para no chocar con `TEST-` de
Impugnaciones ni con `TEST-AUD-` de la tabla de auditoría):
- Rango válido dentro del mismo mes → `items`/`total`/`page`/`page_size` correctos.
- Rango que cruza de mes → `400`.
- `fecha_desde > fecha_hasta` → `400`.
- Filtro por `estado` acota resultados.
- Paginación: página 2 con offset correcto; página fuera de rango → `items: []`.
- `GET /estados` devuelve los valores reales de la tabla.
- `GET /export` (csv y xlsx): `Content-Type`/`Content-Disposition` correctos, contrato completo de
  41 encabezados verificado contra `COLUMN_HEADERS`, cantidad de filas igual al total del filtro.
- Sin token → `401`.
- Búsqueda y export crean el evento de auditoría correspondiente
  (`reportes.infracciones.search`/`.export`) con los filtros y conteo correctos — mismo patrón de
  test que ya existe para Impugnaciones en `test_audit_routes.py`.

**Frontend**:
- `InfraccionesService`: `listInfracciones`, `getEstados`, `exportInfracciones` mandan los
  parámetros correctos (`HttpTestingController`).
- `InfraccionesComponent`: bloqueo en cliente de rango cruzando de mes; resultados paginados;
  estado vacío; estado de carga; botones de descarga; **contrato de columnas**: un test verifica
  que las 41 columnas del arreglo `COLUMNAS` se renderizan en el `<thead>` en el orden correcto
  (mismo tipo de test que cerró el hallazgo del review final de Impugnaciones sobre
  `COLUMN_NAMES`/`COLUMN_HEADERS` desincronizados) — con la misma rigurosidad de timing async
  (`Subject` + `whenStable()`, no mocks síncronos) ya establecida.
- `AppShellComponent`: el submenu de Reportes se auto-expande y resalta también en la ruta
  `infracciones`.
