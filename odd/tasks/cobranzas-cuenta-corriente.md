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
| T3 | Lógica pura: validación de recibo, imputación, saldo a favor y transiciones de cheques (Vitest) | delegada (writer) | [x] |
| T4 | Cobranza de cuenta corriente y pago de contado: pantallas y acciones, emisión con número | delegada (writer) | [x] |
| T5 | Saldo a favor automático al autorizar, imputación de NC y estado de pago en comprobantes | delegada (writer) | [x] |
| T6 | Cartera de cheques con estados, y rechazo con ND obligatoria | delegada (writer) | [x] |
| T7 | Cuenta corriente: ficha del cliente y listado general | delegada (writer) | [x] |
| T8 | PDF del recibo y anulación | delegada (writer) | [x] |
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

- Commit: `bdfab47` feat(cobranzas): recibos, cheques, imputaciones y vistas de cuenta corriente. Migraciones
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

### T3 — Lógica pura de cobranzas (17/10/2026)

- Commit: feat(cobranzas): validación de recibos, imputación, saldo a favor y transiciones de cheques
  `ae49bc4`. Vitest en rojo primero (4 archivos sin implementación).
- `src/lib/cobranzas/dinero.ts`: centavos enteros (`aCentavos`, `aPesos`, `sumarPesos`, `textoPesos`). Los
  helpers de `comprobantes/calculo.ts` son privados y trabajan con 4 decimales y BigInt; para sumar importes
  de 2 decimales alcanza con centavos enteros (mismo criterio que `saldoNotaCredito`).
- `recibo.ts`: `validarRecibo` (cliente, fecha, ≥1 medio, importes > 0; cheque: banco, número, fecha de pago,
  CUIT del librador de 11 dígitos si se carga; retención: tipo, certificado, fecha y jurisdicción en IIBB),
  `totalRecibo`, `formatearNumeroRecibo` → `R-00001-00000001`.
- `imputacion.ts`: `validarImputaciones` (≤ saldo de cada débito, suma ≤ total, sin negativos ni duplicados;
  un importe 0 se ignora), `saldoAFavor`, `completarEnOrden` (de la más vieja a la más nueva) y
  `pagoContado` (medios = total exacto; sólo comprobantes de contado).
- `saldo-a-favor.ts`: `aplicarSaldoAFavor(creditos, debito)` → imputaciones automáticas de los créditos más
  viejos a los más nuevos hasta el total del débito; un débito de contado devuelve `[]`.
- `cheques.ts`: `TRANSICIONES_CHEQUE`, `puedePasar`, `puedeAnularRecibo`, `armarNotaDebitoRechazo(cheque,
  contexto)` → `NotaArmada` (el mismo tipo que `armarNota`, listo para `guardar_borrador_comprobante`):
  ND de cuenta corriente con un ítem no gravado "Cheque rechazado N° … – banco" por el importe; asociada a
  las facturas que canceló el recibo (letra de esas facturas; si son de letras distintas, error) o, si fue a
  cuenta, al período del 1° del mes del recibo a la fecha del recibo (letra del cliente), validado con
  `validarPeriodoAsociado` (10208/10209).
- Tipos compartidos en `src/lib/tipos.ts`: estados de recibo, cheque y pago, medios, retenciones y filas
  `Recibo`, `ReciboMedio`, `Cheque`, `ChequeEstado`, `Imputacion`.
- Tamaño: ~800 líneas (la mitad son tests) más ~170 de tipos.
- Checks: `npm test` 513 ok; `npm run typecheck` ok; `npm run lint` ok; `npm run build` ok; `supabase test db`
  547, falla sólo `arca_configuracion_test` 26 (conocida, con los datos locales restaurados).

### T4 — Cobranza de cuenta corriente y pago de contado (18/10/2026)

- Commit: `75a0bb5` feat(cobranzas): cobranza de cuenta corriente y pago de contado. Migración
  `20261027000001_cobranzas_saldo_a_favor.sql` (sólo local; falta `db push`).
- **Guardado atómico:** RPC `guardar_borrador_recibo(p_id, p_recibo, p_medios, p_imputaciones)` (security
  invoker, sólo authenticated). Crea el recibo o, si es borrador, borra sus imputaciones, medios y cheques y los
  vuelve a crear; total = suma de medios. Las imputaciones se insertan ordenadas por comprobante (mismo orden de
  bloqueo). La acción `guardarRecibo` valida antes con `validarRecibo` + `validarImputaciones` (o `pagoContado`)
  contra los saldos actuales (`armarRecibo` en `src/lib/cobranzas/guardado.ts`).
