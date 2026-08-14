# Truncar Fechas a Solo-Fecha en los Reportes — Design

## Contexto

Varias columnas de fecha en los 4 reportes son, en la base de datos real, `timestamp` (con hora) en vez de `date`. Hoy se muestran/exportan con su hora completa (ej. `2031-06-05T09:00:00`), lo que dificulta filtrar por fecha en Excel. El usuario necesita que esas columnas se vean como solo-fecha (`2031-06-05`), tanto en pantalla como en el archivo descargado — igual que el `TRUNC(fecha)` de Oracle.

## Mecanismo

Se trunca a nivel de consulta SQL: las columnas afectadas se seleccionan con `CAST(columna AS DATE)` (usando `sqlalchemy.cast(columna, sqlalchemy.Date)`) en vez de la columna cruda, tanto en el endpoint de listado como en el de export de cada reporte. Confirmado contra la base real: esto devuelve un objeto Python `date` puro (sin hora), con la misma clave de columna (usando `.label(nombre)`).

Con el valor ya truncado en el origen:
- El schema Pydantic de cada reporte cambia el tipo de esas columnas de `datetime | None` a `date | None` — Pydantic ya no recibe una hora que truncar, así que no hay error de validación.
- La respuesta JSON del listado sale como fecha pura (`"2031-06-05"`), y el frontend la muestra tal cual sin ningún cambio de código (solo interpola el string).
- La función de export (`_export_value`) no necesita cambios — ya maneja objetos `date` correctamente vía `.isoformat()`.

**No se toca el `ORDER BY`** de ningún reporte — sigue ordenando por la columna original con hora completa, preservando el orden actual exacto entre filas del mismo día. Solo cambia qué valor se selecciona/muestra, no cómo se ordena.

**No se toca el filtro de rango de fechas** (`_date_range_conditions`) — ya usa su propio `cast(..., Date).between(...)` para filtrar, independiente de esta selección de columnas para mostrar.

## Columnas afectadas por reporte

Solo las columnas que son genuinamente `timestamp` en la base (no las que ya son `date`) **y que pueden aparecer con valor en la salida real del reporte**:

| Reporte | Columnas a truncar |
|---|---|
| Impugnaciones | `fecha_registro`, `fecha_acta`, `deleted_at` |
| Infracciones | `fecha_registro`, `fecha_emision`, `fecha_aprobacion`, `fecha_vencimiento`, `deleted_at` |
| Juicios | ninguna |
| Pagos | `fecha_operacion`, `fecha_transaccion` |

**`deleted_at` se excluye en Juicios y Pagos**: ambos reportes ya filtran `WHERE deleted_at IS NULL`, así que esa columna nunca puede tener valor en ninguna fila visible — truncarla sería código inobservable e imposible de testear. En Juicios, `deleted_at` era la única columna candidata (sus demás fechas ya son `date` puro en la base), así que ese reporte no necesita ningún cambio. En Pagos, las otras dos columnas (`fecha_operacion`, `fecha_transaccion`) sí son visibles y se truncan normalmente. Impugnaciones/Infracciones no filtran borrados, así que ahí `deleted_at` sí puede aparecer con valor y sí se trunca.

**No se toca `hora_generacion`** (Juicios, Pagos) — es un campo de hora del día (tipo `time`), no una fecha con hora sobrante; truncar eso no tendría sentido.

## Regla para reportes futuros

De ahora en adelante, cualquier columna `timestamp` de un reporte nuevo que represente conceptualmente una fecha (no una hora del día) se selecciona truncada a `DATE` desde el diseño inicial, con su schema Pydantic tipado como `date`, no `datetime`.

## Cambios por archivo (uno por reporte)

1. **Backend, router** (`reportes.py`, `infracciones.py`, `juicios.py`, `pagos.py`): agregar un conjunto `DATE_ONLY_COLUMNS` con los nombres de columna a truncar, y una función auxiliar que construye cada columna del `SELECT` — devuelve `cast(tabla.c[nombre], Date).label(nombre)` si el nombre está en `DATE_ONLY_COLUMNS`, si no, la columna cruda tal cual. Se usa esta función en la construcción de `columns` de **ambos** endpoints (listado y export). `juicios.py` necesita agregar `Date, cast` a su import de `sqlalchemy` (hoy no los usa); los otros tres routers ya los importan.
2. **Backend, schema Pydantic** (`schemas.py`): cambiar el tipo de las columnas afectadas de `datetime | None` a `date | None` en `ImpugnacionItem`, `InfraccionItem`, `JuicioItem`, `PagoItem`.
3. **Frontend:** sin cambios — los componentes ya solo interpolan el string que llega de la API.

## Testing

Para cada reporte, un test nuevo que siembra una fila con una fecha/hora real (ej. `14:35:00`, no medianoche) en al menos una de las columnas truncadas, y verifica: (a) el endpoint de listado devuelve esa columna como string de fecha pura (`"YYYY-MM-DD"`, sin `T` ni hora), y (b) el CSV exportado tiene el mismo valor de fecha pura en esa columna. No se agregan tests de frontend — no hay comportamiento nuevo ahí.
