-- =====================================================================
-- Tests de las cuentas de fondos y los ajustes manuales
-- (20261111000001_finanzas_cuentas.sql): checks de la cuenta, nombre
-- único, tipo fijo, ajustes inmutables que sólo se anulan con motivo,
-- cuenta inactiva sin ajustes nuevos, movimientos con saldo acumulado,
-- saldo actual contra movimientos futuros y permisos de anon.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
  format('%s tiene RLS habilitada', t)
)
from unnest(array['cuenta_fondos', 'ajuste_fondos']) as t;

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['cuenta_fondos', 'ajuste_fondos', 'v_movimiento_fondos', 'v_cuenta_fondos_saldo']) as t;

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;

-- ---------------------------------------------------------------------
-- Cuentas
-- ---------------------------------------------------------------------

insert into cuenta_fondos (id, tipo, nombre, banco, numero_cuenta, cbu, alias) values
  ('00000000-0000-4000-8000-00000000f001', 'banco', 'Galicia CC', 'Banco Galicia', '123/4', '0070000000000000000001', 'charoli.galicia');
insert into cuenta_fondos (id, tipo, nombre) values
  ('00000000-0000-4000-8000-00000000f002', 'caja', 'Caja chica'),
  ('00000000-0000-4000-8000-00000000f003', 'banco', 'Nación sin movimientos');

select throws_ok(
  $$insert into cuenta_fondos (tipo, nombre) values ('cuenta', 'Otra')$$,
  '23514', null, 'El tipo es banco o caja'
);
select throws_ok(
  $$insert into cuenta_fondos (tipo, nombre) values ('caja', '   ')$$,
  '23514', null, 'El nombre es obligatorio'
);
select throws_ok(
  $$insert into cuenta_fondos (tipo, nombre, cbu) values ('banco', 'Macro', '123')$$,
  '23514', null, 'El CBU tiene 22 dígitos'
);
select throws_ok(
  $$insert into cuenta_fondos (tipo, nombre, alias) values ('caja', 'Caja 2', 'caja.alias')$$,
  '23514', null, 'Una caja no lleva datos bancarios'
);
select throws_ok(
  $$insert into cuenta_fondos (tipo, nombre) values ('caja', ' galicia cc ')$$,
  '23505', null, 'El nombre es único entre bancos y cajas, sin distinguir mayúsculas'
);
select throws_ok(
  $$update cuenta_fondos set tipo = 'caja', banco = null, numero_cuenta = null, cbu = null, alias = null
    where id = '00000000-0000-4000-8000-00000000f001'$$,
  'FN006', null, 'El tipo de la cuenta no cambia'
);
select lives_ok(
  $$update cuenta_fondos set nombre = 'Galicia cuenta corriente' where id = '00000000-0000-4000-8000-00000000f001'$$,
  'Los demás datos de la cuenta se editan'
);

-- ---------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------

insert into ajuste_fondos (id, cuenta_id, fecha, tipo, importe, concepto) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000f001', (select fecha - 10 from hoy), 'ingreso', 1000, 'Saldo inicial'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000f001', (select fecha - 5 from hoy), 'egreso', 300.50, 'Gastos bancarios'),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000f001', (select fecha - 1 from hoy), 'ingreso', 50, 'Cargado de más'),
  ('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000f001', (select fecha + 7 from hoy), 'egreso', 200, 'Débito programado'),
  ('00000000-0000-4000-8000-00000000a005', '00000000-0000-4000-8000-00000000f002', (select fecha from hoy), 'ingreso', 80, 'Saldo inicial');

select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto)
    values ('00000000-0000-4000-8000-00000000f002', 'ingreso', 0, 'Nada')$$,
  '23514', null, 'El importe es mayor que cero'
);
select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto)
    values ('00000000-0000-4000-8000-00000000f002', 'ingreso', 10, '  ')$$,
  '23514', null, 'El concepto es obligatorio'
);
select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto)
    values ('00000000-0000-4000-8000-00000000f002', 'otro', 10, 'X')$$,
  '23514', null, 'El ajuste es ingreso o egreso'
);
select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto, estado, anulado_en, motivo_anulacion)
    values ('00000000-0000-4000-8000-00000000f002', 'ingreso', 10, 'X', 'anulado', now(), 'm')$$,
  'FN002', null, 'Un ajuste no nace anulado'
);
select col_default_is('public', 'ajuste_fondos', 'estado', 'vigente', 'Un ajuste nace vigente');

