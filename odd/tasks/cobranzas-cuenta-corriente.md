# Cobranzas, cuenta corriente y cartera de cheques (Fase 8, Ventas) — SPEC

> Estado: **spec cerrada, sin implementar** (17/10/2026). Depende de `comprobantes-venta` (etapa 1).
> Las decisiones que eran "(propuesta)" quedaron confirmadas por el usuario salvo donde se indica.

## Objetivo

Registrar los pagos de los clientes, cancelar con ellos los comprobantes, llevar la **cuenta
corriente** de cada cliente y administrar la **cartera de cheques** recibidos.

## Decisiones del usuario (16–17/10/2026)

- **Medios de pago:** efectivo, transferencia/depósito, cheque físico, e-cheq y retenciones
  (IIBB, Ganancias, IVA y SUSS).
- **Factura de contado:** el pago se registra desde la misma factura y **siempre por el total**.
  La factura queda cancelada en el momento.
- **Cobranza de cuenta corriente:** puede ser por más o por menos que el saldo del cliente.
  - El importe se **imputa a comprobantes**: la pantalla los lista de la más vieja a la más
    nueva, y **el usuario elige** cuáles cancela y por cuánto (admite parciales).
  - Lo que no se imputa queda **a favor** del cliente y se aplica a la **próxima factura que no
    sea de contado**.
- **Recibo:** cada cobranza (y cada pago de contado) genera un **recibo numerado con PDF**.
- **Cartera de cheques:** sólo estados; no hay contabilidad bancaria.
- **Cheque rechazado:** pasar un cheque a rechazado **obliga** a generar una nota de débito al
  cliente. El capital del cheque va **sin IVA** (no gravado) y los gastos bancarios, si los hay,
  con IVA.
- **Contabilidad** (asientos, plan de cuentas): **fuera de alcance**, para más adelante.

## Reglas de negocio

### Saldo de un comprobante y estado de pago

- **Débitos** (aumentan lo que debe el cliente): facturas y notas de débito autorizadas (o
  emitidas, si son no electrónicas).
- **Créditos** (cancelan): recibos (con sus imputaciones) y notas de crédito.
- **Saldo pendiente de un débito** = total − imputaciones recibidas.
- **Estado de pago** (calculado, no guardado): `pendiente`, `parcial`, `cancelado`. Se muestra en
  el listado y en el detalle de comprobantes.
- **Nota de crédito:** se imputa automáticamente a su comprobante asociado (hasta su saldo
  pendiente). Si el asociado ya estaba cancelado, o el asociado es manual (factura vieja), el
  importe queda a favor. (propuesta)
- **Ambiente:** la cuenta corriente sólo considera comprobantes de **producción** y los no
  electrónicos. Los de homologación son sólo de prueba: para la cuenta corriente "no existen". (confirmado)

### Pago de una factura de contado

- Desde el detalle de una factura (o ND) de contado autorizada: botón **"Registrar pago"**.
  Mientras no se registra, la factura figura "contado – pago pendiente".
- El pago puede combinar medios (por ejemplo, parte efectivo y parte cheque). La suma de los medios
  tiene que ser **exactamente el total** del comprobante.
- Genera un recibo con una única imputación por el total.

### Cobranza de cuenta corriente

- **Cabecera:** cliente, fecha (por defecto hoy), observaciones.
- **Medios:** una o más líneas. El total del recibo es la suma de las líneas.
  - **Efectivo:** importe.
  - **Transferencia/depósito:** importe, banco o cuenta destino, referencia.
  - **Cheque / e-cheq:** banco, número, fecha de emisión, fecha de pago, librador (nombre y
    CUIT), importe. Cada cheque entra a la cartera en estado **en cartera**.
  - **Retención:** tipo (IIBB con jurisdicción, Ganancias, IVA, SUSS), número de certificado, fecha,
    importe.
- **Imputación:**
  - Lista los débitos con saldo pendiente del cliente, de la más vieja a la más nueva.
  - El usuario marca cuáles cancela y por cuánto. Un botón "completar en orden" llena de la más
    vieja a la más nueva hasta agotar el total. (propuesta, es sólo una ayuda)
  - La suma imputada no puede superar el total del recibo, ni el saldo pendiente de cada débito.
  - Lo no imputado queda **a favor**.
- Al **emitir** el recibo se le asigna número y queda inmutable (como un comprobante autorizado).

### Saldo a favor

- El saldo a favor de un cliente es la suma de lo no imputado de sus recibos y notas de crédito.
- Al autorizar una **factura o ND de cuenta corriente**, el saldo a favor se imputa solo a ese
  comprobante (de los créditos más viejos a los más nuevos), hasta cubrirlo o agotarse.
- Las facturas de contado **nunca** consumen saldo a favor.
- Si el cliente tiene saldo a favor, la cobranza y el editor de comprobantes lo muestran.

