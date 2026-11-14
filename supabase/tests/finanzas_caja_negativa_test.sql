-- =====================================================================
-- Tests de la caja sin saldo negativo
-- (20261112000005_finanzas_caja_sin_negativo.sql): ninguna escritura que
-- baje el saldo de una caja (ajuste de egreso, anulación de un ajuste de
-- ingreso, transferencia desde la caja, anulación de una transferencia
-- hacia la caja, orden de pago con efectivo, anulación de un recibo con
-- efectivo) puede dejarla en negativo en ninguna fecha desde la del
-- movimiento, incluso con fecha pasada o futura. Los bancos sí pueden
-- quedar en negativo. Un ingreso siempre se acepta, aunque la caja siga en
-- negativo por datos anteriores a la regla. Corre con `supabase test db`.
-- Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

select has_function('public', 'fn_validar_caja_sin_negativo', array['uuid[]', 'date'],
  'Existe fn_validar_caja_sin_negativo(uuid[], date)');

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into proveedor (id, nombre) values ('fc000000-0000-4000-8000-000000000001', 'Proveedor caja negativa');
insert into cliente (id, razon_social, condicion_iva) values
  ('fc000000-0000-4000-8000-000000000002', 'Cliente caja negativa', 'Responsable Inscripto');

create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;
-- Nombres únicos: la base local puede tener cuentas cargadas a mano.
create temp table sufijo as select ' ' || gen_random_uuid()::text as texto;
grant select on hoy, sufijo to authenticated;

insert into cuenta_fondos (id, tipo, nombre, banco)
select 'fc100000-0000-4000-8000-000000000001', 'banco', 'Banco caja negativa' || texto, 'Banco Test' from sufijo;
insert into cuenta_fondos (id, tipo, nombre)
select v.id::uuid, 'caja', v.nombre || texto
from sufijo, (values
  ('fc100000-0000-4000-8000-000000000002', 'Caja ajustes'),
  ('fc100000-0000-4000-8000-000000000003', 'Caja con saldo previo negativo'),
  ('fc100000-0000-4000-8000-000000000004', 'Caja pagos'),
  ('fc100000-0000-4000-8000-000000000005', 'Caja recibos')) v(id, nombre);

-- Una caja que ya estaba en negativo antes de la regla: el egreso se carga
-- sin el trigger nuevo (como postgres, dueño de la tabla).
alter table ajuste_fondos disable trigger trg_ajuste_fondos_caja_egreso;
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
select 'fc100000-0000-4000-8000-000000000003', fecha - 5, 'egreso', 1500, 'Egreso anterior a la regla' from hoy;
alter table ajuste_fondos enable trigger trg_ajuste_fondos_caja_egreso;

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

-- Nombre de una caja de prueba, para el mensaje esperado.
create function pg_temp.caja(p_nombre text)
returns text
language sql
as $$ select p_nombre || texto from sufijo; $$;

-- Mensaje esperado de FN011.
create function pg_temp.mensaje(p_caja text, p_saldo text, p_dias integer)
returns text
language sql
as $$
  select format('La caja "%s" quedaría en $ %s el %s.', pg_temp.caja(p_caja), p_saldo, to_char(fecha + p_dias, 'DD/MM/YYYY'))
  from hoy;
$$;

-- Un ajuste en la caja de ajustes, p_dias desde hoy.
create function pg_temp.ajuste(p_tipo text, p_importe numeric, p_dias integer)
returns text
language sql
as $$
  select format($f$insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
                  values ('fc100000-0000-4000-8000-000000000002', %L, %L, %s, 'Prueba')$f$,
                fecha + p_dias, p_tipo, p_importe)
  from hoy;
$$;

-- El HINT de un error.
create function pg_temp.hint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;

-- ---------------------------------------------------------------------
-- Ajustes manuales
-- ---------------------------------------------------------------------

