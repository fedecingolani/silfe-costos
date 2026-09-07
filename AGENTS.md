# AGENTS.md — Silfe Costos

Guía de contexto para agentes de IA que trabajen en este repo. Leé esto antes de tocar código.

## Qué es este proyecto

Sistema interno de costeo de productos para una empresa que fabrica elementos de cosecha de fruta (lonas, correas, mallas, etc.). Calcula el costo de un producto a partir de tres entradas: materias primas (con precio por proveedor y conversión de unidades), estructura del producto (subgrupos/componentes, máximo 2 niveles) y mano de obra (procesos por producto, tarifados por tiempo o por costo fijo).

Toda la lógica de cálculo vive en **vistas de Postgres** (no en el código de la app): un cambio de precio o de tiempo de proceso se propaga solo. Ver [README.md](README.md) para las fórmulas completas y el detalle de reglas de negocio (merma por material vs. merma de uso, factor de conversión propio de cada materia prima, tope de 2 niveles de estructura, etc.) — no las dupliques acá, son la fuente de verdad y pueden cambiar.

## Aviso: repo anidado

Este directorio (`silfecostos/`) es su **propio repo git**, anidado dentro de un repo padre en `/Users/federico/Proyectos/SILFE/silfe-costos` que hoy no tiene código propio (solo `.atl/` y artefactos sueltos). Todo el trabajo real pasa acá adentro. Si alguna vez ves comandos `git` que corren desde el padre, confirmá el `cwd` antes de interpretarlos.

## Stack

- **Next.js 15** (App Router, Server Actions) + React 19 + TypeScript (`strict: true`)
- **Tailwind CSS 4**
- **Supabase** (Postgres 17 + Auth) — sin signup abierto, usuarios se crean a mano desde el dashboard
- Deploy a **Cloudflare Workers** vía `@opennextjs/cloudflare` (no Vercel)

## Estructura de `src/`

Patrón de carpetas por feature, sin capas hexagonales ni `hooks/`/`types/` separados:

```
src/
├── middleware.ts          # guard de auth (Supabase SSR), redirige a /login
├── app/
│   ├── login/             # única ruta pública
│   └── (app)/              # todo lo demás, requiere sesión
│       ├── clientes/
│       ├── configuracion/
│       ├── mano-obra/
│       ├── materias-primas/
│       ├── procesos/
│       ├── productos/
│       ├── proveedores/
│       └── unidades/
├── components/             # Modal, ModalError, nav, ui compartidos
└── lib/
    ├── tipos.ts            # tipos TS compartidos (centralizado, no hay carpeta types/)
    └── supabase/           # client.ts (browser) y server.ts (SSR/cookies)
```

Convención por feature: `page.tsx` + `acciones.ts` (Server Actions) + componentes/formularios propios + `[id]/` para el detalle. Seguí este patrón al agregar una feature nueva, no inventes una capa distinta.

Alias de import: `@/*` → `./src/*`.

## Supabase

- Migraciones en `supabase/migrations/`, todas fechadas y numeradas secuencialmente. Antes de escribir una migración nueva, mirá las últimas dos para el estilo (RLS siempre en migración separada del schema, ej. `..._esquema.sql` + `..._rls.sql`).
- RLS habilitado en todas las tablas: `anon` sin acceso, `authenticated` con acceso completo (app interna de uso de la empresa). Si se pide restringir por rol, el lugar natural es una migración de RLS nueva, no tocar las existentes.
- `supabase/seed.sql` es idempotente (`on conflict do nothing`) — se puede correr las veces que haga falta.
- Proyecto Supabase remoto ya existe y está linkeado: `silfe-costos`, región `sa-east-1`, ref `utqryndbycglekqifnfs`. Para aplicar migraciones: `supabase link --project-ref <ref>` (si hace falta) + `supabase db push`.
- Ojo: el historial de migraciones remoto puede no coincidir 1:1 con lo que hay en local si se aplicaron cambios manuales antes — verificar con `supabase migration list` antes de asumir que un `db push` es limpio.

## Comandos

```
npm run dev          # next dev
npm run build        # next build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run preview      # build + preview local sobre el runtime de Cloudflare
npm run deploy       # build + deploy a Cloudflare Workers
```

## Variables de entorno

Solo dos, en `.env.local` (ver `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

En `wrangler.jsonc`, `NEXT_PUBLIC_SUPABASE_URL` está además hardcodeada en `vars` porque el Worker de Cloudflare no lee `.env` al deployar — si cambia la URL del proyecto Supabase, hay que actualizarla ahí también.

## Estado del proyecto (a la fecha de este archivo)

Recién arrancado: esquema de costeo base, hardening de triggers, deploy a Cloudflare, y el módulo de clientes (zonas + contactos) agregado más recientemente. Sin tests automatizados todavía. Antes de asumir que algo "ya existe", confirmá contra el código — este proyecto cambia rápido.