### Anulación de un recibo (confirmado)

- Un recibo emitido no se edita. Si se cargó mal, se **anula** con un motivo:
  - se deshacen sus imputaciones y los comprobantes vuelven a quedar pendientes;
  - sólo se puede si todos sus cheques siguen **en cartera**.
- Un recibo anulado sigue visible, marcado como tal; su número no se reutiliza.

### Cartera de cheques

- **Estados:** `en_cartera` → `depositado` | `entregado` | `rechazado`.
  - También `depositado` → `rechazado` (rebota al depositarlo).
  - También `entregado` → `rechazado` (el proveedor lo devuelve rebotado).
- **Entregado:** se registra a quién (texto libre: proveedor) y la fecha.
- Cada cambio de estado guarda fecha, usuario y observación (historial).
- **Rechazado:**
  1. En el mismo paso se crea una **nota de débito en borrador** al cliente, vinculada al cheque:
     - ítem "Cheque rechazado N° … – Banco …" por el importe del cheque, **no gravado**;
     - el usuario puede agregar ítems de gastos bancarios, con IVA.
  2. Comprobante asociado (ARCA lo exige en la ND):
     - si el recibo del cheque se imputó a facturas, la ND se asocia a esas facturas;
     - si fue a cuenta (saldo a favor), se asocia al **período** de la fecha del recibo.
  3. El cheque queda "rechazado – ND pendiente" hasta que esa ND se autoriza. No se puede salir
     de ese estado sin la ND: el cambio de estado y la creación del borrador van en una misma
     transacción.
  4. Al autorizarse la ND, el cliente vuelve a deber ese importe en su cuenta corriente (la ND es
     un débito más).

### Cuenta corriente del cliente

- En la ficha del cliente, pestaña **Cuenta corriente**:
  - saldo actual (deudor o a favor);
  - movimientos ordenados por fecha: facturas, ND, NC y recibos, con debe, haber y saldo
    acumulado;
  - comprobantes pendientes con su saldo y antigüedad.
- Listado general **Ventas → Cuentas corrientes:** clientes con saldo distinto de cero, con su
  saldo y la factura pendiente más vieja.
- PDF del resumen de cuenta corriente: **fuera de esta etapa**. (propuesta)

## Cambios en comprobantes (dependencias)

- **Ítem no gravado:** nueva opción "No gravado" en la alícuota del ítem.
  - Se manda en `ImpTotConc` y no en el array `Iva`.
  - La letra, los totales y el PDF lo contemplan (en el PDF, una línea "No gravado").
- **Período asociado** (`PeriodoAsoc`, desde/hasta) como alternativa a `CbtesAsoc` en
  ND/NC.
- Al autorizar un comprobante de cuenta corriente, se aplica el saldo a favor.
- En el listado y el detalle se muestra el estado de pago.

## Datos (propuesta)

- `recibo`:
  - `id`, `numero` (secuencia propia, formato `R-00001-00000001`), `fecha`, `cliente_id`;
  - `total`, `estado` (`borrador` | `emitido` | `anulado`), `motivo_anulacion`;
  - `comprobante_contado_id` (cuando es el pago de una factura de contado), `observaciones`;
  - auditoría: `creado_por`, `creado_en`, `emitido_en`, `anulado_en`.
- `recibo_medio`:
  - `recibo_id`, `orden`, `tipo` (`efectivo` | `transferencia` | `cheque` | `echeq` | `retencion`), `importe`;
  - transferencia: `banco`, `referencia`;
  - `cheque_id`;
  - retención: `retencion_tipo`, `retencion_jurisdiccion`, `certificado`, `fecha_retencion`.
- `cheque`:
  - `id`, `tipo` (`fisico` | `echeq`), `banco`, `numero`;
  - `fecha_emision`, `fecha_pago`, `librador`, `librador_cuit`, `importe`;
  - `cliente_id`, `recibo_id`, `estado`, `entregado_a`;
  - `nd_comprobante_id`.
- `cheque_estado`: historial (`cheque_id`, `estado`, `fecha`, `observacion`, `creado_por`).
- `imputacion`: `id`, origen `recibo_id` o `nota_credito_id`, `comprobante_id` (débito),
  `importe`, `fecha`, `automatica` (bool, para la aplicación de saldo a favor).
- Vistas:
  - `v_comprobante_saldo` (total, imputado, saldo, estado de pago);
  - `v_cuenta_corriente` (movimientos con saldo acumulado);
  - `v_cliente_saldo`.
- Inmutabilidad con triggers, igual que comprobantes:
  - recibo emitido;
  - imputaciones de recibos emitidos (salvo por anulación);
  - historial de cheques.

## Pantallas

- **Ventas → Cobranzas:** listado de recibos (fecha, número, cliente, total, estado) y **Nueva
  cobranza**.
