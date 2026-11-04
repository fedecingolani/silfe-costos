# Remitos de venta

> Estado: **planificada** (decisiones tomadas el 04/11/2026).
> Rama: `feat/remitos` (sale de `main` en fe1d108).
> Copia en Engram: `odd/remitos/tasks`.

## Objetivo

Emitir remitos (letra R, numeración propia, sin ARCA) y facturarlos después, total o
parcialmente, juntando varios remitos del mismo cliente en una factura.

## Problema y por qué

Hoy la mercadería sale sin un documento propio: no hay registro de qué se entregó, cuántos
bultos viajaron ni con qué transporte, y la factura se arma a mano. El remito registra la
entrega y la factura se genera a partir de lo entregado y todavía no facturado.

## Alcance

**Entra:** CRUD de remitos, emisión con numeración automática por punto de venta, bultos por
ítem y total, valor declarado, transporte y domicilio de entrega, listado, detalle, PDF, y
facturación de uno o varios remitos del mismo cliente por cantidad (parcial o total).

**No entra:** stock (todavía no existe), remitos de compra, ARCA/COT, notas de crédito sobre
remitos, envío por mail.

## Decisiones

- **Tablas propias** (`remito`, `remito_item`), igual que `presupuesto`, no una `clase` más en
  `comprobante`. La tabla `comprobante` es fiscal (triggers de ARCA, `tipo_arca`, cuenta
  corriente); agregar una clase obliga a tocar `fn_comprobante_validar` entero y todos los
  `Record<ClaseComprobante, …>`. Contra: un campo comercial nuevo de factura hay que sumarlo
  también acá. Un remito nunca toca la cuenta corriente.
- **Numeración por punto de venta** (usuario, 04/11): `R-<pv>-<número>`, último + 1 por punto de
  venta con candado consultivo e índice único, como la letra X. Vale cualquier punto de venta
  activo, electrónico o no.
- **Factura de varios remitos** (usuario, 04/11): una factura puede juntar remitos distintos,
  siempre del mismo cliente.
- **Facturación parcial por cantidad** (usuario, 04/11): de cada ítem se factura una cantidad;
  lo pendiente es `cantidad − facturado`.
- **Transporte y domicilio de entrega** (usuario, 04/11): el transporte arranca con el del
  cliente y se puede cambiar; el domicilio de entrega es texto libre y arranca con el del
  cliente.
- **Vínculo factura ↔ remito por ítem**: `comprobante_item.remito_item_id` (nullable). Lo
  facturado de un ítem es la suma de las cantidades de los ítems de factura que lo apuntan,
  incluidos los borradores, para que dos borradores no puedan facturar lo mismo. Si se borra el
  borrador, la cantidad vuelve a quedar pendiente.

## Reglas de negocio

### Ciclo de vida

| Estado | Cuándo | Se puede |
| --- | --- | --- |
| `borrador` | al crear | editar, borrar, emitir |
| `emitido` | al emitir (toma número) | editar ítems y datos, imprimir, facturar, anular |
| `parcial` | tiene algo facturado y algo pendiente | imprimir, facturar lo pendiente |
| `facturado` | todo facturado | imprimir |
| `anulado` | anulado desde `emitido` | ver e imprimir (conserva el número) |

- `parcial` y `facturado` se derivan de lo facturado; no se cargan a mano.
- **Un remito con cualquier parte facturada no se puede modificar** (usuario, 04/11). Si se
  borran las facturas en borrador que lo apuntaban y no queda nada facturado, vuelve a `emitido`
  y se puede editar otra vez.
- Un remito emitido no se borra (el número ya se usó): se anula, y sólo si no tiene nada
  facturado. *(Criterio propio, a revisar.)*

### Datos

- Encabezado: cliente, fecha, punto de venta, transporte, domicilio de entrega, observaciones,
  valor declarado, más los mismos campos comerciales que la factura (condición de pago, lista
  de precios).
- Ítems: los mismos que la factura (producto, descripción, cantidad, precio, descuento,
  alícuota) más **bultos** (entero ≥ 0).
- **Bultos total** = suma de los bultos de los ítems (calculado, no editable).
- **Valor declarado**: se sugiere con la suma de los importes de los ítems y se puede cambiar.
  Si el usuario no lo tocó, sigue a la suma cuando cambian los ítems. *(Criterio propio.)*

### Facturación

- Se elige un cliente, se listan sus remitos con pendiente, y por ítem se indica la cantidad a
  facturar (por defecto, todo lo pendiente).
- Se elige el punto de venta de la factura; la letra sale como hoy (A/B por condición de IVA en
  un punto electrónico, X en uno no electrónico).
- Resultado: un **borrador de factura** con un ítem por cada ítem de remito elegido, con el
  precio, descuento y alícuota del remito, y `remito_item_id` apuntando al origen. El borrador
  se revisa y se emite como cualquier factura.
