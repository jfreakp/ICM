# Fecha Mínima Disponible por Reporte — Design

## Contexto

Los 8 reportes construidos en esta sesión (Impugnaciones, Infracciones, Juicios, Pagos, Títulos de Crédito, Modificación de Infracciones, CRV, Libretines) requieren que el usuario ingrese un rango de fechas antes de ver resultados, pero no hay forma de saber de antemano desde qué fecha existe información real en la base. El usuario pidió mostrar esa fecha mínima en la cabecera de cada reporte, calculada sobre la misma columna que cada reporte usa como filtro de rango.

## Decisiones tomadas con el usuario

1. **Carga automática al abrir la pantalla** — la fecha mínima se pide y se muestra apenas se entra al reporte, antes de que el usuario aplique ningún filtro (no depende del botón "Filtrar").
2. **Un endpoint liviano por reporte** — igual patrón que los endpoints `/estados` ya existentes en Impugnaciones/Infracciones (una consulta puntual, sin paginación ni exportación), no un reporte nuevo ni un endpoint genérico compartido.
3. **Texto de la cabecera:** "Información disponible desde: DD/MM/AAAA", debajo del título de cada reporte. Si la tabla no tiene filas (`fecha_minima` es `null`), no se muestra nada.

## Columna de referencia por reporte

| Reporte | Router | Tabla | Columna |
|---|---|---|---|
| Impugnaciones | `reportes.py` | `axis_impugnaciones` | `fecha_registro` |
| Infracciones | `infracciones.py` | `axis_infracciones` | `fecha_registro` |
| Juicios | `juicios.py` | `axis_juicios` | `fecha_registro` |
| Pagos | `pagos.py` | `axis_pagos` | `fecha_transaccion` |
| Títulos de Crédito | `titulos.py` | `axis_titulos` | `fecha_registro` |
| Modificación de Infracciones | `modificacion_infracciones.py` | `axis_modificacion_infracciones` | `fecha_registro` |
| CRV | `crv.py` | `axis_crv` | `fecha_ingreso` |
| Libretines | `libretines.py` | `axis_libretines` | `fecha_registro` |

Cada endpoint reutiliza la función `_select_column(name)` que ya existe en su propio router (usada hoy para el listado/exportación) para obtener la columna con el mismo casteo a fecha que el resto del reporte ya aplica — así se evita duplicar la lógica de truncado y se garantiza consistencia automática entre el filtro de búsqueda y este nuevo dato.

## Comportamiento del endpoint

- `GET /api/reportes/<reporte>/fecha-minima`, protegido con `require_active_user` (mismo patrón que `/estados`), sin paginación ni exportación.
- Consulta: `SELECT MIN(<columna con el mismo casteo que usa el listado>) FROM <tabla> WHERE deleted_at IS NULL`.
- Respuesta: `{"fecha_minima": "2020-01-05"}` o `{"fecha_minima": null}` si la tabla no tiene filas (o todas están eliminadas).
- Se usa un schema compartido `FechaMinimaResponse` (un solo campo `fecha_minima: date | None`) en `schemas.py`, reutilizado por los 8 routers — a diferencia de los `*Item`/`*ListResponse` de cada reporte (que sí son distintos entre sí), esta respuesta tiene la misma forma exacta en los 8 casos, así que un schema compartido es lo más simple sin romper el patrón de "un router por tabla".
- No se registra evento de auditoría para esta consulta (mismo criterio que `/estados`, que tampoco audita).

## Comportamiento del frontend

- Cada componente de reporte agrega (o extiende, en Impugnaciones/Infracciones que ya tienen `ngOnInit` para cargar estados) un `ngOnInit` que llama al nuevo método del servicio (`getFechaMinima()`) apenas se monta el componente.
- El valor ISO (`YYYY-MM-DD`) se formatea a `DD/MM/AAAA` en el componente antes de exponerlo a la plantilla (sin agregar una librería de fechas, solo un split simple del string).
- Se muestra un texto "Información disponible desde: DD/MM/AAAA" debajo del `<h2>` del reporte. Si `fecha_minima` es `null`, no se muestra nada (no hay mensaje de fallback).
- Si la llamada falla, se ignora silenciosamente (no se reutiliza `errorSubject`, reservado para fallas del listado/búsqueda) — el texto simplemente no aparece.
- Se agrega un `FechaMinimaResponse` compartido en `apps/web/src/app/core/models/fecha-minima.model.ts`, reutilizado por los 8 servicios, reflejando la misma decisión tomada en el backend.

## Arquitectura

Un task por reporte (backend + frontend juntos, ya que el cambio es chico por reporte): agregar el endpoint al router existente, el método al servicio existente, y el `ngOnInit`/plantilla al componente existente. Ningún archivo nuevo aparte del schema/model compartido y sus respectivos tests.

## Testing

Por cada reporte: un test de backend que siembra filas con distintas fechas y verifica que `/fecha-minima` devuelve la más antigua respetando `deleted_at IS NULL`, más un test de tabla vacía que verifica `null`. En el frontend, un test que verifica que el componente llama a `getFechaMinima()` en `ngOnInit` y que el texto formateado aparece en la plantilla.
