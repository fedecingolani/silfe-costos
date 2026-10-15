# Configuración de ARCA (base para facturación electrónica)

## Objetivo

Cargar en **Configuración → ARCA** los datos del emisor y las credenciales de ARCA (certificado
y clave privada) para homologación y producción, y poder **probar la conexión** con WSAA y WSFE
desde la app. Es la base para emitir facturas electrónicas más adelante.

## Problema y por qué

Para facturar hay que autenticarse en WSAA firmando un pedido con el certificado y la clave
privada del emisor, y usar el ticket que devuelve (12 h) contra WSFEv1. Hoy la app no maneja
ningún secreto: todo corre con la anon key y cualquier usuario logueado lee todas las tablas.
La clave privada no puede quedar legible en la base.

Un spike (2026-10-14/15) confirmó que desde Cloudflare Workers (local y edge, colo EZE):
- se conecta por TLS a homologación y producción (incluido `servicios1.afip.gov.ar`, que usa DH
  de 1024 bits);
- `node-forge` firma el CMS que WSAA acepta (login real OK en homologación con el certificado
  `silfeerphomo`);
- WSAA rechaza un login nuevo mientras haya un ticket vigente (`coe.alreadyAuthenticated`).

## Decisiones

- **Pantalla:** `/configuracion/arca`, ítem "ARCA" en el menú bajo Configuración. Se corrige el
  resaltado del menú para que "Parámetros" no quede activo en esa ruta.
- **Emisor** (`arca_emisor`, una sola fila como `parametro_costeo`): CUIT (validada con dígito
  verificador), razón social, condición frente al IVA, punto de venta y ambiente activo
  (`homologacion` | `produccion`).
- **Credenciales** (`arca_credencial`, una fila por ambiente): certificado PEM, titular y
  vencimiento del certificado, clave privada **cifrada**, ticket de acceso **cifrado** con su
  vencimiento, y un bloqueo corto para que dos pedidos simultáneos no pidan ticket a la vez.
- **Cifrado:** AES-256-GCM (WebCrypto) con la clave `ARCA_CLAVE_CIFRADO`, que vive solo como
  secreto del Worker (`wrangler secret put`) y en `.dev.vars` local. La base guarda solo el texto
  cifrado. La clave privada nunca vuelve al navegador: la pantalla muestra "clave cargada",
  titular y vencimiento.
- **Validaciones al subir:** el certificado parsea, la clave corresponde al certificado, la CUIT
  del certificado (`serialNumber`) coincide con la del emisor, y el certificado no está vencido.
- **Probar conexión:** FEDummy, login WSAA (reutilizando el ticket si está vigente) y
  `FECompUltimoAutorizado` del punto de venta configurado.
- **Descartado:** Supabase Vault (sin roles, cualquier usuario podría llamar la función de
  descifrado) y la clave solo como secreto del Worker (cambiar el certificado exigiría la
  terminal). Migrar a un VPS compartido también se descartó: expone la clave a los otros sistemas.
- **Fuera de alcance:** emitir comprobantes (CAE), validar CUIT de clientes, PDF con QR, roles.
- **Riesgo abierto:** firmar en JS puro usa ~23 ms de CPU; el plan gratuito de Workers permite
  10 ms. Se mitiga reutilizando el ticket (una firma cada 12 h). Falta confirmar el plan.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migraciones `arca_emisor`, `arca_credencial` y RLS (tests pgTAP en rojo primero) | delegada (writer) | [x] |
| T2 | `src/lib/arca/`: CUIT, cifrado, WSAA (TRA, firma CMS, parseo), WSFE (SOAP) y certificado, con Vitest | delegada (writer) | [x] |
| T3 | Pantalla y acciones: datos del emisor, subir credenciales, probar conexión, ticket reutilizado con bloqueo | delegada (writer) | [x] |
| T4 | Menú, `.dev.vars.example`, AGENTS.md/README (secreto `ARCA_CLAVE_CIFRADO`) | delegada (writer) | [x] |
| T5 | Recorrido en el navegador contra homologación con el certificado real | orquestador | [x] |

Las rutas de T1–T4 son delegadas porque cada una toca 2 o más archivos no triviales.

## Criterios de aceptación

- Guardar el emisor con una CUIT inválida muestra un error legible.
- Subir un certificado de otra CUIT, o una clave que no corresponde, se rechaza.
- En la base, `clave_cifrada` y `ta_cifrado` no contienen PEM ni token en claro.
- Ninguna respuesta al navegador contiene la clave privada ni el token.
- "Probar conexión" en homologación muestra servidores OK, login OK y el último comprobante.
- Dos pruebas seguidas reutilizan el ticket (no se pide login nuevo mientras está vigente).

## Checks

