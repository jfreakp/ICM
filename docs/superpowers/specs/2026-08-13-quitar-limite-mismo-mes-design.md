# Quitar Límite de Mismo Mes Calendario en Reportes — Design

## Contexto

Los reportes de Impugnaciones e Infracciones validan hoy, tanto en el backend como en el frontend, que `fecha_desde` y `fecha_hasta` caigan dentro del mismo mes calendario (ej. rechazan 15-jun a 5-jul con `400`). El usuario quiere quitar esta restricción por completo para poder consultar/exportar rangos de fechas más amplios.

## Alcance

- Aplica a **ambos** reportes: Impugnaciones e Infracciones.
- Se elimina el chequeo de mismo mes calendario **sin reemplazo** (no se pone un tope más amplio como 6 meses o 1 año).
- Se mantiene la única otra validación existente en ambos reportes: `fecha_desde` no puede ser posterior a `fecha_hasta` (sigue devolviendo `400`).

## Riesgo aceptado (explícito, decisión del usuario)

Sin el límite de un mes, un usuario puede pedir rangos de varios años en una sola consulta o exportación. Una revisión anterior de este mismo código ya midió que un solo mes de Infracciones (~35,450 filas) tarda ~10s y usa ~850MB de RAM al exportar a Excel — un rango de años podría ser sustancialmente peor en tiempo y memoria del servidor. El usuario confirmó que acepta este riesgo por ahora (uso interno controlado); no se agrega ninguna mitigación (paginación forzada, límite de filas, límite de rango) como parte de este cambio.

## Backend

En `apps/api/app/routers/reportes.py` y `apps/api/app/routers/infracciones.py`, la función `_validate_date_range` pasa de:

```python
def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
    if (fecha_desde.year, fecha_desde.month) != (fecha_hasta.year, fecha_hasta.month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El rango de fechas debe estar dentro del mismo mes calendario",
        )
```

a:

```python
def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
```

(idéntico cambio en ambos archivos; la función es una copia literal en cada router, no está compartida).

Se eliminan los tests que verifican el rechazo por cruce de mes:
- `test_list_rejects_range_crossing_month` en `apps/api/tests/test_reportes_routes.py`
- `test_list_rejects_range_crossing_month` en `apps/api/tests/test_infracciones_routes.py`

El test que verifica el rechazo por orden (`fecha_desde > fecha_hasta`) se mantiene sin cambios en ambos archivos.

## Frontend

En `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.ts` e `infracciones.component.ts`, el método `rangoValido` pasa de:

```ts
private rangoValido(fechaDesde: string, fechaHasta: string): boolean {
  const desde = new Date(fechaDesde);
  const hasta = new Date(fechaHasta);
  if (desde.getTime() > hasta.getTime()) {
    this.rangeErrorSubject.next(ORDER_ERROR_MESSAGE);
    return false;
  }
  if (desde.getUTCFullYear() !== hasta.getUTCFullYear() || desde.getUTCMonth() !== hasta.getUTCMonth()) {
    this.rangeErrorSubject.next(RANGE_ERROR_MESSAGE);
    return false;
  }
  this.rangeErrorSubject.next(null);
  return true;
}
```

a:

```ts
private rangoValido(fechaDesde: string, fechaHasta: string): boolean {
  const desde = new Date(fechaDesde);
  const hasta = new Date(fechaHasta);
  if (desde.getTime() > hasta.getTime()) {
    this.rangeErrorSubject.next(ORDER_ERROR_MESSAGE);
    return false;
  }
  this.rangeErrorSubject.next(null);
  return true;
}
```

La constante `RANGE_ERROR_MESSAGE` queda sin uso tras este cambio y se elimina de ambos archivos (`ORDER_ERROR_MESSAGE` se mantiene).

Se eliminan/ajustan las aserciones equivalentes en los specs:
- `apps/web/src/app/features/reportes/impugnaciones/impugnaciones.component.spec.ts` (línea ~95, mensaje "El rango de fechas debe estar dentro del mismo mes calendario.")
- `apps/web/src/app/features/reportes/infracciones/infracciones.component.spec.ts` (línea ~108, mismo mensaje)

Cualquier test que dependa de ese comportamiento (ej. que verifica que un rango cross-month muestra el mensaje y bloquea el submit) se reescribe para reflejar el nuevo comportamiento: un rango cross-month ahora es válido y no muestra error (salvo que además tenga `fecha_desde > fecha_hasta`, en cuyo caso sigue mostrando `ORDER_ERROR_MESSAGE`).

## Fuera de alcance

- No se agrega ningún límite alternativo (6 meses, 1 año, límite de filas, paginación forzada para exportación).
- No se toca la lógica de paginación existente de la vista en pantalla (ya pagina de a 50 en la tabla); solo cambia qué rango de fechas se acepta como válido.
- No se toca el resto de la lógica de exportación CSV/XLSX (formato, columnas, streaming) — solo deja de rechazar rangos multi-mes antes de llegar a esa lógica.

## Testing

- Backend: verificar que un rango que cruza de mes (ej. `2031-06-15` a `2031-07-05`) ahora devuelve `200` en ambos reportes, y que `fecha_desde > fecha_hasta` sigue devolviendo `400`.
- Frontend: verificar que seleccionar fechas en meses distintos ya no muestra el mensaje de error ni bloquea el botón de búsqueda/exportación, y que el orden invertido sigue mostrando `ORDER_ERROR_MESSAGE` y bloqueando.