- **Cheques de un borrador:** se crean en_cartera al guardar, pero no son cartera hasta emitir (T6 tiene que
  filtrar por recibo emitido). Al borrar el borrador se van en cascada con su historial; no hizo falta cambiar el
  esquema (test pgTAP).
- **Pantallas:** Ventas → Cobranzas (`/cobranzas`, filtros desde/hasta/cliente/estado), `/cobranzas/nueva`
  (editor: cliente con BuscadorCliente, medios por tipo, total en vivo, imputación con "Completar en orden",
  imputado / total / queda a favor, saldo a favor actual del cliente) y `/cobranzas/[id]` (borrador: editor;
  emitido/anulado: detalle con medios, imputaciones enlazadas y queda a favor; PDF y Anular deshabilitados hasta
  T8). "Emitir recibo" guarda, pide confirmación y llama a `emitir_recibo`; los CB0xx se traducen en
  `src/lib/cobranzas/errores.ts`.
- **Pago de contado:** el detalle de un comprobante autorizado de contado (débito de cuenta corriente) muestra
  "Contado – pago pendiente" con "Registrar pago" (`/cobranzas/nueva?contado=<id>`: cliente fijo, sin tabla de
  imputación, una imputación por el total y medios = total exacto) o "Pagado – Recibo R-…". Si ya hay un borrador
  o un recibo emitido para ese comprobante, `nueva` abre ese recibo.
- Tamaño: ~2200 líneas (editor y pantallas ~1500, tests ~330), por encima de las 400 orientativas: son tres
  pantallas nuevas con su editor; partirlas dejaría la cobranza sin poder emitirse.

### T5 — Saldo a favor automático, NC y estado de pago (18/10/2026)

- Commit: `47bb25b` feat(cobranzas): saldo a favor automático, imputación de notas de crédito y estado de pago.
  pgTAP en rojo primero (8 fallas), después verde.
- **Dónde se aplica:** trigger `trg_comprobante_aplicar_creditos` (AFTER UPDATE en comprobante al pasar a
  autorizado), en la misma transacción que el cambio de estado: cubre los electrónicos (`marcarAutorizado`), los
  no electrónicos y SQL directo. Factura/ND de cuenta corriente (producción o no electrónica) → imputaciones
  automáticas de `v_cliente_saldo_a_favor` (fecha, alta). NC → a sus asociados de la base de cuenta corriente,
  hasta su saldo; el resto a favor. Período, sistema anterior y asociados de contado: la NC queda a favor.
  Contado y homologación: nada.
- **Seguridad:** la aplicación va en un bloque con `exception`: si falla, se registra un WARNING y la
  autorización (con un CAE ya otorgado por ARCA) igual se guarda. Un `pg_advisory_xact_lock` por cliente
  serializa autorizaciones simultáneas.
- **Estado de pago:** columna "Pago" en el listado de comprobantes (pendiente/parcial/cancelado de
  `v_comprobante_saldo`, consultado en lotes de 100 ids; "—" en borradores, homologación y NC) y tarjeta
  "Cobranza" en el detalle con saldo pendiente e imputaciones recibidas (recibos emitidos y NC, enlazados).
- Checks (T4 y T5): `npm test` 530 ok; `npm run typecheck` ok; `npm run lint` ok; `npm run build` ok;
  `supabase migration up --local` + `supabase test db` 572, falla sólo `arca_configuracion_test` 26 (conocida);
  `supabase db reset --local` + `supabase test db` 572 ok; datos locales restaurados. Recorrido por PostgREST
  local con JWT firmado (guardar, emitir, re-emitir → CB002, autorizar otra factura → saldo a favor aplicado) y
  filas temporales borradas. `next dev` con Supabase local: las rutas nuevas responden 307 a /login, sin 500.

### Revisión de T2+T3 (18/10/2026)

- Resultado: **aprobada**, con 2 advertencias y 1 sugerencia, corregidas en la unidad A de T6
  (`fix(cobranzas): CUIT del librador normalizado, contador de recibos protegido y mensaje de letra`).
- **CUIT del librador** (`recibo.ts`): `validarRecibo` acepta separadores y la base exige 11 dígitos. Ya lo
  normalizaban `armarRecibo` (`guardado.ts`) y `guardar_borrador_recibo` (T4, `75a0bb5`); se agregó la prueba de
  ida y vuelta desde el JSON de la pantalla ("20-11111111-2" → "20111111112"). El pgTAP equivalente ya estaba.
