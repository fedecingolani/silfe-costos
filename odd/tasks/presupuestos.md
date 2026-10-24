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
- [x] **T2 — Lógica pura.** `src/lib/presupuestos/`: armado y validación del borrador
  (reutilizando `calculo.ts`), número visible, vencido, datos de conversión. Con tests.
- [x] **T3 — Extraer componentes del editor de comprobantes.** Tabla de ítems y campos
  comerciales de cabecera a componentes reutilizables, sin cambio de comportamiento.
- [ ] **T4 — Pantallas.** Listado, nuevo, detalle/edición, acciones (guardar, borrar,
  duplicar), entrada en el menú Ventas.
- [ ] **T5 — Convertir en factura.** Acción, botón en el detalle, vínculo visible en la
  factura.
- [ ] **T6 — PDF del presupuesto.**

## Entrega

- Pronóstico: ~1500 líneas → `ask-on-risk`. Estrategia de cadena elegida: **`feature-branch-chain`**.
- `feat/presupuestos` = rama integradora (PR tracker en draft, no se mergea hasta el final).
- Cadena (cada PR apunta a la rama anterior):

```
main ← feat/presupuestos (tracker, draft)
        ← 01-db (T1) ← 02-logica (T2) ← 03-editor (T3) ← 04-pantallas (T4) ← 05-conversion-pdf (T5+T6)
```

- PR 01-db: ~1040 líneas (migración + pgTAP, no se parte sin romper cohesión) → pedir `size:exception`.
- Push y apertura de PRs: decisión del usuario.

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
| T2 | delegada (writer: lib nueva + extracción `armarItems`/`totalesDeItems` en comprobantes) | vitest presupuestos RED (módulos inexistentes) → 33/33; `npm test` 678 PASS (re-corrido por el padre), tsc y lint limpios | 116e35d |
| T3 | delegada (writer: 3 archivos nuevos + editor de 998 → ~530 líneas) | refactor sin RED de UI; `filas.test.ts` 10 tests; `npm test` 688 PASS (re-corrido por el padre), tsc y lint limpios; `next build` no corrido (dev server activo); prueba manual en /comprobantes/nuevo: producto fuera de lista avisa, 2×1000 = $2.000 + IVA $420, contado bloquea vencimiento = fecha, agregar/quitar ítem, consola sin errores | ver git log |

## Revisión

- T1: riesgo medio, `slice_budget_reached`. Revisión nativa **pendiente**: el preflight pide declarar
  un archivo sin trackear ajeno a la feature (`src/app/(app)/configuracion/arca/guia/page.tsx`).
- T2: riesgo medio, `slice_budget_reached` (791 líneas). Revisión nativa **pendiente** por el mismo motivo.
- PR 02-logica: ~776 líneas (la mitad son tests; lib + tests cohesivos) → `size:exception`.

## Próximo paso

T4 — Pantallas, en `feat/presupuestos-04-pantallas`.
