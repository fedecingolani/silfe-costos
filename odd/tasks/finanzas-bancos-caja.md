# Finanzas: bancos y caja

Estado: en desarrollo.

## Objetivo

Llevar las cuentas bancarias y las cajas de la empresa con todos sus movimientos y su saldo, alimentados por los recibos, las órdenes de pago y los cheques, y con ajustes manuales.

## Problema

No existe ninguna cuenta de fondos. El banco es texto libre en `cheque.banco`, `recibo_medio.banco` y `orden_pago_medio.banco`. Cobrar en efectivo, pagar por transferencia o depositar un cheque no deja registro de a qué caja o cuenta entró o de cuál salió (`20261106000001_pagos_compra.sql`: "sin banco ni caja (Finanzas todavía no existe)"). El menú tiene Bancos y Caja como "Próximamente" (`src/components/nav.tsx`).

## Por qué

- Saber cuánta plata hay en cada caja y cada cuenta, y por qué.
- No cargar dos veces lo que ya se registra al cobrar y al pagar.
- Base para la conciliación bancaria (otra feature).

## Decisiones

- **Cuenta de fondos** (`cuenta_fondos`): tipo `banco` o `caja`, nombre, activa. Las de banco además tienen banco, número de cuenta, CBU y alias. Sólo pesos (todo el sistema está en pesos).
- **Movimientos**: una vista (`v_movimiento_fondos`) une todas las fuentes, con saldo acumulado por cuenta, igual que las cuentas corrientes. Positivo = ingreso. Lo anulado y los borradores no aparecen.
- **Ajuste manual**: ingreso o egreso con fecha, importe, concepto obligatorio y observación. No se borra ni se edita: se anula con motivo, para dejar rastro. El saldo inicial de cada cuenta se carga como ajuste.
- **Recibos**: el efectivo va a una caja y la transferencia a una cuenta bancaria; se elige en el editor y es obligatorio al emitir. Cheques, echeq y retenciones no mueven fondos al cobrar.
- **Órdenes de pago**: efectivo sale de una caja; transferencia y cheque propio, de una cuenta bancaria; obligatorio al confirmar. El cheque propio se debita en su fecha de pago (puede quedar como movimiento futuro).
- **Cheques de terceros**: depositar pide la cuenta destino y la acredita en la fecha de depósito. Si un cheque depositado se rechaza, se debita de esa cuenta.
- **Transferencia entre cuentas** (depósito de efectivo, extracción, pase entre bancos): un movimiento con cuenta origen y destino que genera dos patas.
- **Lo histórico** no se reasigna: los recibos y órdenes anteriores no tienen cuenta y no aparecen. El saldo arranca con el ajuste de saldo inicial.
- Saldo actual = movimientos hasta hoy. Los de fecha futura se muestran aparte.

## Tareas

Entrega: un PR por tarea, cada uno sobre la rama de la anterior, como en compras y en la API de compras.

- [ ] T1 Cuentas y ajustes manuales: esquema + RLS, vista de movimientos y saldos (sólo ajustes por ahora), pantallas Bancos y Caja (lista con saldo, alta/edición de cuenta, detalle con movimientos, ajuste y anulación). Rama `feat/finanzas-01-cuentas`.
- [ ] T2 Recibos: `recibo_medio.cuenta_id`, selector en el editor, obligatorio al emitir, movimientos en la vista. Rama `feat/finanzas-02-recibos`.
- [ ] T3 Órdenes de pago: `orden_pago_medio.cuenta_id`, selector en el editor, obligatorio al confirmar, cheque propio por fecha de pago. Rama `feat/finanzas-03-pagos`.
- [ ] T4 Cheques: cuenta destino al depositar, débito al rechazar un depositado. Rama `feat/finanzas-04-cheques`.
- [ ] T5 Transferencias entre cuentas. Rama `feat/finanzas-05-transferencias`.

## Verificación

- `npm run typecheck`, `npm run lint`, `npm test` en cada tarea.
- `supabase migration up --local` y `supabase test db` (pgTAP) con tests de la vista de movimientos y de las validaciones.
- Tests unitarios (Vitest) de la validación de formularios.
- Prueba en la app local de cada pantalla tocada.

## Progreso

Nada todavía.
