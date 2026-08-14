# Completar Columnas Reales de Impugnaciones e Infracciones — Design

## Contexto

Al verificar contra la base de datos real, se encontró que estos dos reportes (los primeros construidos, antes de que verificar la tabla real fuera práctica estándar en este proyecto) muestran solo una fracción de sus columnas reales:

- `axis_impugnaciones`: 43 columnas reales (incluyendo `id`), el reporte muestra 12. Faltan 31.
- `axis_infracciones`: 85 columnas reales (incluyendo `id`), el reporte muestra 43. Faltan 42.

(Conteo verificado programáticamente contra `information_schema` — incluye dos columnas que ni siquiera el reporte original modelaba: `hora_generacion` y `fecha_generacion`, presentes en ambas tablas.)

El usuario compartió el documento oficial de descripción de campos del sistema origen (AXIS Cloud/Yoveri, correo "Descripción de campos de archivos de respaldo"), que da la etiqueta de negocio exacta para cada campo. Se usan esas etiquetas literalmente en vez de traducciones propias.

## Hallazgo aparte, aceptado sin acción por ahora

El documento describe un campo `estado` para Juicios Coactivos ("Estado del Juicio Coactivo"), pero la tabla real `axis_juicios` en esta base **no tiene esa columna** — confirmado contra `information_schema`. No es una columna oculta por el reporte, es un dato que nunca se cargó desde el sistema origen a esta base. No se puede corregir desde el código del reporte; el usuario indicó mostrar lo que efectivamente existe en la base y seguir. Pagos no tiene huecos de este tipo — todos sus campos documentados existen como columnas reales.

## Columnas nuevas — Impugnaciones (31, agregadas al final de la lista actual)

| Columna | Etiqueta (según documento oficial) | Truncar a fecha |
|---|---|---|
| `hora_generacion` | Hora de Generación del Registro | (ya es `time`, sin cambios) |
| `fecha_generacion` | Fecha de Generación del Registro | (ya es `date`, sin cambios) |
| `numero_credito` | Número de Crédito | |
| `numero_tramite` | Número de Trámite | |
| `codigo_infraccion_generada_axis` | Código de la Infracción Generada en AXIS Cloud | |
| `juzgado` | Juzgado | |
| `codigo_provincia` | Código de la Provincia | |
| `codigo_localidad` | Código de la Localidad | |
| `numero_proceso` | Número del Proceso | |
| `monto_modificado_sentencia` | Monto Modificado por la Sentencia | |
| `puntos_original` | Puntos Original | |
| `puntos_modificados_sentencia` | Puntos Modificados por la Sentencia | |
| `literal_original` | Literal Original | |
| `articulo_modificado_sentencia` | Artículo Modificado por la Sentencia | |
| `literal_modificado_sentencia` | Literal Modificado por la Sentencia | |
| `fecha_vencimiento_original` | Fecha de Vencimiento Original | sí |
| `fecha_vencimiento_modificado_sentencia` | Fecha de Vencimiento Modificado por la Sentencia | sí |
| `sancion_original` | Sanción Original | |
| `sancion_modificada_sentencia` | Sanción Modificada por la Sentencia | |
| `codigo_usuario` | Código del Usuario | |
| `codigo_usuario_aprueba` | Código del Usuario que Aprueba | |
| `numero_acta_juzgamiento` | Número de Acta de Juzgamiento | |
| `fecha_aprobacion` | Fecha de Aprobación | sí |
| `fecha_anulacion` | Fecha de Anulación | sí |
| `codigo_usuario_anula` | Código de Usuario que Anula | |
| `observacion_anulacion` | Observación de Anulación | |
| `articulo_original_catalogo_item_id` | ID de Catálogo (Artículo Original) | |
| `articulo_modificado_sentencia_catalogo_item_id` | ID de Catálogo (Artículo Modificado por la Sentencia) | |
| `codigo_localidad_catalogo_item_id` | ID de Catálogo (Localidad) | |
| `codigo_provincia_catalogo_item_id` | ID de Catálogo (Provincia) | |
| `tipo_acta_catalogo_item_id` | ID de Catálogo (Tipo de Acta) | |

(`deleted_at` ya se agregó en el trabajo anterior — no se repite acá.)

## Columnas nuevas — Infracciones (42, agregadas al final de la lista actual)