- No se puede facturar más que lo pendiente (control en la base, con candado por remito).

## Checklist

| ID | Tarea | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | DB: `remito`, `remito_item`, estados, triggers de bloqueo, `emitir_remito` con numeración por punto de venta, anulación, RLS aparte (pgTAP en rojo primero) | delegada (writer) | [x] | 6f65156 |
| T2 | DB: `comprobante_item.remito_item_id`, vista de pendientes por ítem, `facturar_remitos` (mismo cliente, tope de pendiente, candado), estado derivado y desbloqueo al borrar el borrador, `guardar_remito`; más las tres advertencias de las revisiones de T1 (pgTAP) | delegada (writer) | [x] | 53a8d0a, e52860f |
| T3 | TS: tipos, cálculo de bultos y valor declarado, validación y armado de la facturación (Vitest) | delegada (writer) | [x] | 1890ccd, f9224a3 |
| T4 | Pantallas: listado, editor (bultos, transporte, domicilio, valor declarado) y detalle | delegada (writer) | [x] | eea8442 |
| T5 | Pantalla de facturación: cliente → remitos pendientes → cantidades → borrador de factura; el editor de comprobantes manda `remito_item_id` en cada ítem; error claro si el cliente no tiene condición de IVA | delegada (writer) | [x] | 53b42ce, dfc8b63 |
| T6 | PDF del remito (letra R, bultos, valor declarado, transporte, domicilio de entrega) | delegada (writer) | [x] | 040e182 |
| T7 | Menú (Ventas → Remitos) y recorrido en el navegador | orquestador | [ ] | |

## Entrega

- Previsión: ~3000 líneas en total.
- Estrategia (usuario, 04/11): **PRs encadenados** sobre rama de feature, como presupuestos.
  Cada tarea en `feat/remitos-0N-<tema>` con PR contra `feat/remitos`; al final
  `feat/remitos` → `main`.
- Rutas: T1–T6 delegadas (cada una toca 2 o más archivos no triviales); T7 orquestador.
- T7 depende del PR #23 (menú agrupado), que todavía no está en `main`.

## Criterios de aceptación

- Emitir dos remitos en un punto de venta da números consecutivos; en otro punto de venta, la
  serie arranca aparte.
- Bultos total es la suma de los ítems; el valor declarado se sugiere y se puede cambiar.
- Facturar 100 de 300 deja el remito en `parcial` con 200 pendientes y bloqueado para edición.
- Una factura puede juntar ítems de dos remitos del mismo cliente; con clientes distintos, error.
- No se puede facturar más que lo pendiente, ni con dos borradores a la vez.
- Borrar el borrador de factura devuelve las cantidades a pendiente.
- El remito no aparece en la cuenta corriente del cliente.

## Checks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `supabase migration up --local`,
`supabase test db`.

## Avance

- 04/11: decisiones de producto cerradas con el usuario; mapeo del modelo de comprobantes,
  numeración X y conversión de presupuestos.
- T1 (04/11, `feat/remitos-01-db`, 6f65156): migraciones `20261104000001_remitos.sql` y
  `20261104000002_rls_remitos.sql`, `supabase/tests/remitos_test.sql` (83 aserciones).
  - RED: 29 de 83 fallaban sin tablas. GREEN: `supabase test db` 18 archivos / 841 tests PASS
    (repetido por el orquestador), `npm test` 829 PASS.
  - Códigos de error RM001–RM007. `bultos_total` lo pisa siempre el trigger con la suma de los
    ítems (no da error si se escribe a mano). Banderas de transacción `remito.emitiendo` y
    `remito.anulando`.
  - Revisión nativa: riesgo medio, enfoque de confiabilidad, **aprobada** y acusada
    (review-1dda88bb9d48dc03). Dos advertencias no bloqueantes, que pasan a T2:
    1. La transición borrador→emitido (y emitido→anulado) se apoya sólo en la bandera de
       transacción; una sesión autenticada puede setearla con `set_config` y saltear los
       controles de `emitir_remito` (ítems, punto de venta activo, candado, max+1).
    2. `fn_remito_item_bloqueo` lee el estado del padre sin bloquearlo: un ítem insertado en
       paralelo con `anular_remito` puede quedar en un remito anulado.
    3. (Revisión de la rama contra `main`, review-1f9ae299dac289bb, también aprobada.)
       `remito.lista_precio_id` es `on delete set null`, pero un remito anulado rechaza todo
       cambio (RM001): borrar una lista de precios usada por un remito anulado falla con un
       error confuso. Hay que permitir ese cambio puntual o cambiar la FK.
  - Para destrabar la revisión se agregaron `.atl/` y `firebase-debug.log` a
    `.git/info/exclude` (sólo local).

