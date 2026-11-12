# Finanzas: bancos y caja

Estado: T1 a T5 hechas y revisadas; sin pushear.

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
- [x] T3 Órdenes de pago: `orden_pago_medio.cuenta_id`, selector en el editor, obligatorio al confirmar, cheque propio por fecha de pago. Rama `feat/finanzas-03-pagos`.
- [x] T4 Cheques: cuenta destino al depositar, débito al rechazar un depositado. Rama `feat/finanzas-04-cheques`.
- [x] T6 Caja sin saldo negativo: ningún movimiento (ajuste, orden de pago, transferencia, anulación de un ingreso) puede dejar una caja en negativo en ninguna fecha. Rama `feat/finanzas-06-caja-sin-negativo`.
- [x] T5 Transferencias entre cuentas. Rama `feat/finanzas-05-transferencias`.

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

### T3 Órdenes de pago — hecho

- Commit `1c72ef7` en `feat/finanzas-03-pagos` (sobre T2). Ruta: delegada (un writer; mismo diseño que T2).
- Migración `20261112000001_finanzas_pagos.sql`: `orden_pago_medio.cuenta_id`. Efectivo → caja; transferencia y cheque propio → banco; cheque de tercero sin cuenta. Sin códigos nuevos: FN004, FN007, FN008 y FN009 con mensajes para pagos. `confirmar_orden_pago` no se tocó.
- Cheque propio: `guardar_orden_pago` completa `banco` con el banco de la cuenta. Se debita en su `fecha_pago` (puede ser futuro); efectivo y transferencia en la fecha de la orden.
- `v_movimiento_fondos`: un egreso por orden, cuenta y fecha; una orden puede tener varias filas en la misma cuenta (la clave de React incluye la fecha).
- Selector compartido `src/app/(app)/finanzas/SelectorCuenta.tsx`. El editor de recibos sigue con su propia copia (pendiente unificar).
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1291 pasan (RED observado en helpers y errores); `supabase migration up --local` ok; `supabase test db` 1513 pasan (37 nuevos, RED observado).
- Probado en la app local: caja y banco preseleccionados; confirmar sin caja muestra "Medio 1: elegí la caja."; OP-00000002 ($1.500 efectivo + cheque propio $2.000 al 15/12/2026) sale de la caja y el cheque queda en movimientos futuros del banco. La anulación sólo se probó en pgTAP.
- Detalle cosmético pendiente: en una fila de cheque propio el botón "Quitar" baja a una segunda línea.

### T4 Cheques — hecho

- Commit `38877b0` en `feat/finanzas-04-cheques` (sobre T3). Ruta: delegada (un writer).
- Migración `20261112000002_finanzas_cheques.sql`: `cheque.deposito_cuenta_id`; trigger `trg_cheque_validar_deposito` (después de `trg_cheque_validar`) exige banco activo al depositar y no deja poner ni cambiar la cuenta fuera del depósito. Reusa FN004, FN007, FN008 y FN009 con mensajes de cheques.
- Fechas de depósito y rechazo salen del historial `cheque_estado` (`estado_fecha` se pisa en cada cambio). Un cheque sólo sale de `depositado` hacia `rechazado`; `rechazar_cheque` ya lo permitía y no se cambió. El rechazo debita aunque la cuenta se haya desactivado después.
- `v_movimiento_fondos`: orígenes `cheque_deposito` (ingreso) y `cheque_rechazo` (egreso), link a `/cheques/<id>`. `origen` pasa a ser el último desempate del orden (depósito y rechazo comparten `origen_id`).
- El editor de recibos usa el `SelectorCuenta` compartido. El de órdenes de pago todavía usa la prop vieja `tipo` (pendiente menor).
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1297 pasan (RED observado); `supabase migration up --local` ok; `supabase test db` 1539 pasan (26 nuevos, RED observado).
- Probado en la app local: depositar pide la cuenta bancaria (preseleccionada), el banco muestra "Depósito cheque N° 777001" con link y el cheque muestra "Depositado en". El rechazo no se probó en la app (el cliente de prueba no tiene condición de IVA, que exige la nota de débito); lo cubre pgTAP.

### T5 Transferencias — hecho