-- Inmutable: sólo se anula.
select throws_ok(
  $$update ajuste_fondos set importe = 2000 where id = '00000000-0000-4000-8000-00000000a001'$$,
  'FN001', null, 'El importe de un ajuste no cambia'
);
select throws_ok(
  $$update ajuste_fondos set fecha = fecha - 1 where id = '00000000-0000-4000-8000-00000000a001'$$,
  'FN001', null, 'La fecha de un ajuste no cambia'
);
select throws_ok(
  $$update ajuste_fondos set concepto = 'Otro' where id = '00000000-0000-4000-8000-00000000a001'$$,
  'FN001', null, 'El concepto de un ajuste no cambia'
);
select throws_ok(
  $$update ajuste_fondos set cuenta_id = '00000000-0000-4000-8000-00000000f002' where id = '00000000-0000-4000-8000-00000000a001'$$,
  'FN001', null, 'Un ajuste no cambia de cuenta'
);
select throws_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = 'Error', importe = 1
    where id = '00000000-0000-4000-8000-00000000a003'$$,
  'FN001', null, 'Al anular no cambia nada más'
);
select throws_ok(
  $$delete from ajuste_fondos where id = '00000000-0000-4000-8000-00000000a001'$$,
  'FN003', null, 'Un ajuste no se borra'
);
select throws_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = '  ' where id = '00000000-0000-4000-8000-00000000a003'$$,
  'FN005', null, 'Anular pide motivo'
);
select lives_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = ' Cargado dos veces ' where id = '00000000-0000-4000-8000-00000000a003'$$,
  'Un ajuste vigente se anula con motivo'
);
select results_eq(
  $$select estado, anulado_en is not null, motivo_anulacion from ajuste_fondos where id = '00000000-0000-4000-8000-00000000a003'$$,
  $$values ('anulado'::text, true, 'Cargado dos veces'::text)$$,
  'La anulación guarda la fecha y el motivo sin espacios de más'
);
select throws_ok(
  $$update ajuste_fondos set estado = 'vigente', anulado_en = null, motivo_anulacion = null
    where id = '00000000-0000-4000-8000-00000000a003'$$,
  'FN001', null, 'Un ajuste anulado no se desanula'
);

-- ---------------------------------------------------------------------
-- Movimientos y saldos
-- ---------------------------------------------------------------------

select results_eq(
  $$select origen_id, ingreso, egreso, importe, saldo from v_movimiento_fondos
    where cuenta_id = '00000000-0000-4000-8000-00000000f001' order by fecha, creado_en, origen_id$$,
  $$values
    ('00000000-0000-4000-8000-00000000a001'::uuid, 1000::numeric, 0::numeric, 1000::numeric, 1000::numeric),
    ('00000000-0000-4000-8000-00000000a002'::uuid, 0::numeric, 300.50::numeric, -300.50::numeric, 699.50::numeric),
    ('00000000-0000-4000-8000-00000000a004'::uuid, 0::numeric, 200::numeric, -200::numeric, 499.50::numeric)$$,
  'Movimientos del banco con saldo acumulado, sin el ajuste anulado'
);
select is(
  (select origen from v_movimiento_fondos where origen_id = '00000000-0000-4000-8000-00000000a001'),
  'ajuste', 'El origen de un ajuste es "ajuste"'
);
select is(
  (select descripcion from v_movimiento_fondos where origen_id = '00000000-0000-4000-8000-00000000a002'),
  'Gastos bancarios', 'La descripción del movimiento es el concepto del ajuste'
);
select results_eq(
  $$select saldo_actual, movimientos_futuros, ultimo_movimiento from v_cuenta_fondos_saldo
    where cuenta_id = '00000000-0000-4000-8000-00000000f001'$$,
  $$select 699.50::numeric, -200::numeric, fecha - 5 from hoy$$,
  'El saldo actual cuenta hasta hoy; lo futuro va aparte'
);
select results_eq(
  $$select saldo_actual, movimientos_futuros, ultimo_movimiento from v_cuenta_fondos_saldo
    where cuenta_id = '00000000-0000-4000-8000-00000000f002'$$,
  $$select 80::numeric, 0::numeric, fecha from hoy$$,
  'Un movimiento de hoy entra en el saldo actual'
);
select results_eq(
  $$select saldo_actual, movimientos_futuros, ultimo_movimiento from v_cuenta_fondos_saldo
    where cuenta_id = '00000000-0000-4000-8000-00000000f003'$$,
  $$values (0::numeric, 0::numeric, null::date)$$,
  'Una cuenta sin movimientos tiene saldo cero'
);

-- ---------------------------------------------------------------------
-- Cuenta inactiva
-- ---------------------------------------------------------------------

update cuenta_fondos set activa = false where id = '00000000-0000-4000-8000-00000000f002';

select throws_ok(
  $$insert into ajuste_fondos (cuenta_id, tipo, importe, concepto)
    values ('00000000-0000-4000-8000-00000000f002', 'ingreso', 10, 'Otro')$$,
  'FN004', null, 'Una cuenta inactiva no admite ajustes nuevos'
);
select lives_ok(
  $$update ajuste_fondos set estado = 'anulado', motivo_anulacion = 'Error'
    where id = '00000000-0000-4000-8000-00000000a005'$$,
  'Un ajuste de una cuenta inactiva se anula igual'
);
select is(
  (select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = '00000000-0000-4000-8000-00000000f002'),
  0::numeric, 'Anular el único ajuste deja el saldo en cero'
);
select throws_ok(
  $$delete from cuenta_fondos where id = '00000000-0000-4000-8000-00000000f001'$$,
  '23503', null, 'Una cuenta con ajustes no se borra'
);

select * from finish();
rollback;
