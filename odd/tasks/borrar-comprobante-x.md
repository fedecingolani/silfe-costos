# Borrar comprobantes X emitidos

> Estado: en curso (02/11/2026). Rama: `feat/borrar-comprobante-x` (desde `main`).

## Objetivo

Poder borrar un comprobante X ya emitido (autorizado) siempre que no tenga otros
comprobantes asociados. Hoy sólo se borran borradores y rechazados.

## Problema y por qué

Un X no es fiscal: no tiene CAE ni se informa a ARCA, así que un error de carga se corrige
borrándolo. `fn_comprobante_borrar` lo impide para cualquier autorizado.

## Reglas de negocio (decididas el 02/11/2026)

- Sólo un X autorizado (letra `X`). Los A/B autorizados siguen sin borrarse (se anulan con NC).
- Lo bloquea cualquier comprobante que dependa de él:
  - un recibo con imputación manual (`imputacion.automatica = false`) a ese X;
  - un recibo de contado de ese X (`recibo.comprobante_contado_id`);
  - una nota asociada a ese X (`comprobante_asociado.asociado_id`);
  - la ND de un cheque rechazado (`cheque.nd_comprobante_id`);
  - a futuro (remitos, etc.): cualquier FK `on delete restrict` hacia `comprobante`.
- Las imputaciones automáticas se deshacen y el saldo vuelve a quedar a favor del cliente:
  - las del saldo a favor aplicado a ese X (`comprobante_id = X and automatica`);
  - si el X es una NC, todas sus imputaciones (`nota_credito_id = X`).
- Un presupuesto convertido en ese X vuelve a abierto (ya lo hace el `on delete set null`).
- La numeración X es `max + 1`: si se borra el último, su número se reutiliza.

## Tareas

- [x] T1 — Base: migración que habilita el borrado del X y deshace las automáticas, con tests pgTAP. Commit `8749415`.
- [x] T2 — App: acción de borrar para X autorizado, mensajes de error y botón en el detalle. Commit `1663f11`.

## Checks

`supabase test db`, `npm run test`, `npm run typecheck`, `npm run lint`, prueba en la app.

## Progreso

- Ruta: T1+T2 delegadas a un writer (migración + test + acción + UI: 2+ archivos no triviales).
- T1 (`8749415`): `20261102000001_comprobante_x_borrar.sql` redefine `fn_comprobante_borrar` y
  `fn_imputacion_validar`. Error nuevo CM010 `comprobante_con_asociados` (CM009 ya era
  `comprobante_x_invalido`). Las automáticas se borran con la marca `comprobante.borrando`.
  RED: `comprobante_x_borrar_test.sql` falló 14/19 antes de la migración; GREEN: 19/19.
- T2 (`1663f11`): `borrarBorrador` pasa a `borrarComprobante` (acepta borrador, rechazado o
  X autorizado); `mensajeErrorGuardado` muestra el mensaje de CM010 y traduce el 23503 de un
  borrado; botón «Borrar» con confirmación en el detalle de un X emitido. RED: 2 tests de
  vitest fallaron antes del cambio; GREEN después.
- Evidencia (02/11/2026):
  - `supabase test db`: el test nuevo pasa 19/19; `cobranzas_test.sql` y
    `comprobantes_test.sql` abortan por un problema previo (insertan letra A en puntos de
    venta no electrónicos, que el X rechaza con CM008 desde `20261030000003`), igual sin
    este cambio. El resto pasa.
  - `npm run test`: 763/763.
  - `npm run typecheck`: 6 errores, todos en tipos viejos de `.next/` (rutas de empresa de
    otra rama); ninguno en `src/`.
  - `npm run lint`: sin errores.
  - Pendiente: prueba en la app.
- Siguiente: arreglar los fixtures de `cobranzas_test.sql` y `comprobantes_test.sql` (letra X
  en los puntos no electrónicos) y probar en la app.