- **Recibo** (detalle): medios, imputaciones, saldo a favor generado, PDF, anular.
- **Factura de contado** (detalle): "Registrar pago", con medios y total fijo.
- **Ventas → Cartera de cheques:**
  - filtros por estado, fecha de pago y cliente;
  - cambio de estado con observación;
  - rechazo que lleva a la ND en borrador.
- **Cliente → Cuenta corriente** y **Ventas → Cuentas corrientes**.

## Impresión

- **PDF del recibo:** encabezado del emisor, "RECIBO" con número y fecha, cliente (razón social,
  CUIT, domicilio), detalle de medios (cheques con banco, número y fecha de pago; retenciones con
  certificado), comprobantes cancelados con importe, saldo a favor generado, total en números y
  en letras. Mismo generador (`pdf-lib`) que los comprobantes.

## Preguntas respondidas (17/10/2026)

1. Numeración del recibo: punto de venta propio, formato `R-00001-00000001`.
2. Retenciones: IIBB (con jurisdicción), Ganancias, IVA y **SUSS**.
3. Los comprobantes de homologación no entran en la cuenta corriente.
4. Anulación de recibos: como está propuesta.

## Checklist (tentativo)

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Comprobantes: ítem no gravado (`ImpTotConc`), `PeriodoAsoc`, PDF y tests | delegada (writer) | [x] |
| T2 | Esquema: recibo, medios, cheque, historial, imputación, vistas de saldo y cuenta corriente, inmutabilidad y RLS (pgTAP en rojo primero) | delegada (writer) | [x] |
| T3 | Lógica pura: validación de recibo, imputación, saldo a favor y transiciones de cheques (Vitest) | delegada (writer) | [ ] |
| T4 | Cobranza de cuenta corriente y pago de contado: pantallas y acciones, emisión con número | delegada (writer) | [ ] |
| T5 | Saldo a favor automático al autorizar, imputación de NC y estado de pago en comprobantes | delegada (writer) | [ ] |
| T6 | Cartera de cheques con estados, y rechazo con ND obligatoria | delegada (writer) | [ ] |
| T7 | Cuenta corriente: ficha del cliente y listado general | delegada (writer) | [ ] |
| T8 | PDF del recibo y anulación | delegada (writer) | [ ] |
| T9 | Recorrido completo en local (y con ARCA de homologación cuando vuelva) | orquestador | [ ] |

## Progreso

### T1 — Ítem no gravado y período asociado (17/10/2026)

- Commits: `082e44f` feat(comprobantes): ítems no gravados (ImpTotConc); `c729c82` feat(comprobantes): nota
  de débito o crédito asociada a un período. Migración `20261025000001_comprobantes_no_gravado_periodo.sql`
  (sólo local; falta `db push`).
- **No gravado:** `comprobante_item.gravado` (false: sin alícuota, IVA 0) y `comprobante.no_gravado`
  (ImpTotConc). `neto` sigue siendo sólo lo gravado; `total = neto + no_gravado + iva`; `iva_detalle`
  sólo alícuotas gravadas. Sin ítems gravados se manda ImpNeto 0 y se omite el array `Iva` (ARCA 10018:
  con ImpIVA 0 el array sólo va con la alícuota 0%; 10070: es obligatorio sólo si ImpNeto > 0).
  En la app, la tasa de un ítem es `AlicuotaIva | "no_gravado"`: un `Number()` sobre ella da NaN y el
  cálculo falla en lugar de tomarla como 0%.
- **Período asociado:** `comprobante.periodo_asoc_desde/hasta` (los dos o ninguno, desde ≤ hasta, nunca
  en una factura). Una nota lleva comprobantes asociados **o** un período, no los dos (ARCA admite ambos
  según 10197; simplificación de la app). Al autorizar: mismo mes (10209) y hasta ≤ fecha de la nota
  (10208). Con período la letra sale del cliente y no hay control de saldo de NC. `PeriodoAsoc` va
  después de `Iva` (orden del WSDL: … CbtesAsoc, Tributos, Iva, Opcionales, Compradores, PeriodoAsoc).
- Ambos campos quedan fijos en verificación (CM004) y en autorizado (CM001); el RPC
  `guardar_borrador_comprobante` los guarda (misma firma).
- Checks: `npm test` 481 ok; `npm run typecheck` ok; `npm run lint` ok; `npm run build` ok;
  `supabase migration up --local` + `supabase test db` 399 ok; `supabase db reset --local` +
  `supabase test db` 399 ok. Datos locales de prueba restaurados después del reset.

### T2 — Esquema de cobranzas (17/10/2026)

- Commit: feat(cobranzas): recibos, cheques, imputaciones y vistas de cuenta corriente. Migraciones
  `20261026000001_cobranzas.sql` y `20261026000002_rls_cobranzas.sql` (sólo local; falta `db push`).
  Tests `supabase/tests/cobranzas_test.sql` (148, en rojo antes de la migración).