| Columna | Etiqueta (según documento oficial) | Truncar a fecha |
|---|---|---|
| `hora_generacion` | Hora de Generación del Registro | (ya es `time`, sin cambios) |
| `fecha_generacion` | Fecha de Generación del Registro | (ya es `date`, sin cambios) |
| `tipo_infraccion` | Tipo de Infracción | |
| `codigo_usuario_aprueba` | Código del Usuario que Aprueba | |
| `codigo_usuario_notifica` | Código del Usuario que Notifica | |
| `tipo_licencia` | Tipo de Licencia | |
| `zona` | Zona | |
| `distrito` | Distrito | |
| `circuito` | Circuito | |
| `dispositivo` | Dispositivo | |
| `geo_referencia_x` | Geo-referencia-X | |
| `geo_referencia_y` | Geo-referencia-Y | |
| `tipo_identificacion_agente` | Tipo de Identificación del Agente | |
| `numero_identificacion_agente` | Número de Identificación del Agente | |
| `nombre_agente` | Nombre del Agente | |
| `codigo_agente_transito` | Código del Agente de Tránsito | |
| `tipo_infraccion_2` | Tipo de Infracción (2) | |
| `codigo_infraccion_origen` | Código de la Infracción Origen | |
| `codigo_empresa_convenio` | Código de la Empresa del Convenio | |
| `porcentaje_principal` | Porcentaje Principal | |
| `porcentaje_convenio` | Porcentaje Convenio | |
| `cuenta_bancaria_principal` | Cuenta Bancaria Principal | |
| `cuenta_bancaria_convenio` | Cuenta Bancaria Convenio | |
| `fecha_notificacion` | Fecha de Notificación | sí |
| `fecha_pago` | Fecha de Pago | sí |
| `fecha_impugnacion` | Fecha de Impugnación | sí |
| `fecha_convenio` | Fecha de Convenio | sí |
| `fecha_anulacion` | Fecha de Anulación | sí |
| `fecha_coactiva` | Fecha de Coactiva | sí |
| `canal_catalogo_item_id` | ID de Catálogo (Canal) | |
| `estado_catalogo_item_id` | ID de Catálogo (Estado) | |
| `localidad_catalogo_item_id` | ID de Catálogo (Localidad) | |
| `origen_registro_catalogo_item_id` | ID de Catálogo (Origen de Registro) | |
| `provincia_catalogo_item_id` | ID de Catálogo (Provincia) | |
| `tipo_deudor_catalogo_item_id` | ID de Catálogo (Tipo de Deudor) | |
| `tipo_emision_catalogo_item_id` | ID de Catálogo (Tipo de Emisión) | |
| `tipo_identificacion_agente_catalogo_item_id` | ID de Catálogo (Tipo de Identificación del Agente) | |
| `tipo_identificacion_infractor_catalogo_item_id` | ID de Catálogo (Tipo de Identificación del Infractor) | |
| `tipo_identificacion_propietario_catalogo_item_id` | ID de Catálogo (Tipo de Identificación del Propietario) | |
| `tipo_licencia_catalogo_item_id` | ID de Catálogo (Tipo de Licencia) | |
| `tipo_registro_infraccion_catalogo_item_id` | ID de Catálogo (Tipo de Registro de Infracción) | |
| `zona_catalogo_item_id` | ID de Catálogo (Zona) | |

(`deleted_at` ya se agregó en el trabajo anterior — no se repite acá.)

Todas las columnas marcadas "sí" en truncar a fecha son `timestamp` en la base real — se seleccionan con `cast(columna, Date)` y su schema Pydantic usa `date`, siguiendo el mismo patrón ya aplicado a las demás columnas de fecha de estos dos reportes.

## Nuevas relaciones a considerar en los tests

- **Infracciones**: `numero_identificacion_agente` tiene FK a `axis.personas` (no modelada hasta ahora). Los tests que inserten filas de Infracciones deben sembrar también una persona para el agente, igual que ya hacen para infractor/propietario.
- **Impugnaciones**: las 5 columnas `*_catalogo_item_id` nuevas tienen FK a `axis.catalogo_items`, pero son nullable — no requieren sembrar nada (igual que Pagos).
- Ninguna de las dos tablas tiene columnas `NOT NULL` sin default aparte de `id` (confirmado contra `information_schema`), así que los tests existentes no se rompen por columnas nuevas sin valor.

## Fuera de alcance

- No se agrega la columna `estado` a Juicios — no existe en la base real, es un problema de carga de datos ajeno a este código.
- No se hace join con `axis.catalogo_items` para traducir los `*_catalogo_item_id` a texto — se muestran como ID numérico, igual que en Juicios/Pagos.
- No se tocan las columnas ya existentes de ninguno de los dos reportes — solo se agregan las 71 nuevas al final.

## Testing

Se actualizan los tests de conteo de columnas/headers a los nuevos totales (43 en Impugnaciones incluyendo `id`, 85 en Infracciones incluyendo `id`). Se agrega el sembrado de persona para `numero_identificacion_agente` en los tests de Infracciones que la necesiten. Se reutilizan los mismos tests de truncado de fecha ya existentes, extendidos para cubrir las columnas de fecha nuevas.