- T2 (04/11, `feat/remitos-02-facturacion-db`, 53a8d0a): migración
  `20261104000003_remitos_facturacion.sql`, tests `remitos_facturacion_test.sql` (96 aserciones).
  - RED: los estructurales fallaban y la corrida abortaba sin `facturar_remitos`; contra los
    triggers de T1, 14 de 96 fallaban (las tres advertencias). GREEN: `supabase test db` 937,
    `npm test` 829, `npm run typecheck` OK.
  - Las tres advertencias de T1 quedaron resueltas: el trigger controla las invariantes reales
    al emitir (ítems, punto de venta activo, número = max+1) y al anular (nada facturado); los
    ítems bloquean el remito padre `for update`; sólo se acepta el `set null` de una lista de
    precios borrada en un remito anulado o facturado.
  - Nuevos códigos: RM008 `remito_facturado`, RM009 `facturacion_invalida`, RM010
    `excede_pendiente`. Trigger `trg_comprobante_remito`: no se cambia cliente ni clase de una
    factura con ítems vinculados.
  - `guardar_borrador_comprobante` se reemplazó entero: respeta `remito_item_id` si viene en el
    JSON del ítem y, si no viene, lo hereda del ítem anterior con el mismo producto y
    descripción (respaldo para el editor actual). Duplicar y notas nunca lo heredan.
  - API para T3–T5: `guardar_remito(p_id, p_remito, p_items) returns uuid`,
    `facturar_remitos(p_items [{remito_item_id, cantidad}], p_punto_venta) returns comprobante`,
    vistas `v_remito_item_pendiente` y `v_remito_estado` (con `numero_texto` R-00001-00000001).
  - Revisión nativa (review-04d06d4935c0734d): **aprobada** y acusada. Hallazgos:
    - R3-001 (cantidad ≤ 0 baja lo facturado): no aplica, `comprobante_item` ya tiene
      `check (cantidad > 0)`.
    - R3-002 (`guardar_remito` dejaba un emitido sin ítems): corregido en e52860f con el trigger
      de restricción diferido `trg_remito_con_items` (migración `20261104000004`), 2 tests nuevos.
      RED parcial: sin la migración la corrida aborta al nombrar el trigger. Suite: 939 PASS.
      Evaluación del commit: medio, bajo el presupuesto (58 líneas), queda pendiente en la tanda.
    - Revisión de la rama contra `main` (review-4d3efe59adea9d0d): **aprobada** y acusada, con
      un hallazgo: cambiar `remito_id` de un ítem podía vaciar un remito emitido. Corregido:
      `trg_remito_con_items` también corre en `update of remito_id` (misma migración 000004,
      aplicada a mano en local). Test nuevo; RED sin la corrección (test 24 «no exception»),
      GREEN 940 PASS.
    - R3-003 (cliente sin condición de IVA deja la letra nula) y R3-004 (herencia del vínculo
      con ítems repetidos o reordenados): pasan a T5, que valida la condición de IVA y hace que
      el editor mande `remito_item_id`.

- T3 (04/11, `feat/remitos-03-logica`, 1890ccd + f9224a3): módulos `src/lib/remitos/`
  (`borrador`, `editor`, `facturacion`, `errores`, `listado`, `numero`, `decimal`) y tipos en
  `tipos.ts`.
  - RED: los 7 archivos de test fallaban por módulo inexistente. GREEN: `npm test` 911,
    `typecheck` y `lint` OK.
  - Decisiones: cantidades y centavos con enteros escalados (`decimal.ts`, BigInt), sin
    redondeo silencioso (más de 4 decimales es error); el remito calcula IVA siempre (no tiene
    letra); un valor declarado guardado que difiere de la suma se trata como manual; un
    borrador no se imprime; RM009/RM010 muestran el mensaje de la base.
  - `MENSAJE_CLIENTE_SIN_CONDICION_IVA` en `facturacion.ts` cubre R3-003 de T2.
  - Revisión nativa: la rama entera contra `main` superó el tamaño de revisión
    (`lens_context_budget_exceeded`); se revisó sólo T3 contra la punta de T2
    (review-071be9500638522d), **aprobada** y acusada. Los tres hallazgos se corrigieron en
    f9224a3, con test en rojo primero:
    1. bultos asociados por posición: ahora, si `armarItems` no devuelve un ítem por renglón,
       no se guarda (hoy no pasa: cada fila descartada suma un error);
    2. un transporte o lista de precios mal formado es error, no "sin transporte";
    3. la traducción de errores usa `Object.hasOwn` (una pista "constructor" ya no devuelve una
       función).
    GREEN: `npm test` 913, `typecheck` y `lint` OK.