select lives_ok(pg_temp.ajuste('ingreso', 1000, -10), 'Saldo inicial de la caja: 1000 hace 10 días');
select throws_ok(
  pg_temp.ajuste('egreso', 1500, -5),
  'FN011', pg_temp.mensaje('Caja ajustes', '-500,00', -5),
  'Un egreso que deja la caja en negativo se rechaza, con la caja, el saldo y la fecha'
);
select is(pg_temp.hint(pg_temp.ajuste('egreso', 1500, -5)), 'caja_negativa', 'El HINT de FN011 es caja_negativa');
select lives_ok(pg_temp.ajuste('egreso', 1000, -5), 'Un egreso que deja la caja en cero se acepta');
select lives_ok(pg_temp.ajuste('ingreso', 800, -2), 'Un ingreso siempre se acepta');
-- Saldos: -10: 1000, -5: 0, -2: 800.
select throws_ok(
  pg_temp.ajuste('egreso', 300, -7),
  'FN011', pg_temp.mensaje('Caja ajustes', '-300,00', -5),
  'Un egreso con fecha pasada se rechaza si deja negativo un día posterior, aunque hoy el saldo alcance'
);
select throws_ok(
  pg_temp.ajuste('egreso', 900, 3),
  'FN011', pg_temp.mensaje('Caja ajustes', '-100,00', 3),
  'Un egreso con fecha futura también se rechaza si deja la caja en negativo'
);
select lives_ok(pg_temp.ajuste('egreso', 800, 0), 'Un egreso hasta el saldo de hoy se acepta');
-- Saldos: -10: 1000, -5: 0, -2: 800, 0: 0.
select throws_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = 'Prueba'
    where cuenta_id = 'fc100000-0000-4000-8000-000000000002' and tipo = 'ingreso' and importe = 800$$,
  'FN011', pg_temp.mensaje('Caja ajustes', '-800,00', 0),
  'Anular un ingreso que deja la caja en negativo se rechaza'
);
select lives_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = 'Prueba'
    where cuenta_id = 'fc100000-0000-4000-8000-000000000002' and tipo = 'egreso' and importe = 1000$$,
  'Anular un egreso siempre se acepta'
);
-- Saldos: -10: 1000, -2: 1800, 0: 1000.
select is(
  (select min(saldo) from v_movimiento_fondos where cuenta_id = 'fc100000-0000-4000-8000-000000000002'),
  1000::numeric,
  'Lo rechazado no quedó registrado'
);

-- ---------------------------------------------------------------------
-- Transferencias
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into transferencia_fondos (fecha, cuenta_origen_id, cuenta_destino_id, importe)
    select fecha, 'fc100000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 1500 from hoy$$,
  'FN011', pg_temp.mensaje('Caja ajustes', '-500,00', 0),
  'Una transferencia desde la caja que la deja en negativo se rechaza'
);
select lives_ok(
  $$insert into transferencia_fondos (fecha, cuenta_origen_id, cuenta_destino_id, importe)
    select fecha - 1, 'fc100000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 1000 from hoy$$,
  'Una transferencia desde la caja que la deja en cero se acepta'
);
-- Caja: -10: 1000, -2: 1800, -1: 800, 0: 0.
select lives_ok(
  $$insert into transferencia_fondos (fecha, cuenta_origen_id, cuenta_destino_id, importe, concepto)
    select fecha - 3, 'fc100000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000002', 300, 'Extracción'
    from hoy$$,
  'Una transferencia desde un banco a la caja se acepta'
);
select lives_ok(pg_temp.ajuste('egreso', 300, 0), 'La caja gasta lo extraído');
-- Caja: -10: 1000, -3: 1300, -2: 2100, -1: 1100, 0: 0.
select throws_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = 'Prueba'
    where cuenta_destino_id = 'fc100000-0000-4000-8000-000000000002'$$,
  'FN011', pg_temp.mensaje('Caja ajustes', '-300,00', 0),
  'Anular una transferencia hacia la caja que la deja en negativo se rechaza'
);
select lives_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = 'Prueba'
    where cuenta_origen_id = 'fc100000-0000-4000-8000-000000000002'$$,
  'Anular una transferencia desde la caja se acepta (la devuelve)'
);

-- ---------------------------------------------------------------------
-- Los bancos sí pueden quedar en negativo
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto)
    values ('fc100000-0000-4000-8000-000000000001', 'egreso', 100000, 'Descubierto')$$,
  'Un egreso que deja un banco en negativo se acepta (descubierto)'
);
select ok(
  (select saldo_actual < 0 from v_cuenta_fondos_saldo where cuenta_id = 'fc100000-0000-4000-8000-000000000001'),
  'El banco queda en negativo'
);