- **Contador de recibos** (`rls_cobranzas.sql`): authenticated podía hacer UPDATE de
  `recibo_punto_venta.ultimo_numero`. Migración `20261028000001_cobranzas_cartera.sql`: se borran las políticas de
  insert/update/delete y se revocan esos permisos (queda select); `emitir_recibo` pasa a **security definer**
  (search_path vacío, sin parámetros de número ni punto de venta) y es la única vía para avanzar el contador. No se
  usó un ayudante definer aparte: tendría que ser ejecutable por authenticated y podría quemar números sin emitir.
  pgTAP: update/insert/delete directos fallan con 42501; emitir como authenticated sigue numerando.
- **Letra** (`cheques.ts`): facturas imputadas sin letra daban un mensaje mal armado; ahora un error legible (test).

### Revisión de T4+T5 (18/10/2026)

- Resultado: **aprobada**, con 3 advertencias y 1 sugerencia, corregidas en la unidad A de T7
  (`d46aec9` fix(cobranzas): mensajes de error que no se pierden, carga de cuenta sin carreras e importes inválidos
  visibles).
- **Mensajes que se perdían** (`EditorRecibo.tsx`): si fallaba la emisión de un recibo creado en `/cobranzas/nueva`, el
  editor navegaba a `/cobranzas/[id]` y se volvía a montar. Ahora un error deja la pantalla quieta (con el id ya en el
  estado, los siguientes guardados van a ese borrador) y sólo se navega con éxito; el aviso viaja en la URL
  (`?aviso=guardado|emitido|anulado`, lista cerrada en `avisoDeParametro`, nunca texto arbitrario).
- **Carga de la cuenta del cliente**: `elegirCliente` con try/catch/finally y un número de pedido (`useRef`): sólo la
  respuesta del último cliente elegido cambia la pantalla; un rechazo muestra un error legible en la tabla.
- **Importes ilegibles**: `leerImputacionesEditor` (`src/lib/cobranzas/editor.ts`, Vitest) los deja como NaN y la
  validación bloquea con "El importe a imputar de {comprobante} no es un número válido." (antes se tomaban como 0 y el
  dinero pasaba a "a favor" sin aviso).
- **Sugerencia (pgTAP)**: se fuerza una falla a mitad de `fn_comprobante_aplicar_creditos` con un trigger de prueba que
  rechaza la segunda imputación automática (dentro de la transacción del test, sin tocar el código de producción): la
  factura queda autorizada, sin imputaciones parciales y con el saldo a favor entero. No hizo falta un gancho de test en
  la migración. El test pasó de entrada (caracteriza un comportamiento que ya era correcto).

### Revisión de T6

- **Declinada por el usuario**: valen las verificaciones del writer registradas en T6.

### T6 — Cartera de cheques y rechazo con ND obligatoria (18/10/2026)

- Commits: `56b5102` fix(cobranzas): CUIT del librador normalizado, contador de recibos protegido y mensaje de letra
  (unidad A, ver "Revisión de T2+T3"); unidad B: `a634373` feat(cobranzas): cartera de cheques con estados y nota de débito
  obligatoria por rechazo. Migración `20261028000001_cobranzas_cartera.sql` (sólo local; falta `db push`). pgTAP en
  rojo primero (aborta en `rechazar_cheque` inexistente), después verde.
- **Cartera:** vista `v_cheque_cartera` (security invoker): cheques de recibos **emitidos**, sin anulados, con cliente
  (razón social, CUIT, código: el filtro de clientes de siempre), número y fecha del recibo, y estado y número de la ND.
  Ventas → Cartera de cheques (`/cheques`): totales por estado (cantidad e importe, de lo que filtran fecha de pago y
  cliente; cada total filtra por su estado), filtros estado (por defecto en cartera, o todos), fecha de pago
  desde/hasta y cliente. Columnas fecha de pago, banco, número (al detalle), tipo, librador, cliente, importe, estado
  y, si está rechazado, "ND pendiente" o el número de la ND autorizada (enlazada), y el recibo.
- **Detalle** `/cheques/[id]`: datos, recibo, cliente, ND, historial (`cheque_estado`) y las acciones que admite el
  estado (`accionesDisponibles`, de `TRANSICIONES_CHEQUE`): depositar (fecha, observación), entregar (a quién,
  fecha, observación), rechazar (fecha, observación, gastos bancarios opcionales con descripción). Formularios con
  onSubmit + startTransition. Depositar/entregar actualizan el cheque (el trigger controla la transición y escribe el
  historial), con `estado` actual en el filtro para no pisar un cambio concurrente.
