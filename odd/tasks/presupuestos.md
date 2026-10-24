# Presupuestos de venta — SPEC

> Estado: **spec cerrada, en implementación** (decisiones tomadas el 24/10/2026).
> Rama: `feat/presupuestos`.

## Objetivo

Cargar, consultar, imprimir y **convertir en factura** presupuestos de venta, con los mismos
campos comerciales que una factura (`comprobantes`).

## Problema y por qué

Hoy no hay forma de emitir un presupuesto desde la app. Cuando el cliente lo acepta, hay que
volver a cargar todo como factura. Con los mismos campos que la factura, la conversión es una
copia directa.

## Alcance

**Entra:** CRUD de presupuestos, listado, detalle, PDF, duplicar y convertir en borrador de
factura.

**No entra:** envío por mail, estados de seguimiento comercial (enviado/aceptado/rechazado),
conversión parcial, moneda extranjera.

## Decisiones

- **Tablas propias** (`presupuesto`, `presupuesto_item`), no una `clase` más en `comprobante`.
  La tabla `comprobante` es fiscal (punto de venta y clase obligatorios, triggers de ARCA);
  aflojarla pone en riesgo la facturación. Contra: un campo nuevo en factura hay que agregarlo
  también acá.
- Se reutiliza la lógica pura de comprobantes (`calculo.ts`, precios por lista) y los
  componentes de UI (buscador de clientes, tabla de ítems), extrayéndolos del editor.

## Reglas de negocio

### Ciclo de vida

| Estado | Se puede | No se puede |
| --- | --- | --- |
| `abierto` | crear, editar, duplicar, borrar, imprimir, convertir | — |
| `convertido` | ver, imprimir, duplicar, ir a la factura | editar, borrar, volver a convertir |

- Se convierte **una sola vez**.
- Si el borrador de factura generado se borra, el presupuesto vuelve a `abierto` (el vínculo
  se pierde con `on delete set null`).

### Numeración

- Correlativo interno, asignado al crear: se muestra como `P-00000001`.
- Sin punto de venta, letra ni ARCA.

### Campos (iguales a factura, menos los fiscales)

- Cabecera: cliente, fecha, **válido hasta** (por defecto fecha + 15 días, debe ser ≥ fecha),
  vencimiento del pago, condición de pago, lista de precios, observaciones.
- Ítems: producto o ítem libre, código, descripción, observaciones, unidad, cantidad, precio
  unitario sin IVA (4 decimales), % descuento, gravado, alícuota, importe, IVA.
- Totales: neto, no gravado, IVA, total. Se calculan igual que en factura.
- Un presupuesto vencido se marca como tal pero se puede convertir igual.

### Convertir en factura

- Crea un **borrador** de factura (`clase = factura`) con cliente, lista, condición de pago,
  observaciones e ítems copiados tal cual (sin recalcular precios), fecha de hoy.
- Punto de venta: el primer electrónico activo (mismo criterio que "Duplicar").
- La letra se resuelve en la factura como siempre; se autoriza en ARCA desde la factura.
- El presupuesto queda `convertido` y guarda `comprobante_id`. La factura muestra "Generada
  desde el presupuesto P-…".
- Todo en una sola transacción (RPC).

### Impresión

- Mismo formato que la factura, titulado "Presupuesto", con número `P-…` y "válido hasta".
- Sin CAE, sin QR, sin letra.

## Checklist

- [x] **T1 — Base de datos.** Migración `presupuesto` + `presupuesto_item` (+ secuencia de
  número, triggers de inmutabilidad y de vuelta a `abierto`), RPC
  `guardar_presupuesto` y `convertir_presupuesto`, migración RLS, tests pgTAP.
- [ ] **T2 — Lógica pura.** `src/lib/presupuestos/`: armado y validación del borrador
  (reutilizando `calculo.ts`), número visible, vencido, datos de conversión. Con tests.
- [ ] **T3 — Extraer componentes del editor de comprobantes.** Tabla de ítems y campos
  comerciales de cabecera a componentes reutilizables, sin cambio de comportamiento.
- [ ] **T4 — Pantallas.** Listado, nuevo, detalle/edición, acciones (guardar, borrar,
  duplicar), entrada en el menú Ventas.
- [ ] **T5 — Convertir en factura.** Acción, botón en el detalle, vínculo visible en la
  factura.
- [ ] **T6 — PDF del presupuesto.**

## Entrega

- Pronóstico: ~1500 líneas (más de 400) → estrategia `ask-on-risk`; estrategia de cadena
  pendiente de elegir.

## Criterios de aceptación

- Se crea, edita, duplica y borra un presupuesto abierto con los mismos campos que una factura.
- Un presupuesto convertido no se puede editar, borrar ni volver a convertir (lo impide la base).
- Convertir genera un borrador de factura idéntico en cliente, ítems y totales, y lo enlaza.
- Borrar ese borrador devuelve el presupuesto a `abierto`.
- El PDF sale con número `P-…`, sin CAE ni QR.
- Los presupuestos no aparecen en comprobantes, saldos ni cuentas corrientes.

## Checks

- `npm test` (vitest), `npx tsc --noEmit`, `npm run lint`.
- `supabase test db supabase/tests/presupuestos_test.sql` y `comprobantes_test.sql`.

## Progreso

| Tarea | Ruta | Evidencia | Commit |
| --- | --- | --- | --- |
| T1 | delegada (writer: 3 archivos nuevos, SQL no trivial) | pgTAP presupuestos 78/78 (RED antes de migrar), comprobantes 165/165, suite 701 PASS; re-corrido presupuestos por el padre: PASS | be4f703 |

## Revisión

- T1: riesgo medio, `slice_budget_reached`. Revisión nativa **pendiente**: el preflight pide declarar
  un archivo sin trackear ajeno a la feature (`src/app/(app)/configuracion/arca/guia/page.tsx`).

## Próximo paso

T2 — Lógica pura (tras elegir estrategia de cadena).
