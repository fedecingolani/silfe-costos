# Identidad de la empresa como dato

## Objetivo

Sacar del código la identidad de la empresa que usa Charoli Gestión (nombre de fantasía, logo,
color de marca y contacto) y guardarla como configuración editable desde la aplicación.

## Problema y por qué

Charoli Gestión se despliega una instancia por empresa. Hoy la identidad de SILFE está fija en
el código: el logo (`public/logo-silfe.png`, que los PDF piden por HTTP al propio sitio con un
timeout de 3 s y una función duplicada), "Silfe" en el menú lateral, el color de marca
(`--color-marca-*` en `globals.css`) y los ejemplos `silfe.*` de la guía de ARCA. Para instalar
otra empresa habría que tocar código.

Los datos fiscales (razón social, CUIT, condición IVA, domicilio, IIBB, inicio de actividades)
ya son dato en `arca_emisor` y se editan en Configuración → ARCA.

## Decisiones

1. **Tabla nueva `empresa`** de fila única (`id boolean primary key default true check (id)`,
   como `arca_emisor` y `parametro_costeo`) para la identidad no fiscal. Los datos fiscales se
   quedan en `arca_emisor`: moverlos toca más de 10 lectores y los tests de ARCA sin ganancia.
2. **Logo en la base**, en `empresa` como base64 (`logo_base64`) con su tipo (`logo_tipo`:
   PNG o JPEG) y un tope de ~500 KB. Mismo criterio que los certificados de ARCA; sin Storage.
   Los PDF leen el logo de la base en lugar de pedirlo por HTTP.
3. **Un solo color de marca** (hex). La escala `marca-50` a `marca-900` se deriva con
   `color-mix`, así los usos actuales de Tailwind siguen funcionando sin cambios.
4. **Pantalla Configuración → Empresa**, con el patrón de `FormularioEmisor` (`useActionState`,
   validación en el servidor, `update ... eq("id", true)` y 0 filas tratado como error).
5. **Sin logo, sin romper**: si no hay logo cargado, los PDF salen sin logo y la app muestra solo
   el nombre. Al desplegar, el logo de SILFE se sube desde la pantalla nueva.

## Alcance

- Migración de `empresa` y su RLS (en migración separada), con tests pgTAP.
- Pantalla y acciones de Configuración → Empresa, con entrada en el menú.
- Logo de los PDF (comprobante, presupuesto, recibo y lista de precios) desde la base; se unifica
  la carga del logo y se borra `public/logo-silfe.png`.
- Menú lateral, encabezado móvil y login con el nombre y el logo de la empresa; color de marca
  aplicado en toda la app.
- Guía de ARCA, fixtures de prueba y documentación con nombres genéricos.

Fuera de alcance: mover los datos fiscales de `arca_emisor`, el pie de la lista
(`parametro_costeo`), el color fijo de los PDF de comprobantes (`MARCA` en `pdf.ts`) y el worker
de Cloudflare.

## Restricciones

- Migraciones nuevas y en orden; nunca se editan las ya aplicadas.
- RLS en migración separada: `anon` sin acceso, `authenticated` con lectura y actualización.
- No escribir el nombre de ninguna empresa en el código.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migración `empresa` + RLS + pgTAP | delegada (writer: SQL, tests) | [x] |
| T2 | Configuración → Empresa: página, acciones con validación, menú, tests | delegada (writer) | [x] |
| T3 | Logo de los PDF desde la base; carga unificada; borrar `logo-silfe.png`; tests | delegada (writer) | [x] |
| T4 | Nombre, logo y color de marca en la app (layout, login, `globals.css`) | delegada (writer) | [x] |
| T5 | Guía de ARCA, fixtures y docs genéricos | delegada (writer) | [x] |

Ruta: cada tarea toca dos o más archivos no triviales, así que se delega a un writer por tarea,
de a uno.

Entrega: pronóstico de ~800 a 1000 líneas, por encima del presupuesto de 400. Cada tarea cierra
con su commit; la estrategia de PR (uno solo o encadenados) se decide antes de abrirlo.

## Criterios de aceptación

- Una instancia nueva arranca con `empresa` vacía y funciona: PDF sin logo, menú con el nombre
  del producto.
- Cargar nombre, logo y color en Configuración → Empresa cambia el menú, el login, los PDF y el
  color de la app sin tocar código.
- No queda "silfe" en `src/` ni en `public/`.
- `npm run typecheck`, `npm run lint`, `npm test` y `supabase test db` en verde.