- Commit `36a2585` en `feat/finanzas-05-transferencias` (sobre T4). Ruta: delegada (un writer).
- Migraciones `20261112000003_finanzas_transferencias.sql` y `20261112000004_rls_finanzas_transferencias.sql`: tabla `transferencia_fondos`, mismas reglas que los ajustes (inmutable, se anula con motivo, no se borra). Código nuevo FN010 (misma cuenta en origen y destino); FN001 a FN005 reusados.
- `v_movimiento_fondos`: dos patas por transferencia ("Transferencia a …" egreso, "Transferencia desde …" ingreso), con link a la otra cuenta. Se anula desde cualquiera de las dos.
- `validarImporte` compartido entre ajustes y transferencias. `AnularAjuste` también anula transferencias (renombrarlo queda pendiente).
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1309 pasan (RED observado); `supabase migration up --local` ok; `supabase test db` 1571 pasan (32 nuevos, RED observado).
- Probado en la app local: transferencia de "1.000" de la caja al banco aparece en las dos cuentas; anulada desde el banco desaparece de las dos.

## Revisión de T3 a T5

La revisión de toda la feature junta excedió el límite de contexto del revisor (`lens_context_budget_exceeded`), así que se revisó un tramo por rama, cada uno con su permiso. Las tres quedaron aprobadas y acusadas, todas con la lente de confiabilidad.

- T3 (`review-97347363e6fe4c28`): WARNING corregida en `6939ab2` (el fixture usaba `current_date`, en UTC); T4 y T5 se rebasearon encima.
- T4: WARNING descartada. El trigger de depósito no falla abierto con una cuenta inexistente porque la clave foránea lo rechaza igual. Sugerencias: probar más ramas del trigger y el estado vacío de bancos en el detalle del cheque.
- T5: WARNING corregida en `f36675e`. `cargarTransferencias` arma la consulta en lotes de 100 ids, porque hasta 500 ids en la URL podían pasar el límite del gateway. Sugerencias: tests de las acciones y de los mensajes de error.

## Pendientes y preguntas abiertas

- Caja en negativo: el usuario decidió bloquearlo (T6).
- Movimientos futuros en el detalle no siguen el rango filtrado.
- `EditorOrdenPago` usa la prop vieja `tipo` de `SelectorCuenta`; en una fila de cheque propio el botón "Quitar" baja de línea.
- Sugerencias de la revisión de T1+T2: validar `tipo` en `finanzas/acciones.ts`, test del `banco` completado con el nombre de la cuenta.

### T6 Caja sin saldo negativo — hecho

- Commit `2269c90` en `feat/finanzas-06-caja-sin-negativo` (sobre T5). Ruta: delegada (un writer). Decisión del usuario: bloquear, no sólo avisar. Los bancos no tienen esta restricción.
- Migración `20261112000005_finanzas_caja_sin_negativo.sql`: `fn_validar_caja_sin_negativo`, llamada desde triggers AFTER con condición WHEN, sólo en lo que baja el saldo: egreso o anulación de un ingreso en ajustes, transferencia que sale o anulación de una que entra, confirmación de una orden de pago, anulación de un recibo. Código FN011 (`caja_negativa`): 'La caja "X" quedaría en $ -1.500,00 el 12/11/2026.'
- Regla: se rechaza si algún movimiento desde la fecha de la escritura queda por debajo de cero. Los ingresos nunca se validan (corrigen una caja que ya estaba negativa). Bloqueo con advisory lock por caja, porque subir el `for share` a `for update` provocaba deadlocks.
- Caso borde con datos negativos previos a la regla: un egreso en una fecha donde ya había un punto negativo se rechaza, y el mensaje muestra ese punto viejo. Pasó con la caja de prueba local; en producción no hay cajas negativas previas.
- Tres tests existentes ahora cargan un saldo inicial en su caja de prueba.
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1314 pasan (RED observado); `supabase migration up --local` ok; `supabase test db` 1601 pasan (30 nuevos, RED observado).
- Probado en la app local: egreso en la caja negativa rechazado con el mensaje; ingreso aceptado (la caja pasó a $ 8.500); transferencia de $ 9.000 desde la caja rechazada.
