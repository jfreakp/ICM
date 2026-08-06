# Addendum: Sistema de diseño institucional (ICM Loja)

## Control documental

| Campo | Valor |
|---|---|
| Fecha | 2026-08-06 |
| Autor | Sesión de diseño con el usuario (Claude Code) |
| Estado | Aprobado por el usuario |
| Extiende | `2026-08-06-monorepo-login-home-design.md` |

## Contexto

Durante la implementación de las Tareas 16-17 (LoginComponent, HomeComponent), el usuario indicó
que ya existen mockups de diseño aprobados en `desing/` (4 páginas + `DESIGN.md` con tokens de
color/tipografía/espaciado) y pidió aplicar ese sistema visual, reemplazando el estilo genérico
usado hasta ahora.

Mockups disponibles en `desing/`:
- `inicio_de_sesi_n_icm_loja/code.html` — Login.
- `dashboard_principal_icm_loja/code.html` — Dashboard con KPIs y tabla de actividad reciente.
- `reportes_de_multas/code.html` — Generación de reportes con filtros, tabla y paginación.
- `administraci_n_de_usuarios/code.html` — Tabla de usuarios con búsqueda, paginación y acciones.
- `institutional_authority_system/DESIGN.md` — Tokens de diseño (colores, tipografía Inter,
  bordes, espaciado) y lineamientos de componentes.

## Decisión de alcance

El usuario confirmó explícitamente: **construir las 3 páginas ahora** (Dashboard, Reportes de
Multas, Administración de Usuarios), no solo restilizar Login/Home. Esto **amplía** el alcance
"fuera de esta fase" de la spec original (que excluía Admin/Reportería) — la ampliación es:
**solo la capa visual con datos de ejemplo estáticos**, no la lógica de negocio real:

- Las 3 páginas se construyen con **datos de ejemplo hardcodeados** (arrays estáticos en el
  componente), replicando exactamente los datos de muestra de los mockups.
- **No** se conectan a `axis.*` ni a ningún endpoint nuevo del backend — eso sigue siendo una fase
  futura separada (cuando se construya reportería real).
- Los formularios de filtro (Reportes) y búsqueda (Administración) son visuales/funcionales en el
  cliente únicamente (o no funcionales si no hay datos que filtrar) — no hacen llamadas HTTP.
- El botón "Nuevo Usuario" y las acciones "Editar"/"Eliminar" en Administración de Usuarios son
  visuales únicamente (sin handler, o con un placeholder) — no hay backend de gestión de usuarios
  en esta fase.
- Login y Home mantienen exactamente su lógica ya implementada y probada (Tareas 13-17:
  `AuthService`, `authGuard`, `authInterceptor`, formulario reactivo, sesión vía JWT) — solo
  cambia la plantilla HTML/CSS.

## Arquitectura visual

**Tokens de diseño**: se incorporan a `apps/web/tailwind.config.js` como `theme.extend` (colores,
`borderRadius`, `spacing`, `fontFamily`, `fontSize`) copiados literalmente de
`desing/*/code.html`'s `tailwind.config` embebido (son idénticos entre los 4 mockups). Fuente
tipográfica **Inter** e iconos **Material Symbols Outlined** se cargan vía Google Fonts en
`apps/web/src/index.html`, igual que en los mockups.

**Componente compartido `AppShellComponent`** (`apps/web/src/app/shared/app-shell/`): encapsula el
sidebar de navegación (280px, fondo `primary`) + barra superior, reutilizado por Dashboard,
Reportes y Administración de Usuarios (Login no lo usa — es una pantalla previa a la sesión). Es
standalone, recibe `@Input() activeRoute: 'dashboard' | 'reportes' | 'usuarios'` para resaltar el
enlace activo, e inyecta `AuthService`/`Router` directamente para el botón "Cerrar Sesión" (mismo
comportamiento que el `onLogout()` original de `HomeComponent`, ahora centralizado). El contenido
de cada página se proyecta vía `<ng-content>`.

**Páginas**:
- `LoginComponent`: misma lógica (Tarea 16), plantilla reemplazada por la del mockup de login
  (tarjeta centrada, logo, campos con iconos, botón "Iniciar Sesión").
- `HomeComponent` (Dashboard): envuelto en `<app-shell activeRoute="dashboard">`, contenido =
  mensaje de bienvenida con `full_name` (requisito de la spec original, se preserva) + 4 tarjetas
  KPI + tabla "Actividad Reciente", todo con datos de ejemplo estáticos idénticos a los del
  mockup.
- `ReportesComponent` (nueva, `features/reportes/`): envuelto en `<app-shell activeRoute="reportes">`,
  filtros (fecha desde/hasta, estado) + tabla de multas de ejemplo + paginación visual.
- `AdministracionUsuariosComponent` (nueva, `features/administracion-usuarios/`): envuelto en
  `<app-shell activeRoute="usuarios">`, buscador + tabla de usuarios de ejemplo + paginación
  visual.

**Rutas nuevas**: `/reportes` y `/usuarios`, protegidas por `authGuard` (mismo patrón que
`/home`), añadidas a `apps/web/src/app/app.routes.ts`. Los enlaces del sidebar en `AppShellComponent`
usan `routerLink`/`routerLinkActive` en vez de `href="#"`.

## Testing

Los tests ya aprobados de `AuthService`/`authGuard`/`authInterceptor`/`LoginComponent` no cambian
de comportamiento (Login solo cambia su HTML, no su lógica pública). El test de `HomeComponent`
que verificaba el botón de logout directamente en su propio template (Tarea 17) se traslada a
`AppShellComponent` (que ahora es el dueño real de ese botón); `HomeComponent`'s spec se actualiza
para reflejar que ya no maneja el logout directamente. `ReportesComponent` y
`AdministracionUsuariosComponent` reciben specs nuevos verificando que renderizan sus datos de
ejemplo y que `AppShellComponent` resalta el enlace activo correcto.

## Próximos pasos (siguen fuera de esta ampliación)

- Conectar Reportes y Administración de Usuarios a datos reales (`axis.*` / nuevos endpoints).
- CRUD real de usuarios (crear/editar/eliminar) contra `app.users`.
- Roles/permisos.