- **Numeración:** tabla `recibo_punto_venta (numero, nombre, activo, ultimo_numero)`, con el 1 creado.
  `emitir_recibo(id)` (security invoker) bloquea el contador con `select … for update`, lo avanza y emite
  en la misma transacción: si la emisión falla se deshace todo, sin huecos. El trigger exige que el número
  emitido sea el recién tomado del contador (CB014). `recibo.numero_texto` = `R-00001-00000001`.
- **Emisión** (trigger, vale para SQL directo): al menos un medio (CB003), total = suma de medios (CB004),
  cada cheque con su medio del mismo tipo e importe (CB012), imputaciones ≤ total (CB005) y ≤ saldo de cada
  débito, con el débito bloqueado (CB006), mismo cliente (CB008). Pago de contado: total exacto del
  comprobante y una única imputación a él (CB015).
- **Débitos:** facturas y ND autorizadas de producción o no electrónicas (`fn_es_debito_cc`). Homologación
  no recibe imputaciones (CB007) ni aparece en las vistas.
- **Imputaciones:** origen recibo o nota de crédito (exactamente uno). Una imputación cuenta si su recibo
  está emitido o si sale de una NC; las de un borrador sólo cuentan para el tope de ese recibo. A un recibo
  emitido sólo se le agregan imputaciones automáticas (saldo a favor); nunca a un débito de contado (CB015).
  Las de NC no se modifican ni se borran.
- **Notas de crédito en las vistas:** una NC autorizada (producción o no electrónica) va siempre por su total
  al haber de la cuenta corriente; lo que imputa baja el saldo de ese débito y el resto queda a favor
  (`v_cliente_saldo_a_favor`). Así `saldo = pendientes − a favor` se cumple siempre (test).
- **Cheques:** en_cartera → depositado | entregado | rechazado; depositado/entregado → rechazado (CB009).
  Entregado exige `entregado_a`; rechazado exige `nd_comprobante_id` (una ND del mismo cliente, CB018). Con
  el recibo emitido sólo cambia el estado (CB017). Cada alta y cambio de estado escribe `cheque_estado`
  (trigger) con `estado_fecha` y `estado_observacion` del cheque; el historial no se modifica ni se borra
  (CB011).
- **Anulación** `anular_recibo(id, motivo)`: sólo emitido (CB002), con motivo (CB019) y todos sus cheques en
  cartera (CB010). Un trigger posterior borra **todas** sus imputaciones (también las automáticas: los
  débitos vuelven a pendientes, como dice la spec) y pasa sus cheques al estado **anulado** (sale de la
  cartera, queda en el historial). El número no se reutiliza; los medios se conservan. Un recibo anulado no
  aparece en la cuenta corriente.
- **Vistas** (security invoker): `v_comprobante_saldo`, `v_cliente_saldo_a_favor`, `v_cuenta_corriente`
  (orden fecha, creado_en, id; saldo acumulado por cliente) y `v_cliente_saldo` (todos los clientes; debe,
  haber, saldo, deuda pendiente, a favor y fecha del pendiente más viejo).
- Tamaño: ~1100 líneas de SQL más 830 de tests, por encima de las 400 orientativas: las reglas de la spec son
  muchas y cada una lleva su trigger y su test; partirlo dejaría un esquema a medias.
- Checks: `supabase migration up --local` ok; `supabase test db` 547, falla sólo `arca_configuracion_test` 26
  (conocida: hay una credencial de homologación local); `supabase db reset --local` + `supabase test db`
  547 ok. Datos locales restaurados (el volcado ahora resuelve `producto_id` por código).

## Próximo paso

- T3: lógica pura de recibo, imputación, saldo a favor y cheques (Vitest en rojo primero).

## Criterios de aceptación

- Una factura de contado sólo se puede pagar por su total exacto y queda cancelada.
- Una cobranza de $100 sobre facturas por $60 y $70, imputando $60 a la primera y $40 a la
  segunda, deja la primera cancelada, la segunda con $30 pendientes y $0 a favor.
- Una cobranza mayor que la deuda deja saldo a favor, que se aplica solo a la próxima factura de
  cuenta corriente, nunca a una de contado.
- Un cheque rechazado no queda "resuelto" sin su ND. La ND lleva el capital no gravado y, al
  autorizarse, vuelve a cargar la deuda.
- Un recibo emitido no se modifica; anularlo devuelve los comprobantes a pendientes.
- El saldo de la cuenta corriente coincide con la suma de los saldos pendientes menos el saldo a
  favor.

## Checks

- Test-first: pgTAP (esquema, inmutabilidad, vistas de saldo, RLS) y Vitest (imputación, saldo a
  favor, transiciones, armado de la ND).
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Recorrido en el navegador.
