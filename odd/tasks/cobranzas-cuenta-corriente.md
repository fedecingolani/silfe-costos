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
| T1 | Comprobantes: ítem no gravado (`ImpTotConc`), `PeriodoAsoc`, PDF y tests | delegada (writer) | [ ] |
| T2 | Esquema: recibo, medios, cheque, historial, imputación, vistas de saldo y cuenta corriente, inmutabilidad y RLS (pgTAP en rojo primero) | delegada (writer) | [ ] |
| T3 | Lógica pura: validación de recibo, imputación, saldo a favor y transiciones de cheques (Vitest) | delegada (writer) | [ ] |
| T4 | Cobranza de cuenta corriente y pago de contado: pantallas y acciones, emisión con número | delegada (writer) | [ ] |
| T5 | Saldo a favor automático al autorizar, imputación de NC y estado de pago en comprobantes | delegada (writer) | [ ] |
| T6 | Cartera de cheques con estados, y rechazo con ND obligatoria | delegada (writer) | [ ] |
| T7 | Cuenta corriente: ficha del cliente y listado general | delegada (writer) | [ ] |
| T8 | PDF del recibo y anulación | delegada (writer) | [ ] |
| T9 | Recorrido completo en local (y con ARCA de homologación cuando vuelva) | orquestador | [ ] |

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