- **Rechazo atómico:** RPC `rechazar_cheque(p_cheque_id, p_fecha, p_observacion, p_gastos)` (security invoker, sólo
  authenticated). La ND se arma **en la base** (no llega armada desde la pantalla) y se guarda con
  `guardar_borrador_comprobante` en la misma transacción que el cambio de estado: ítem no gravado "Cheque rechazado
  N° … – Banco …"; gastos > 0 → ítem gravado al 21% (IVA redondeado a centavos); asociada a las facturas que canceló el
  recibo (misma letra; mezcla o sin letra → CB018) o, si fue a cuenta, al período del 1° del mes del recibo a su fecha
  (letra del cliente); cuenta corriente, fecha de hoy, electrónico activo más bajo y el ambiente que pone el guardado.
  Devuelve la ND y la pantalla abre su editor. `armarNotaDebitoRechazo` (TS, ahora con gastos) arma lo mismo y el
  detalle lo usa para mostrar antes qué ND se crea (o por qué no se puede).
- **"Obliga":** además de `cheque_rechazado_check`, el trigger `trg_comprobante_nd_cheque` impide borrar la ND de un
  cheque rechazado o cambiarle cliente o clase (CB020, mensaje legible en el editor de comprobantes). En el editor de la
  ND: "Nota de débito por cheque rechazado: revisala y autorizala" con enlace al cheque; en el detalle autorizado,
  "Nota de débito por el cheque N° … (Banco …)". Autorizada, es un débito más (pgTAP). Errores nuevos CB020 (ND de un
  rechazo), CB021 (cheque inexistente), CB022 (gastos inválidos).
- **Recibo:** en sus medios, cada cheque enlaza a su detalle con su estado actual.
- Lógica pura `src/lib/cobranzas/cartera.ts` (filtros, totales por estado en centavos, acciones, estado visible,
  validación del cambio) con Vitest.
- Tamaño: ~1100 líneas en la unidad B (SQL ~300, pgTAP ~230, pantallas ~550, lógica y tests ~350), por encima de las 400
  orientativas: listado, detalle con acciones y el RPC del rechazo van juntos para que el rechazo no quede sin pantalla.
- Checks: `npm test` 547 ok; `npm run typecheck` ok; `npm run lint` ok; `npm run build` ok (`/cheques`, `/cheques/[id]`);
  `supabase migration up --local` + `supabase test db` 608, falla sólo `arca_configuracion_test` 26 (conocida);
  `supabase db reset --local` + `supabase test db` 608 ok; datos locales restaurados. Recorrido por PostgREST local con
  JWT firmado: recibo a cuenta con cheque (CUIT con guiones guardada con dígitos), emitir, rechazar con gastos → ND A
  borrador de 621 (500 no gravado + 100 + 21) al período 2026-10-01..2026-10-18, cartera "rechazado / ND borrador",
  borrar la ND → CB020; UPDATE del contador → 42501. `next dev` con Supabase local: `/cheques` y `/cheques/[id]`
  responden 307 a /login, sin 500.

### T7 — Cuenta corriente del cliente y listado de saldos (18/10/2026)

- Commit: `9d2591c` feat(cobranzas): cuenta corriente del cliente y listado de saldos. Migración
  `20261029000001_cobranzas_cuenta_corriente.sql` (sólo local; falta `db push`). pgTAP en rojo primero (vista
  inexistente), después verde. Vitest de los ayudantes en rojo primero.
- **Vista** `v_cliente_cuenta_resumen` (security invoker; anon sin acceso): una fila por cliente con saldo ≠ 0, débitos
  pendientes o saldo a favor, con razón social, CUIT, `cuit_digitos` y código (el filtro de clientes de siempre), saldo,
  deuda pendiente, a favor, deuda más vieja y cantidad de pendientes. Un cliente con deuda y a favor a la vez aparece
  aunque su saldo neto sea cero (tiene algo que imputar). pgTAP: coincide con `v_cliente_saldo` y con los débitos con
  saldo; `saldo = pendientes − a favor` para cada cliente; un cliente sin nada no aparece.
- **Ficha del cliente** (sección "Cuenta corriente", `#cuenta-corriente`, componente `clientes/[id]/CuentaCorriente.tsx`):
  saldo actual (rojo deudor, azul a favor) con pendiente de cobro y a favor; pendientes (fecha, comprobante enlazado,
  total, saldo, días; del más viejo al más nuevo; "Contado – pago pendiente" si corresponde); movimientos de
  `v_cuenta_corriente` del más nuevo al más viejo con debe, haber y saldo acumulado (de toda la historia), filtro
  `cc_desde`/`cc_hasta` por GET (por defecto los últimos 12 meses), tope 500.