- Test-first: pgTAP (tablas, restricciones, RLS) y Vitest (lógica pura, `fetch` simulado).
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint` y `npm run build`.
- Recorrido en el navegador.

## Entrega

- Previsión: ~1300 líneas (migraciones ~150, lib + tests ~700, UI ~350, docs ~100).
- Estrategia: `ask-on-risk`; la forma de entrega (PR único o en cadena) se decide al terminar.

## Progreso

- Rama `feat/arca-configuracion` creada desde `main` (54c1e07).
- T1: migraciones `20261023000001_arca_configuracion.sql` y `20261023000002_rls_arca_configuracion.sql`. RED observado (31/31 fallan sin tablas), GREEN con `supabase test db` (12 archivos, 234 tests). Commit d547e47.
- T2: `src/lib/arca/` (cuit, cifrado, certificado, wsaa, wsfe, ticket, xml) con `node-forge` 1.3.1. RED observado (6 archivos sin módulos), GREEN: `npm test` 194 tests, `npm run typecheck`, `npm run lint` y `npm run build` OK. El build todavía no importa `node-forge` desde ninguna ruta: el empaquetado en el Worker se confirma en T3. Commit 94f5f9f.
- Revisión nativa de T1+T2: aprobada, con 1 warning y 3 sugerencias no bloqueantes, corregidas con tests en rojo primero: `CbteNro` ausente o vacío ya no se lee como 0, `validarCredencial` rechaza un certificado que todavía no empezó a valer, y la firma CMS usa la hora inyectada como `signingTime`. Tests nuevos también para el `faultstring` de WSFE y el sufijo `(HTTP n)` de `solicitarTicket`. RED observado (4 tests), GREEN: `npm test` 202 tests, `npm run typecheck` y `npm run lint` OK.
- T3: `/configuracion/arca` (page + acciones + FormularioEmisor/FormularioCredencial/PruebaConexion), `src/lib/arca/acceso.ts` (ticket guardado: reutilizar, bloqueo condicional, espera acotada de 3 s, mensajes de WSAA), `vencimiento.ts` y `secreto.ts`. RED observado (acceso y vencimiento sin módulos), GREEN: `npm test` 215 tests, `npm run typecheck`, `npm run lint`, `npm run build` OK. `node-forge` queda sólo en el bundle del servidor (`.next/server/app/(app)/configuracion/arca/page.js`, nada en `.next/static`) y `opennextjs-cloudflare build` lo empaqueta en `.open-next/server-functions/default/handler.mjs` sin errores. ~1050 líneas: supera la heurística de 400 porque la pantalla, las acciones y la orquestación del ticket con sus tests forman una sola unidad usable. Commit eee1cc2.
- T4: ítem "ARCA" en el menú; el activo es el href más largo que coincide, así "Parámetros" no se marca en `/configuracion/arca`. `.dev.vars.example`, AGENTS.md y README documentan `ARCA_CLAVE_CIFRADO`. Se generó una clave local en `.dev.vars` (gitignored, no commiteado). Secreto: en `next dev` lo carga `initOpenNextCloudflareForDev` desde `.dev.vars` en `getCloudflareContext().env`; en el Worker, OpenNext lo pone en `getCloudflareContext().env` y en `process.env`; `secreto.ts` lee el primero y usa `process.env` de respaldo. Checks: `npm test` 215, `npm run typecheck`, `npm run lint`, `npm run build`, `supabase test db` (12 archivos, 234 tests) OK; `next dev` + `curl /configuracion/arca` → 307 a `/login?redirect=…`. El filtro `or=(ta_bloqueado_hasta.is.null,ta_bloqueado_hasta.lt.<iso>)` lo parsea PostgREST local (llega a Postgres). Sin test unitario del menú: no hay infraestructura de tests de componentes.
- Revisión nativa de T3+T4: aprobada, con 3 warnings no bloqueantes sobre escrituras que no afectan filas (emisor informaba éxito, el ticket podía no guardarse, y un bloqueo sin filas por RLS se confundía con "otro pedido"). Corregidas en a8cd67c; `npm test` 215, `npm run typecheck` y `npm run lint` OK.
- T5 (recorrido local, `next dev` contra Supabase local, usuario de prueba local):
  - Bug encontrado y corregido (e1eacec): con `<form action>`, React 19 reseteaba el formulario del emisor; el select de condición IVA quedaba en "Elegí una" aunque se había guardado, y un error borraba lo cargado. Ahora campos controlados y envío por `onSubmit` + `startTransition`. Verificado: tras un error se conserva todo, y tras guardar se ve el valor guardado.
  - CUIT inválida → modal legible. CUIT con guiones → se guarda normalizada (23334771229).
  - Certificado de otra CUIT + clave que no corresponde → rechazo legible con ambos motivos.
  - Credencial descartable de la CUIT correcta → guardada; en la base `clave_cifrada` empieza con `v1.` y no contiene "PRIVATE"; el HTML de la página no contiene "PRIVATE KEY".
  - "Probar conexión" → servidores App/Base/Auth OK y mensaje legible de certificado no reconocido (`cms.cert.untrusted`); el bloqueo del ticket quedó liberado.
  - Certificado real `silfeerphomo` subido por el usuario (15/10 15:06): guardado con clave cifrada. "Probar conexión": servidores OK, login WSAA OK, segunda prueba con "ticket reutilizado" (vence 16/10 03:12), último comprobante Factura A punto de venta 7 = 0 (emisor Responsable Inscripto). En la base `ta_cifrado` empieza con `v1.` y no contiene el token en claro; bloqueo liberado. Todos los criterios de aceptación cumplidos.

## Próximo paso

Decidir la entrega (PR de `feat/arca-configuracion`) y el pase a producción: `supabase db push`, `wrangler secret put ARCA_CLAVE_CIFRADO`, deploy, y certificado de producción. Después: emisión de comprobantes (CAE).