-- ---------------------------------------------------------------------
-- Caja que ya estaba en negativo antes de la regla
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
    select 'fc100000-0000-4000-8000-000000000003', fecha - 1, 'ingreso', 500, 'Corrección parcial' from hoy$$,
  'Un ingreso en una caja que sigue en negativo se acepta'
);
select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
    select 'fc100000-0000-4000-8000-000000000003', fecha, 'egreso', 10, 'Gasto' from hoy$$,
  'FN011', pg_temp.mensaje('Caja con saldo previo negativo', '-1.010,00', 0),
  'Un egreso en una caja en negativo se rechaza hasta corregirla'
);
select lives_ok(
  $$insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
    select 'fc100000-0000-4000-8000-000000000003', fecha, 'ingreso', 2000, 'Corrección' from hoy$$,
  'Se corrige con un ingreso'
);
select lives_ok(
  $$insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
    select 'fc100000-0000-4000-8000-000000000003', fecha + 1, 'egreso', 10, 'Gasto' from hoy$$,
  'Corregida, un egreso posterior se acepta aunque el pasado siga en negativo'
);

-- ---------------------------------------------------------------------
-- Órdenes de pago con efectivo
-- ---------------------------------------------------------------------

insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
select 'fc100000-0000-4000-8000-000000000004', fecha - 1, 'ingreso', 100, 'Saldo inicial' from hoy;

create function pg_temp.orden(p_importe numeric, p_tipo text, p_cuenta uuid)
returns uuid
language sql
as $$
  select guardar_orden_pago(null,
    jsonb_build_object('proveedor_id', 'fc000000-0000-4000-8000-000000000001', 'fecha', fecha),
    jsonb_build_array(jsonb_build_object('tipo', p_tipo, 'importe', p_importe, 'cuenta_id', p_cuenta,
      'referencia', case when p_tipo = 'transferencia' then 'TR-1' end)),
    '[]')
  from hoy;
$$;

create temp table op as
select pg_temp.orden(150, 'efectivo', 'fc100000-0000-4000-8000-000000000004') as excede,
       pg_temp.orden(100, 'efectivo', 'fc100000-0000-4000-8000-000000000004') as alcanza,
       pg_temp.orden(5000, 'transferencia', 'fc100000-0000-4000-8000-000000000001') as banco;

select throws_ok(
  format('select confirmar_orden_pago(%L)', (select excede from op)),
  'FN011', pg_temp.mensaje('Caja pagos', '-50,00', 0),
  'Confirmar una orden con más efectivo que el saldo de la caja se rechaza'
);
select is(
  (select estado from orden_pago where id = (select excede from op)),
  'borrador',
  'La orden rechazada sigue en borrador'
);
select lives_ok(
  format('select confirmar_orden_pago(%L)', (select alcanza from op)),
  'Confirmar una orden con efectivo hasta el saldo de la caja se acepta'
);
select lives_ok(
  format('select confirmar_orden_pago(%L)', (select banco from op)),
  'Una transferencia desde un banco sin saldo se confirma (los bancos no se limitan)'
);

-- ---------------------------------------------------------------------
-- Anulación de un recibo con efectivo
-- ---------------------------------------------------------------------

create temp table rc as
select guardar_borrador_recibo(null,
  jsonb_build_object('cliente_id', 'fc000000-0000-4000-8000-000000000002', 'fecha', fecha - 3),
  jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 200, 'cuenta_id', 'fc100000-0000-4000-8000-000000000005')),
  '[]'::jsonb) as id
from hoy;
select emitir_recibo(id) from rc;
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
select 'fc100000-0000-4000-8000-000000000005', fecha - 1, 'egreso', 150, 'Gasto' from hoy;
-- Caja: -3: 200, -1: 50.

select throws_ok(
  format('select anular_recibo(%L, %L)', (select id from rc), 'Prueba'),
  'FN011', pg_temp.mensaje('Caja recibos', '-150,00', -1),
  'Anular un recibo cuyo efectivo ya se gastó deja la caja en negativo: se rechaza'
);
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
select 'fc100000-0000-4000-8000-000000000005', fecha - 2, 'ingreso', 150, 'Reposición' from hoy;
select lives_ok(
  format('select anular_recibo(%L, %L)', (select id from rc), 'Prueba'),
  'Con saldo suficiente, el recibo se anula'
);

select * from finish();
rollback;
