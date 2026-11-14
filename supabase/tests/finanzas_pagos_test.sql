-- =====================================================================
-- Tests de las órdenes de pago en las cuentas de fondos
-- (20261112000001_finanzas_pagos.sql): cuenta por medio de pago (caja
-- para el efectivo, banco para la transferencia y el cheque propio,
-- ninguna para el cheque de terceros), obligatoria al confirmar, sólo
-- activas; egresos de las órdenes confirmadas en v_movimiento_fondos con
-- el saldo acumulado; el cheque propio se debita en su fecha de pago (un
-- movimiento futuro); los borradores y las anuladas no aparecen; las
-- órdenes históricas sin cuenta siguen valiendo. Corre con
-- `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_column('public', 'orden_pago_medio', 'cuenta_id', 'orden_pago_medio tiene cuenta_id');
select col_is_fk('public', 'orden_pago_medio', 'cuenta_id', 'orden_pago_medio.cuenta_id es una clave foránea');
select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.orden_pago_medio'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                         where attrelid = 'public.orden_pago_medio'::regclass and attname = 'cuenta_id')]),
  'r',
  'Una cuenta con medios de órdenes de pago no se borra (restrict)'
);

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into proveedor (id, nombre) values ('fd000000-0000-4000-8000-000000000001', 'Proveedor fondos pagos');
insert into cliente (id, razon_social, condicion_iva) values
  ('fd000000-0000-4000-8000-000000000002', 'Cliente fondos pagos', 'Responsable Inscripto');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;
create temp table op (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from op where nombre = p_nombre; $$;

-- Nombres únicos: la base local puede tener cuentas cargadas a mano.
create temp table sufijo as select ' ' || gen_random_uuid()::text as texto;

insert into cuenta_fondos (id, tipo, nombre, banco)
select 'fd100000-0000-4000-8000-000000000001', 'banco', 'Banco pagos' || texto, 'Banco Galicia' from sufijo;
insert into cuenta_fondos (id, tipo, nombre)
select 'fd100000-0000-4000-8000-000000000002', 'caja', 'Caja pagos' || texto from sufijo;
insert into cuenta_fondos (id, tipo, nombre, activa)
select 'fd100000-0000-4000-8000-000000000003', 'caja', 'Caja pagos cerrada' || texto, false from sufijo;

-- Saldos iniciales, ayer: caja 1000 y banco 5000.
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
select c, fecha - 1, 'ingreso', i, 'Saldo inicial'
from hoy, (values ('fd100000-0000-4000-8000-000000000002'::uuid, 1000), ('fd100000-0000-4000-8000-000000000001'::uuid, 5000)) v(c, i);

-- Un cheque de terceros en la cartera (de un recibo emitido).
do $$
declare
  v_recibo uuid;
begin
  v_recibo := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', 'fd000000-0000-4000-8000-000000000002', 'fecha', (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    jsonb_build_array(jsonb_build_object('tipo', 'cheque', 'importe', 250,
      'cheque', jsonb_build_object('banco', 'Nación', 'numero', 'FD-1', 'fecha_pago', '2026-12-01'))),
    '[]'::jsonb);
  perform emitir_recibo(v_recibo);
  insert into op select 'CH1', ch.id from cheque ch where ch.recibo_id = v_recibo;
end;
$$;

-- Cabecera de una orden de pago de hoy.
create function pg_temp.orden()
returns jsonb
language sql
as $$
  select jsonb_build_object('proveedor_id', 'fd000000-0000-4000-8000-000000000001', 'fecha', fecha) from hoy;
$$;

create function pg_temp.saldo(p_cuenta uuid)
returns numeric
language sql
as $$ select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = p_cuenta; $$;

-- ---------------------------------------------------------------------
-- Cuenta por medio de pago
-- ---------------------------------------------------------------------

insert into op values ('OP_medios', guardar_orden_pago(null, pg_temp.orden(), '[]', '[]'));

select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe, cuenta_id)
           values (%L, 'efectivo', 10, 'fd100000-0000-4000-8000-000000000001')$$, pg_temp.id('OP_medios')),
  'FN008', null, 'El efectivo sale de una caja, no de un banco'
);
select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe, cuenta_id)
           values (%L, 'transferencia', 10, 'fd100000-0000-4000-8000-000000000002')$$, pg_temp.id('OP_medios')),
  'FN008', null, 'La transferencia sale de un banco, no de una caja'
);
select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe, banco, numero, fecha_pago, cuenta_id)
           values (%L, 'cheque_propio', 10, 'X', '1', '2026-12-01', 'fd100000-0000-4000-8000-000000000002')$$,
    pg_temp.id('OP_medios')),
  'FN008', null, 'El cheque propio sale de un banco, no de una caja'
);
select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe, cheque_id, cuenta_id)
           values (%L, 'cheque_tercero', 250, %L, 'fd100000-0000-4000-8000-000000000001')$$,
    pg_temp.id('OP_medios'), pg_temp.id('CH1')),
  'FN009', null, 'Un cheque de terceros no mueve fondos: no lleva cuenta'
);
select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe, cuenta_id)
           values (%L, 'efectivo', 10, 'fd100000-0000-4000-8000-000000000003')$$, pg_temp.id('OP_medios')),
  'FN004', null, 'Un medio no sale de una cuenta inactiva'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(),
    jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 10,
      'cuenta_id', 'fd100000-0000-4000-8000-000000000001')), '[]'),
  'FN008', null, 'guardar_orden_pago tampoco guarda efectivo en un banco'
);

-- ---------------------------------------------------------------------
-- Guardar y confirmar
-- ---------------------------------------------------------------------

-- OP1: efectivo 100 sin caja todavía, transferencia 200 y cheque propio de
-- 300 para hoy desde el banco, cheque propio de 400 a 30 días.
create function pg_temp.medios_op1(p_caja uuid)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('tipo', 'efectivo', 'importe', 100, 'cuenta_id', p_caja),
    jsonb_build_object('tipo', 'transferencia', 'importe', 200, 'referencia', 'TR-1',
      'cuenta_id', 'fd100000-0000-4000-8000-000000000001'),
    jsonb_build_object('tipo', 'cheque_propio', 'importe', 300, 'banco', 'texto de la pantalla', 'numero', '0001',
      'fecha_pago', fecha, 'cuenta_id', 'fd100000-0000-4000-8000-000000000001'),
    jsonb_build_object('tipo', 'cheque_propio', 'importe', 400, 'numero', '0002',
      'fecha_pago', fecha + 30, 'cuenta_id', 'fd100000-0000-4000-8000-000000000001'))
  from hoy;
$$;

insert into op values ('OP1', guardar_orden_pago(null, pg_temp.orden(), pg_temp.medios_op1(null), '[]'));

select results_eq(
  format('select tipo, cuenta_id, banco from orden_pago_medio where orden_pago_id = %L order by orden', pg_temp.id('OP1')),
  $$values ('efectivo'::text, null::uuid, null::text),
           ('transferencia'::text, 'fd100000-0000-4000-8000-000000000001'::uuid, null::text),
           ('cheque_propio'::text, 'fd100000-0000-4000-8000-000000000001'::uuid, 'Banco Galicia'::text),
           ('cheque_propio'::text, 'fd100000-0000-4000-8000-000000000001'::uuid, 'Banco Galicia'::text)$$,
  'Se guarda la cuenta de cada medio; el cheque propio toma como banco el de la cuenta'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = pg_temp.id('OP1')),
  0,
  'Un borrador no mueve fondos'
);
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP1')),
  'FN007', null, 'No se confirma con efectivo sin caja'
);
select is(
  (select estado from orden_pago where id = pg_temp.id('OP1')),
  'borrador',
  'La orden rechazada sigue en borrador'
);

select lives_ok(
  format('select guardar_orden_pago(%L, %L, %L, %L)', pg_temp.id('OP1'), pg_temp.orden(),
    pg_temp.medios_op1('fd100000-0000-4000-8000-000000000002'), '[]'),
  'Se elige la caja del efectivo'
);
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP1')),
  'Con caja y banco elegidos, la orden se confirma'
);

-- ---------------------------------------------------------------------
-- Movimientos de la orden confirmada
-- ---------------------------------------------------------------------

select is(
  (select count(*)::integer from v_movimiento_fondos where origen = 'orden_pago' and origen_id = pg_temp.id('OP1')),
  3,
  'La orden da un movimiento por cuenta y fecha: la caja, el banco hoy y el banco a 30 días'
);
select results_eq(
  $$select origen, ingreso, egreso, importe, saldo from v_movimiento_fondos
    where cuenta_id = 'fd100000-0000-4000-8000-000000000002' order by fecha, creado_en$$,
  $$values ('ajuste'::text, 1000::numeric, 0::numeric, 1000::numeric, 1000::numeric),
           ('orden_pago'::text, 0::numeric, 100::numeric, -100::numeric, 900::numeric)$$,
  'En la caja, el efectivo de la orden es un egreso y baja el saldo acumulado'
);
select results_eq(
  $$select m.fecha - h.fecha, origen, egreso, saldo from v_movimiento_fondos m, hoy h
    where cuenta_id = 'fd100000-0000-4000-8000-000000000001' order by m.fecha, creado_en$$,
  $$values (-1, 'ajuste'::text, 0::numeric, 5000::numeric),
           (0, 'orden_pago'::text, 500::numeric, 4500::numeric),
           (30, 'orden_pago'::text, 400::numeric, 4100::numeric)$$,
  'En el banco, la transferencia y el cheque de hoy suman un egreso; el cheque a 30 días sale en su fecha de pago'
);
select is(
  (select descripcion from v_movimiento_fondos
   where cuenta_id = 'fd100000-0000-4000-8000-000000000002' and origen = 'orden_pago'),
  'Orden de pago ' || (select numero_texto from orden_pago where id = pg_temp.id('OP1')) || ' · Proveedor fondos pagos',
  'La descripción dice el número de la orden y el proveedor'
);
select is(
  (select descripcion from v_movimiento_fondos m, hoy h
   where cuenta_id = 'fd100000-0000-4000-8000-000000000001' and origen = 'orden_pago' and m.fecha > h.fecha),
  'Orden de pago ' || (select numero_texto from orden_pago where id = pg_temp.id('OP1'))
    || ' · Proveedor fondos pagos · cheque N° 0002',
  'Un movimiento con cheques propios dice sus números'
);
select is(
  (select saldo_actual || '|' || movimientos_futuros from v_cuenta_fondos_saldo
   where cuenta_id = 'fd100000-0000-4000-8000-000000000001'),
  '4500.00|-400.00',
  'El cheque propio a 30 días cuenta en los movimientos futuros, no en el saldo actual'
);
select throws_ok(
  format($$update orden_pago_medio set cuenta_id = 'fd100000-0000-4000-8000-000000000001'
           where orden_pago_id = %L and tipo = 'transferencia'$$, pg_temp.id('OP1')),
  'OP001', null, 'Un medio de una orden confirmada no cambia de cuenta'
);

-- ---------------------------------------------------------------------
-- Cuenta inactiva al confirmar
-- ---------------------------------------------------------------------

insert into op values ('OP2', guardar_orden_pago(null, pg_temp.orden(),
  jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 50, 'cuenta_id', 'fd100000-0000-4000-8000-000000000002')),
  '[]'));
update cuenta_fondos set activa = false where id = 'fd100000-0000-4000-8000-000000000002';
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP2')),
  'FN004', null, 'No se confirma con una caja que se desactivó después de cargar el borrador'
);
update cuenta_fondos set activa = true where id = 'fd100000-0000-4000-8000-000000000002';
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP2')),
  'Reactivada la caja, se confirma'
);
select is(
  pg_temp.saldo('fd100000-0000-4000-8000-000000000002'),
  850::numeric,
  'La segunda orden también sale de la caja'
);

-- ---------------------------------------------------------------------
-- Anulación
-- ---------------------------------------------------------------------

select lives_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP2'), 'Cargada dos veces'),
  'Se anula la segunda orden'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = pg_temp.id('OP2')),
  0,
  'Una orden anulada no mueve fondos'
);
select is(
  pg_temp.saldo('fd100000-0000-4000-8000-000000000002'),
  900::numeric,
  'Al anularla, la caja vuelve al saldo anterior'
);

-- ---------------------------------------------------------------------
-- Cheques de terceros
-- ---------------------------------------------------------------------

insert into op values ('OP3', guardar_orden_pago(null, pg_temp.orden(),
  jsonb_build_array(jsonb_build_object('tipo', 'cheque_tercero', 'cheque_id', pg_temp.id('CH1'),
    'cuenta_id', 'fd100000-0000-4000-8000-000000000001')),
  '[]'));
select is(
  (select cuenta_id from orden_pago_medio where orden_pago_id = pg_temp.id('OP3')),
  null,
  'guardar_orden_pago no guarda cuenta en un cheque de terceros'
);
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP3')),
  'Una orden sólo con un cheque de terceros se confirma sin cuenta'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = pg_temp.id('OP3')),
  0,
  'Entregar un cheque de terceros no mueve fondos'
);

-- ---------------------------------------------------------------------
-- La regla vale al confirmar aunque el medio se haya cargado sin control
-- ---------------------------------------------------------------------

insert into op values ('OP4', guardar_orden_pago(null, pg_temp.orden(), '[]', '[]'));
reset role;
alter table orden_pago_medio disable trigger trg_orden_pago_medio_validar_cuenta;
insert into orden_pago_medio (orden_pago_id, tipo, importe, cuenta_id)
values (pg_temp.id('OP4'), 'transferencia', 70, 'fd100000-0000-4000-8000-000000000002');
alter table orden_pago_medio enable trigger trg_orden_pago_medio_validar_cuenta;
update orden_pago set total = 70 where id = pg_temp.id('OP4');
set local role authenticated;

select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP4')),
  'FN008', null, 'No se confirma una transferencia que sale de una caja'
);

-- ---------------------------------------------------------------------
-- Órdenes históricas (confirmadas antes de las cuentas)
-- ---------------------------------------------------------------------

insert into op values ('OP_hist', guardar_orden_pago(null, pg_temp.orden(),
  jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 40)), '[]'));
reset role;
-- Como si se hubiera confirmado antes de esta migración: sin la regla de la cuenta.
alter table orden_pago disable trigger trg_orden_pago_validar_cuentas;
select confirmar_orden_pago(pg_temp.id('OP_hist'));
alter table orden_pago enable trigger trg_orden_pago_validar_cuentas;
set local role authenticated;

select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = pg_temp.id('OP_hist')),
  0,
  'Una orden histórica sin cuenta no aparece en los movimientos'
);
select lives_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP_hist'), 'Histórica mal cargada'),
  'Una orden histórica sin cuenta se sigue anulando'
);

-- ---------------------------------------------------------------------
-- Permisos de las funciones nuevas
-- ---------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', f, 'execute'),
  format('authenticated no ejecuta %s', f)
)
from unnest(array[
  'public.fn_orden_pago_medio_validar_cuenta()',
  'public.fn_orden_pago_validar_cuentas()'
]) as f;
select ok(
  not has_function_privilege('anon', 'public.fn_orden_pago_medio_tipo_cuenta(text)', 'execute'),
  'anon no ejecuta fn_orden_pago_medio_tipo_cuenta'
);

select * from finish();
rollback;