## Progreso

- Rama `feat/identidad-empresa`, desde `main` (`533b05b`).
- T1: `empresa` con checks (nombre ≤ 80, color `#rrggbb`, email, teléfono, web, logo y tipo
  juntos, logo ≤ 700000 caracteres base64 ≈ 525 KB) y trigger `fn_set_actualizado_en`. RLS:
  `authenticated` solo con `select` y `update` (más estricto que `arca_emisor`: un `delete`
  falla con 42501 en lugar de borrar 0 filas). `empresa_test.sql` 37/37 y `rls_anon_test.sql` 5/5.
  RED observado antes de la migración.
- Fallas previas, ajenas a esta feature: `cobranzas_test.sql` y `comprobantes_test.sql` cortan
  con "El punto de venta 9199/9099 no es electrónico" (fixtures que no contemplan el
  comprobante X). Ya fallaban antes de las migraciones nuevas.
- T2: Configuración → Empresa (`configuracion/empresa`: página, `acciones.ts` con `guardarEmpresa`,
  `FormularioEmpresa`) y entrada «Empresa» en el menú. Validación pura en
  `src/lib/empresa/validacion.ts` (tipo del logo por los bytes iniciales, tope 512 KB, opción
  «Quitar logo»); `validacion.test.ts` 15/15, RED observado (módulo inexistente) antes de escribirlo.
- T3: los PDF (comprobante, presupuesto, recibo y lista) leen el logo de `empresa` con
  `leerLogoEmpresa` (`src/lib/empresa/logo.ts`, nunca falla: null y `console.warn`) y lo incrustan
  como PNG o JPEG según sus bytes con `incrustarLogo` (`pdf-logo.ts`). Se quitaron las dos
  `cargarLogo` por HTTP, `MS_LOGO`, los parámetros `fetch`/`msLogo`/`url` y `public/logo-silfe.png`;
  los tests usan PNG y JPEG de 1x1 (`logo-fixtures.ts`). RED observado en `logo.test.ts`.
  Pendiente: `OpcionesDescarga.url` de listas queda opcional y sin uso porque su llamador
  (`listas-precios/[id]/descarga.ts`) está fuera de la superficie autorizada.
- T4: el layout de la app muestra logo (vía `/empresa/logo?v=<actualizado_en>`, `private,
  immutable`, 404 sin logo) y nombre (fantasía, si no razón social de ARCA, si no sólo
  «Charoli Gestión»); el encabezado móvil, el nombre o el del producto. `leerIdentidadEmpresa`
  (`identidad-servidor.ts`, `cache` de React, nunca falla) y helpers puros en `identidad.ts`
  (RED observado, 6 tests). La escala `marca-*` sale de `--marca-base` con `color-mix(in oklab)`
  en `@theme inline` (así cada utilidad resuelve la base del elemento); el layout la define en
  línea sólo con un hex válido. Se usó oklab en lugar de oklch: mismo resultado sin el tono
  indefinido del blanco y el negro. El login queda sólo con el nombre del producto.
  `npm run build` OK. Sin verificación visual en el navegador.
- T5 (parcial): guía de ARCA con `empresa.key`/`empresa.csr`/`CN=empresa`/alias `empresa`;
  fixtures y tests con «EMPRESA DE EJEMPLO S.A.», `ventas@ejemplo.com.ar`, «EJEMPLO – 30 AÑOS» y
  CN `empresahomo` en `wsaa.test.ts`; las URL `https://silfe.test` se fueron con T3. README
  (tabla `empresa` y «Puesta en marcha de una empresa nueva») y AGENTS.md actualizados.
  Pendiente: `rg -i silfe src` todavía encuentra `src/lib/clientes/validaciones.test.ts`
  (alias de ejemplo) y el titular por defecto `silfeerphomo` de `src/lib/arca/certificados-prueba.ts`,
  que `src/lib/arca/certificado.test.ts` compara; esos dos tests están fuera de la superficie
  autorizada, así que el default quedó como estaba para no romper el test.
- T5 (cierre, inline): `empresahomo` en `certificados-prueba.ts` y su test, alias de ejemplo en
  `validaciones.test.ts`, placeholder y comentario "EJEMPLO – 30 AÑOS", y se quitó la opción
  `url` sin uso de la descarga de listas. `rg -i silfe src public` vacío. typecheck y eslint
  limpios; vitest 59 archivos, 795 tests en verde.
