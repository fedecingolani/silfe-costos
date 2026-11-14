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

- [x] T1 Cuentas y ajustes manuales: esquema + RLS, vista de movimientos y saldos (sólo ajustes por ahora), pantallas Bancos y Caja (lista con saldo, alta/edición de cuenta, detalle con movimientos, ajuste y anulación). Rama `feat/finanzas-01-cuentas`.
- [x] T2 Recibos: `recibo_medio.cuenta_id`, selector en el editor, obligatorio al emitir, movimientos en la vista. Rama `feat/finanzas-02-recibos`.
- [ ] T3 Órdenes de pago: `orden_pago_medio.cuenta_id`, selector en el editor, obligatorio al confirmar, cheque propio por fecha de pago. Rama `feat/finanzas-03-pagos`.
- [ ] T4 Cheques: cuenta destino al depositar, débito al rechazar un depositado. Rama `feat/finanzas-04-cheques`.
- [ ] T5 Transferencias entre cuentas. Rama `feat/finanzas-05-transferencias`.

## Verificación

- `npm run typecheck`, `npm run lint`, `npm test` en cada tarea.
- `supabase migration up --local` y `supabase test db` (pgTAP) con tests de la vista de movimientos y de las validaciones.
- Tests unitarios (Vitest) de la validación de formularios.
- Prueba en la app local de cada pantalla tocada.

## Progreso

### T1 Cuentas y ajustes manuales — hecho

- Commit `8dac711` en `feat/finanzas-01-cuentas`. Ruta: delegada (un writer; migraciones, tests y varias pantallas).
- Migraciones `20261111000001_finanzas_cuentas.sql` y `20261111000002_rls_finanzas_cuentas.sql`. Códigos FN001 a FN006 (ajuste inmutable, nace anulado, no se borra, cuenta inactiva, motivo requerido, tipo de cuenta inmutable).
- El tipo de cuenta no se cambia. Anular es un update de `estado` y motivo; el trigger completa `anulado_en`. "Hoy" es la fecha de Argentina, como en el resto de las vistas.
- Código compartido en `src/app/(app)/finanzas/` (sin `page.tsx`); `bancos/` y `caja/` son envoltorios que pasan el tipo.
- Más grande que la heurística de 400 líneas (unas 1800 con tests y pantallas): es el esquema base más dos pantallas completas; partirlo no hacía más fácil la revisión.
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1267 pasan (RED observado: los 3 archivos de test fallaban sin los módulos); `supabase migration up --local` ok; `supabase test db` 1442 pasan (38 nuevos).
- Revisión nativa: la primera vez el usuario la salteó; con los arreglos de pantalla la pidió (granted), lente de confiabilidad, aprobada y acusada (`review-2c47ed3ae43b9218`).
- Observaciones no bloqueantes de esa revisión:
  - Importe "150.000" sin coma se leía como 150. Corregido en `0d0afc0`: sin coma, los puntos en grupos de tres son de miles (test RED → GREEN, probado en pantalla con "2.000").
  - Pendiente (sugerencia): la cabecera de movimientos futuros en `PaginaCuenta.tsx` no refleja el rango filtrado.

### T2 Recibos — hecho

- Rama `feat/finanzas-02-recibos` (sobre T1). Ruta: delegada (un writer; migración, tests de base, editor y detalle).
- Migración `20261111000003_finanzas_recibos.sql`: `recibo_medio.cuenta_id`; códigos FN007 (falta la cuenta al emitir), FN008 (tipo de cuenta distinto al medio), FN009 (cheque, echeq o retención con cuenta); FN004 (cuenta inactiva) se reusa. Un trigger valida cada medio y otro sólo el paso de borrador a emitido.
- Transferencia: `guardar_borrador_recibo` completa `banco` con el nombre de la cuenta, así el detalle y el PDF siguen sin cambios y el recibo conserva el nombre de ese momento.
- `v_movimiento_fondos`: un movimiento por recibo y por cuenta (dos efectivos a la misma caja suman), con link a `/cobranzas/<id>`.
- Un borrador cuya cuenta se desactivó pierde esa selección al reabrirlo (toma la única cuenta del tipo, o ninguna).
- `finanzas_cuentas_test.sql` usa un nombre de cuenta único para no chocar con datos de la base local.
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1282 pasan; `supabase migration up --local` ok; `supabase test db` 1476 pasan (RED observado: 33 de 34 checks nuevos fallaban sin la migración).
- Revisión nativa (T1 + T2): pedida (granted), lente de confiabilidad, aprobada y acusada (`review-4791fcbbf778a9e0`). Observación WARNING corregida en `4c2f12b`: el test de borrador contaba recibos de toda la base. Quedan como sugerencias: validar `tipo` en `finanzas/acciones.ts:105`, nombres de fixtures, y un test del `banco` que se completa con el nombre de la cuenta.
- Falla ajena a esta rama: `pagos_compra_test.sql` tests 87-89 fallan entre las 21 y las 24 hs de Argentina (en UTC ya es el día siguiente; CB018 en `rechazar_cheque`). Ni el test ni la función se tocan acá; pasan en horario normal.
- Probado en la app local: el editor preselecciona la única caja y el único banco; recibo de $35.000 (10.000 en efectivo + 25.000 por transferencia) emitido; aparece en Caja y en Bancos con su saldo y link al recibo; al anularlo desaparece de los dos.
- Probado en la app local con el usuario del seed: alta de cuenta bancaria (rechaza CBU de 5 dígitos), alta de caja (sin campos bancarios), ajuste de ingreso y de egreso con saldo acumulado, anulación (exige motivo y saca el ajuste del saldo), `/caja/<id de banco>` da 404. Corregido en la prueba: el diálogo de anular heredaba `whitespace-nowrap` de la celda y se cortaba en pantallas angostas; "1 cuentas" pasó a singular.