- T4 (04/11, `feat/remitos-04-pantallas`, eea8442): `/remitos` (listado con filtros),
  `/remitos/nuevo`, `/remitos/[id]` (editor en borrador y emitido; sólo lectura en parcial,
  facturado y anulado, con facturado/pendiente por ítem y facturas vinculadas), acciones emitir,
  anular y borrar con confirmación. `TablaItems` pasó a ser genérica con `nuevaFila` y
  `columnaExtra` opcionales; presupuestos y comprobantes no cambian.
  - Sin helpers puros nuevos (sin RED/GREEN propio). `npm test` 913, `typecheck`, `lint` y
    `build` OK.
  - Recorrido en el navegador (orquestador, base local con un cliente y transporte de prueba
    cargados por SQL): elegir cliente completa transporte y domicilio; bultos total = 12;
    valor declarado sigue la suma ($ 300.000) y "Usar la suma de los ítems" vuelve a la
    sugerencia; guardar crea el borrador; emitir asigna `R-00007-00000001`; el listado lo
    muestra Emitido. Sin errores en consola.
  - Detalles a mejorar (no bloquean): "1 remitos" en el contador; con la columna de bultos la
    tabla de ítems pide scroll horizontal a 1280 px; `ModalError` titula "No se pudo guardar"
    también al emitir o anular.
  - Revisión nativa: el usuario eligió saltearla para este candidato
    (`declined_this_candidate`).

- T5 (04/11, `feat/remitos-05-facturacion`, 53b42ce + dfc8b63):
  - Parte A, `/remitos/facturar`: lista los clientes con pendientes; con `?cliente=` agrupa
    los ítems pendientes por remito, con cantidad a facturar editable, punto de venta (primero
    electrónico por defecto), vista previa de totales y errores en vivo. La Server Action
    vuelve a leer pendientes, punto de venta y condición de IVA de la base, llama a
    `facturar_remitos` y redirige al borrador de factura. También hay un botón "Facturar
    remitos" en el listado.
  - Parte B (R3-004): el editor de facturas carga, conserva y manda `remito_item_id` en cada
    renglón (null si no tiene vínculo), así la base nunca usa la herencia por producto y
    descripción. `armarItems` sólo lo emite con `{ vincularRemitos: true }` y sólo para
    facturas; duplicar y generar nota pasan por `sinVinculoRemito`; presupuestos nunca lo
    mandan. Los renglones vinculados muestran "Remito R-…". RM009/RM010 al guardar se
    traducen con `mensajeErrorRemito`.
  - RED/GREEN: parte A, 8 tests nuevos en rojo y luego 27 en verde; parte B, 10 tests nuevos
    en rojo (incluido el caso R3-004 de renglones repetidos y reordenados) y 2 expectativas
    existentes actualizadas a propósito. `npm test` 934, `typecheck`, `lint`, `build` OK,
    `supabase test db` 940 PASS.
  - Recorrido del orquestador en el navegador: facturar 100 de 300 de R-00007-00000001 crea
    una Factura A en borrador con la marca del remito; el remito pasa a "Facturado parcial"
    con 100 facturados y 200 pendientes, sólo lectura. El borrador quedó en la base local.
  - Nota: correr `npm run build` con el servidor de desarrollo levantado rompió Turbopack
    (módulos viejos y recarga infinita); hubo que reiniciarlo y borrar `.next`.
  - Revisión nativa: el usuario eligió saltearla para este candidato.

- T6 (04/11, `feat/remitos-06-pdf`, 040e182): `src/lib/remitos/pdf-datos.ts`, `pdf.ts`
  (renderer propio que reusa los helpers exportados de `comprobantes/pdf.ts`, sin tocarlo),
  `pdf-descarga.ts` y la ruta `/remitos/[id]/pdf` (404 si no existe, 409 en borrador). Botón
  "PDF" en el detalle.
  - Precios: se imprimen, como el presupuesto, controlados por
    `MOSTRAR_PRECIOS_REMITO = true` (se puede apagar en una línea; sin precios quedan cantidad,
    bultos, total de bultos y valor declarado). Anulado lleva marca de agua "ANULADO".
  - RED: los 3 archivos de test fallaban sin módulos. GREEN: 33 tests nuevos; `npm test` 967,
    `typecheck` y `lint` OK. `build` no se corrió (servidor de desarrollo levantado).
  - Control del orquestador: la ruta devuelve 200 `application/pdf`
    "Remito R-00007-00000001.pdf"; renderizado a PNG se ven la R con la leyenda, transporte,
    domicilio de entrega, bultos por ítem, "Bultos total: 12", "Valor declarado:
    $ 300.000,00" y el bloque "Recibí conforme". El emisor sale vacío porque la base local no
    tiene `arca_emisor` cargado.
  - Revisión nativa: el usuario eligió saltearla para este candidato.

## Próximo paso

T7: menú (cuando se mergee #23) y recorrido completo.