- **Ventas → Cuentas corrientes** (`/cuentas-corrientes`): cliente (a la sección de su ficha), saldo, a favor, deuda
  más vieja (fecha y días), pendientes; orden por saldo (por defecto) o antigüedad; filtro de texto; totales adeudado
  (suma de pendientes) y a favor de lo que se muestra.
- Lógica pura `src/lib/cobranzas/cuenta-corriente.ts` (antigüedad en días UTC, rango por defecto, filtros de la URL,
  orden, totales en centavos, estado del saldo) con Vitest.

### T8 — PDF del recibo y anulación (18/10/2026)

- Commit: `e18dfcf` feat(cobranzas): PDF del recibo con importe en letras y anulación. Vitest en rojo primero para
  `numeroEnLetras`; el resto con sus tests en el mismo commit.
- **Importe en letras** `numeroEnLetras` (`numero-letras.ts`): mayúsculas con tildes, "CON nn/100", apócope delante de
  MIL y MILLONES (VEINTIÚN MIL, UN MILLÓN, TREINTA Y UN MILLONES), CIEN/CIENTO, hasta 999.999.999.999,99; negativos, no
  finitos y un billón o más → RangeError. 40 casos.
- **PDF** (`pdf-recibo-datos.ts` puro + `pdf-recibo.ts` con pdf-lib): mismo encabezado que el comprobante (logo,
  emisor, recuadro "X" con "No válido como factura"), "RECIBO" con número y fecha, cliente (razón social, CUIT,
  domicilio, condición de IVA), "Recibimos de … la suma de pesos … ($ …)", observaciones, detalle de medios (efectivo;
  transferencia con banco y referencia; cheque/e-cheq con banco, número, fecha de pago y librador con CUIT; retención
  con tipo, jurisdicción, certificado y fecha), comprobantes cancelados (número, fecha, importe; "(saldo a favor)" en
  las automáticas) y pie con imputado, queda a favor (si > 0), total y firma. Anulado: marca "ANULADO" en cada página,
  fecha y motivo al principio, sin "queda a favor". Pagina con `paginar` (encabezado y cliente en todas, pie en la
  última). Se exportaron `crearSaneador`, `partirEnLineas`, `recortar` (`comprobantes/pdf.ts`) y `cargarLogo`
  (`comprobantes/pdf-descarga.ts`) para reusarlos.
- **Ruta** `/cobranzas/[id]/pdf`: columnas explícitas, 404 si no existe, 409 en borrador, `inline` con nombre
  `Recibo R-00001-00000001.pdf` (`pdf-recibo-descarga.ts`, Vitest con cliente simulado).
- **Anular recibo** (detalle emitido, `AnularRecibo.tsx`): modal con motivo obligatorio (≤ 500), los efectos (los
  comprobantes vuelven a pendiente —o la factura de contado a "Contado – pago pendiente"—, sus cheques salen de la
  cartera, el número no se reutiliza) y, si algún cheque ya no está en cartera, la lista con su estado y el botón
  deshabilitado. La acción `anularRecibo` llama a `anular_recibo`; CB010 → los cheques fuera de cartera con su estado
  (leídos después del error), CB019 → "Escribí el motivo…", CB002 → recargar. Al terminar, `?aviso=anulado`.
  Lógica pura en `anulacion.ts` con Vitest. pgTAP: anular un pago de contado deja la factura pendiente y se puede volver
  a pagar.
- Tamaño: unidad A ~260 líneas; T7 ~745; T8 ~1700 (la mitad son tests y fixtures). T7 y T8 superan las 400 orientativas:
  la vista, la sección de la ficha y el listado van juntos; el PDF, su ruta y la anulación cierran el recibo y partirlos
  dejaría el detalle con botones a medias.
- Checks (A, T7 y T8): `npm test` 641 ok; `npm run typecheck` ok; `npm run lint` ok; `npm run build` ok
  (`/cuentas-corrientes`, `/cobranzas/[id]/pdf`); `npx opennextjs-cloudflare build` ok (sin deploy);
  `supabase migration up --local` + `supabase test db` 623, falla sólo `arca_configuracion_test` 26 (conocida);
  `supabase db reset --local` + `supabase test db` 623 ok; datos locales restaurados. PostgREST local con JWT firmado:
  las consultas de las pantallas nuevas responden 200. `next dev` con Supabase local: `/cuentas-corrientes`,
  `/clientes/[id]`, `/cobranzas/[id]` y `/cobranzas/[id]/pdf` responden 307 a /login, sin 500. PDFs de muestra
  generados desde los fixtures (normal y anulado) y revisados a ojo.

## Próximo paso

- T9: recorrido completo en local (y con ARCA de homologación cuando vuelva). `db push` de las migraciones de
  cobranzas cuando se decida.

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
