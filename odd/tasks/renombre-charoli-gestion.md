# Renombre a Charoli Gestión

## Objetivo

Renombrar el sistema de "Silfe Costos" a **Charoli Gestión** (identificador técnico
`charoli-gestion`), sacando el nombre de la empresa del nombre del producto.

## Problema y por qué

El sistema empezó como un costeador para SILFE y hoy cubre ventas, CRM, facturación y
cobranzas. Además lo van a usar otras empresas: el nombre del producto no puede llevar el de una
empresa en particular.

Decisión tomada: **una instancia por empresa** (Supabase y worker propios), con la identidad de
la empresa (razón social, logo, CUIT, colores) parametrizada como dato. No es multi-tenant.

## Alcance

- Nombre del producto en la interfaz (título, login, encabezado) y en los metadatos de los PDF.
- `package.json`, `package-lock.json` y `supabase/config.toml` (`project_id` del stack local).
- Documentación: README, ROADMAP y AGENTS (incluida la corrección del aviso de "repo anidado").
- Encabezado de `supabase/seed.sql`.

Fuera de alcance:

- **Worker de Cloudflare** (`wrangler.jsonc`): cambiar el `name` crea otro worker con otra URL y
  obliga a recargar los secretos. Se migra aparte, de forma controlada.
- **Migraciones ya aplicadas**: son historia, no se editan.
- **Proyecto remoto de Supabase**: sigue llamándose `silfe-costos` en el dashboard.
- **Identidad de la empresa** ("Silfe" en la barra lateral, `logo-silfe.png`): la parametrización
  es una feature propia.
- Repo de GitHub y carpetas locales: los mueve el usuario o se hacen en un paso aparte.

## Restricciones

- No romper el deploy actual: el worker sigue siendo `silfe-costos`.
- Cambiar `project_id` renombra los contenedores locales de Supabase: hay que correr
  `supabase stop` con el nombre viejo antes y volver a cargar el seed con el nuevo.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Renombrar referencias en interfaz, PDF, paquete, config local y docs | inline (mecánico) | [x] |
| T2 | Lint, typecheck y tests | inline | [x] |
| T3 | Commit de la unidad de trabajo | inline | [x] |

Ruta: los cambios son reemplazos de texto ya entendidos, sin diseño pendiente; van inline.

## Criterios de aceptación

- No queda "Silfe Costos" fuera de migraciones aplicadas y `wrangler.jsonc`.
- Lint, typecheck y tests en verde.

## Próximo paso

Parametrizar la identidad de la empresa (feature propia) y migrar el worker de Cloudflare.

## Carpeta local

Aplanada: el repo pasó de `SILFE/silfe-costos/silfecostos` a `SILFE/charoli-gestion` y los
worktrees a `SILFE/charoli-gestion-worktrees` (reparados con `git worktree repair`). El SQL de
Xubio y los sobrantes de la carpeta vieja (`.atl`, `.claude`, `package-lock.json` vacío) quedaron
en `SILFE/_archivo/`. Se borraron `firebase-debug.log` y `.wrangler/`.

## Verificación

- `npm run typecheck`: sin errores.
- `npm test`: 56 archivos, 706 tests en verde.
- `npm run lint`: los únicos errores son de `supabase/.temp/` (archivos generados), que ignora la
  rama `chore/eslint-ignorar-supabase-temp`, todavía sin mergear. Con
  `--ignore-pattern 'supabase/.temp/**'` el lint queda limpio.
- No queda "Silfe Costos" fuera de las migraciones aplicadas.
- Commit: `chore: rename product to Charoli Gestión`, en la rama `chore/renombrar-charoli-gestion`.
