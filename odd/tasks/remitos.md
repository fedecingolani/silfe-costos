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
| T3 | TS: tipos, cálculo de bultos y valor declarado, validación y armado de la facturación (Vitest) | delegada (writer) | [ ] | |
| T4 | Pantallas: listado, editor (bultos, transporte, domicilio, valor declarado) y detalle | delegada (writer) | [ ] | |
| T5 | Pantalla de facturación: cliente → remitos pendientes → cantidades → borrador de factura; el editor de comprobantes manda `remito_item_id` en cada ítem; error claro si el cliente no tiene condición de IVA | delegada (writer) | [ ] | |
| T6 | PDF del remito (letra R, bultos, valor declarado, transporte, domicilio de entrega) | delegada (writer) | [ ] | |
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
    - R3-003 (cliente sin condición de IVA deja la letra nula) y R3-004 (herencia del vínculo
      con ítems repetidos o reordenados): pasan a T5, que valida la condición de IVA y hace que
      el editor mande `remito_item_id`.

## Próximo paso

T3 en `feat/remitos-03-logica`, sobre T2.
