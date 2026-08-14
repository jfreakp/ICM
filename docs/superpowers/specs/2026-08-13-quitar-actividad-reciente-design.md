# Quitar "Actividad Reciente" del Dashboard — Design

## Contexto

El Dashboard (`HomeComponent`) muestra una tabla "Actividad Reciente" con datos completamente inventados (nombres de ciudadanos ficticios, montos y fechas hardcodeadas). Ahora que el Dashboard ya muestra los 7 totales reales por tabla (feature anterior), esta tabla mock queda como el único bloque no-real visible — se elimina.

## Alcance

Se elimina por completo el bloque "Actividad Reciente": el array de datos mock, el bloque de template que lo renderiza, y el test que lo cubre. No se reemplaza por nada — no hay una fuente de datos reales equivalente en alcance para esta tarea.

## Cambios

- `apps/web/src/app/features/home/home.component.ts`: se borra el campo `actividadReciente` (el array de 5 objetos mock). El resto del componente (KPIs reales, `currentUser$`, `ngOnInit`) no cambia.
- `apps/web/src/app/features/home/home.component.html`: se borra el `<div>` completo que contiene el encabezado "Actividad Reciente" y su tabla (el bloque `bg-surface-container-lowest ... overflow-hidden` que sigue al grid de tarjetas de KPI). El grid de tarjetas de KPI, arriba, no se toca.
- `apps/web/src/app/features/home/home.component.spec.ts`: se borra el test `it('displays the recent activity table', ...)`. Los demás tests (`'displays the current user full name'`, `'displays real table totals from the dashboard summary'`) no cambian.

## Fuera de alcance

- No se agrega ninguna fuente de datos real para reemplazar "Actividad Reciente".
- No se toca el grid de tarjetas de KPI ni ningún otro bloque del Dashboard.

## Testing

- Frontend: tras borrar el test correspondiente, la suite de `home.component.spec.ts` queda en 2 tests, ambos ya existentes y sin cambios. Se corre la suite completa del frontend para confirmar que no queda ninguna referencia colgante a `actividadReciente`.
