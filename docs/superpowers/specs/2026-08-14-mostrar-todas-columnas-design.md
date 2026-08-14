# Mostrar Todas las Columnas Reales en los Reportes — Design

## Contexto

Los 4 reportes existentes (Impugnaciones, Infracciones, Juicios, Pagos) excluyen hoy algunas columnas de sus tablas reales al mostrar/exportar datos: campos internos (`deleted_at`) y columnas de catálogo redundantes con su equivalente en texto (`*_catalogo_item_id`). El usuario necesita que **no se oculte ninguna columna**, incluso si sale vacía/nula — quien consume estos reportes valida toda la información real de la tabla.

## Alcance

Se agrega, al final de la lista de columnas existente de cada reporte (sin reordenar las columnas actuales, para no correr de lugar ningún export ya generado), lo que hoy falta:

| Reporte | Columnas a agregar | Tipo | Etiqueta |
|---|---|---|---|
| Impugnaciones | `deleted_at` | `datetime \| None` | "Fecha de Eliminación" |
| Infracciones | `deleted_at` | `datetime \| None` | "Fecha de Eliminación" |
| Juicios | `deleted_at` | `datetime \| None` | "Fecha de Eliminación" |
| Juicios | `tipo_identificacion_catalogo_item_id` | `int \| None` | "ID de Catálogo (Tipo de Identificación)" |
| Pagos | `deleted_at` | `datetime \| None` | "Fecha de Eliminación" |
| Pagos | `tipo_documento_catalogo_item_id` | `int \| None` | "ID de Catálogo (Tipo de Documento)" |
| Pagos | `tipo_recaudador_catalogo_item_id` | `int \| None` | "ID de Catálogo (Tipo de Recaudador)" |
| Pagos | `tipo_servicio_catalogo_item_id` | `int \| None` | "ID de Catálogo (Tipo de Servicio)" |

Con esto, cada reporte muestra/exporta el 100% de las columnas reales de su tabla de origen.

## Fuera de alcance (confirmado explícitamente)

- **No se toca el filtro de borrados** de Impugnaciones/Infracciones — siguen sin excluir `deleted_at IS NOT NULL` de sus queries (comportamiento actual, ya señalado en una revisión anterior como una inconsistencia conocida pero no corregida). Solo se agrega la columna a la vista, no se cambia qué filas aparecen.
- Juicios y Pagos mantienen su filtro existente (`deleted_at IS NULL`) sin cambios — solo pasan a mostrar la columna `deleted_at` (que, dado ese filtro, siempre va a salir vacía en esos dos reportes específicamente — comportamiento esperado y aceptado).
- No se hace ningún join con `axis.catalogo_items` para traducir los `*_catalogo_item_id` a texto — se muestran como el ID numérico crudo, tal como están en la tabla.

## Regla para reportes futuros

De ahora en adelante, todo reporte nuevo sobre una tabla de `axis` incluye el 100% de sus columnas reales desde el diseño inicial, sin exclusiones — no se vuelve a preguntar esto en el futuro.

## Cambios por archivo

Para cada uno de los 4 reportes, el patrón es idéntico:

1. **Backend, `COLUMN_HEADERS`** (en `reportes.py`, `infracciones.py`, `juicios.py`, `pagos.py` respectivamente): agregar la(s) entrada(s) nueva(s) al final del diccionario.
2. **Backend, schema Pydantic** (`ImpugnacionItem`, `InfraccionItem`, `JuicioItem`, `PagoItem` en `schemas.py`): agregar el campo nuevo con su tipo.
3. **Frontend, `COLUMNAS`** (en el `.component.ts` de cada reporte): agregar la(s) entrada(s) nueva(s) al final del array.
4. **Frontend, modelo TS** (`impugnacion.model.ts`, `infraccion.model.ts`, `juicio.model.ts`, `pago.model.ts`): agregar el campo nuevo.
5. **Tests existentes que verifican la cantidad exacta de columnas** (backend: `EXPECTED_HEADERS`, aserciones de `len(...)`; frontend: aserciones de `headerTexts.length`/`cellTexts.length`) se actualizan al nuevo conteo.

Nada de la lógica de filtrado, paginación, orden de resultados, o auditoría cambia — es exclusivamente una ampliación de qué columnas se seleccionan y se muestran.

## Testing

Para cada reporte: actualizar el test de export (headers esperados, conteo de columnas) y el test de render frontend (conteo de columnas, valor de la nueva celda) para reflejar las columnas agregadas. No se agregan tests nuevos de comportamiento (no hay comportamiento nuevo, solo más columnas visibles).
