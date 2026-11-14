-- =====================================================================
-- Tests de las transferencias entre cuentas de fondos
-- (20261112000003_finanzas_transferencias.sql): checks, misma cuenta,
-- cuentas inactivas, las dos patas en v_movimiento_fondos con su saldo
-- acumulado, anulación con motivo, inmutabilidad y permisos de anon.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.transferencia_fondos'::regclass),
  'transferencia_fondos tiene RLS habilitada'
);
select ok(
  not has_table_privilege('anon', 'public.transferencia_fondos', 'select, insert, update, delete, truncate, references, trigger'),
  'anon no tiene privilegios sobre transferencia_fondos'
);
select ok(
  has_table_privilege('authenticated', 'public.transferencia_fondos', 'select, insert, update'),
  'authenticated lee, registra y anula transferencias'
);

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

insert into cuenta_fondos (id, tipo, nombre, banco) values
  ('00000000-0000-4000-8000-0000000ef001', 'banco', 'Banco transferencias test ef001', 'Banco Test');
insert into cuenta_fondos (id, tipo, nombre) values
  ('00000000-0000-4000-8000-0000000ef002', 'caja', 'Caja transferencias test ef002'),
  ('00000000-0000-4000-8000-0000000ef003', 'caja', 'Caja inactiva transferencias test ef003');

insert into ajuste_fondos (id, cuenta_id, fecha, tipo, importe, concepto) values
  ('00000000-0000-4000-8000-0000000ea001', '00000000-0000-4000-8000-0000000ef002', (select fecha - 10 from hoy), 'ingreso', 1000, 'Saldo inicial'),
  ('00000000-0000-4000-8000-0000000ea002', '00000000-0000-4000-8000-0000000ef001', (select fecha - 10 from hoy), 'ingreso', 500, 'Saldo inicial');

-- ---------------------------------------------------------------------
-- Validaciones
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe)
    values ('00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef002', 10)$$,
  'FN010', null, 'Origen y destino no pueden ser la misma cuenta'
);
select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe)
    values ('00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef001', 0)$$,
  '23514', null, 'El importe es mayor que cero'
);
select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe)
    values ('00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef001', -5)$$,
  '23514', null, 'El importe no es negativo'
);
select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe, estado, anulado_en, motivo_anulacion)
    values ('00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef001', 10, 'anulado', now(), 'm')$$,
  'FN002', null, 'Una transferencia no nace anulada'
);
select col_default_is('public', 'transferencia_fondos', 'estado', 'vigente', 'Una transferencia nace vigente');

update cuenta_fondos set activa = false where id = '00000000-0000-4000-8000-0000000ef003';

select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe)
    values ('00000000-0000-4000-8000-0000000ef003', '00000000-0000-4000-8000-0000000ef001', 10)$$,
  'FN004', null, 'Una cuenta origen inactiva no admite transferencias'
);
select throws_ok(
  $$insert into transferencia_fondos (cuenta_origen_id, cuenta_destino_id, importe)
    values ('00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef003', 10)$$,
  'FN004', null, 'Una cuenta destino inactiva no admite transferencias'
);

-- ---------------------------------------------------------------------
-- Movimientos: dos patas
-- ---------------------------------------------------------------------

-- Depósito del efectivo de la caja en el banco, con concepto; y una
-- extracción sin concepto.
insert into transferencia_fondos (id, fecha, cuenta_origen_id, cuenta_destino_id, importe, concepto, observacion) values
  ('00000000-0000-4000-8000-0000000eb001', (select fecha - 5 from hoy),
   '00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef001', 300, 'Depósito de efectivo', 'Boleta 123');
insert into transferencia_fondos (id, fecha, cuenta_origen_id, cuenta_destino_id, importe) values
  ('00000000-0000-4000-8000-0000000eb002', (select fecha - 2 from hoy),
   '00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef002', 50.25);

select results_eq(
  $$select origen, origen_id, ingreso, egreso, saldo from v_movimiento_fondos
    where cuenta_id = '00000000-0000-4000-8000-0000000ef002' order by fecha, creado_en, origen_id, origen$$,
  $$values
    ('ajuste'::text, '00000000-0000-4000-8000-0000000ea001'::uuid, 1000::numeric, 0::numeric, 1000::numeric),
    ('transferencia'::text, '00000000-0000-4000-8000-0000000eb001'::uuid, 0::numeric, 300::numeric, 700::numeric),
    ('transferencia'::text, '00000000-0000-4000-8000-0000000eb002'::uuid, 50.25::numeric, 0::numeric, 750.25::numeric)$$,
  'La caja: egreso por el depósito e ingreso por la extracción, con saldo acumulado'
);
select results_eq(
  $$select origen, origen_id, ingreso, egreso, saldo from v_movimiento_fondos
    where cuenta_id = '00000000-0000-4000-8000-0000000ef001' order by fecha, creado_en, origen_id, origen$$,
  $$values
    ('ajuste'::text, '00000000-0000-4000-8000-0000000ea002'::uuid, 500::numeric, 0::numeric, 500::numeric),
    ('transferencia'::text, '00000000-0000-4000-8000-0000000eb001'::uuid, 300::numeric, 0::numeric, 800::numeric),
    ('transferencia'::text, '00000000-0000-4000-8000-0000000eb002'::uuid, 0::numeric, 50.25::numeric, 749.75::numeric)$$,
  'El banco: ingreso por el depósito y egreso por la extracción, con saldo acumulado'
);
select is(
  (select descripcion from v_movimiento_fondos
    where origen_id = '00000000-0000-4000-8000-0000000eb001' and cuenta_id = '00000000-0000-4000-8000-0000000ef002'),
  'Transferencia a Banco transferencias test ef001 · Depósito de efectivo',
  'La pata de origen dice a qué cuenta va, con el concepto'
);
select is(
  (select descripcion from v_movimiento_fondos
    where origen_id = '00000000-0000-4000-8000-0000000eb001' and cuenta_id = '00000000-0000-4000-8000-0000000ef001'),
  'Transferencia desde Caja transferencias test ef002 · Depósito de efectivo',
  'La pata de destino dice de qué cuenta viene, con el concepto'
);
select is(
  (select descripcion from v_movimiento_fondos
    where origen_id = '00000000-0000-4000-8000-0000000eb002' and cuenta_id = '00000000-0000-4000-8000-0000000ef002'),
  'Transferencia desde Banco transferencias test ef001',
  'Sin concepto, sólo la otra cuenta'
);
select is(
  (select observacion from v_movimiento_fondos
    where origen_id = '00000000-0000-4000-8000-0000000eb001' and cuenta_id = '00000000-0000-4000-8000-0000000ef001'),
  'Boleta 123', 'La observación de la transferencia va en las dos patas'
);
select is(
  (select count(*)::int from v_movimiento_fondos where origen = 'transferencia'
    and origen_id in ('00000000-0000-4000-8000-0000000eb001', '00000000-0000-4000-8000-0000000eb002')),
  4, 'Cada transferencia vigente da exactamente dos movimientos'
);
select results_eq(
  $$select saldo_actual from v_cuenta_fondos_saldo
    where cuenta_id in ('00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef002') order by cuenta_id$$,
  $$values (749.75::numeric), (750.25::numeric)$$,
  'Los saldos actuales incluyen las transferencias'
);

-- Transferencia futura: va a movimientos futuros en las dos cuentas.
insert into transferencia_fondos (id, fecha, cuenta_origen_id, cuenta_destino_id, importe) values
  ('00000000-0000-4000-8000-0000000eb003', (select fecha + 3 from hoy),
   '00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef002', 100);
select results_eq(
  $$select movimientos_futuros from v_cuenta_fondos_saldo
    where cuenta_id in ('00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef002') order by cuenta_id$$,
  $$values (-100::numeric), (100::numeric)$$,
  'Una transferencia futura va a movimientos futuros de las dos cuentas'
);

-- ---------------------------------------------------------------------
-- Inmutabilidad y anulación
-- ---------------------------------------------------------------------

select throws_ok(
  $$update transferencia_fondos set importe = 1 where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN001', null, 'El importe de una transferencia no cambia'
);
select throws_ok(
  $$update transferencia_fondos set cuenta_destino_id = '00000000-0000-4000-8000-0000000ef003' where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN001', null, 'Una transferencia no cambia de cuenta'
);
select throws_ok(
  $$update transferencia_fondos set fecha = fecha - 1 where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN001', null, 'La fecha de una transferencia no cambia'
);
select throws_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = 'Error', concepto = 'Otro'
    where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN001', null, 'Al anular no cambia nada más'
);
select throws_ok(
  $$delete from transferencia_fondos where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN003', null, 'Una transferencia no se borra'
);
select throws_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = '  ' where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN005', null, 'Anular pide motivo'
);
select lives_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = ' Boleta rechazada ' where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'Una transferencia vigente se anula con motivo'
);
select results_eq(
  $$select estado, anulado_en is not null, motivo_anulacion from transferencia_fondos where id = '00000000-0000-4000-8000-0000000eb001'$$,
  $$values ('anulado'::text, true, 'Boleta rechazada'::text)$$,
  'La anulación guarda la fecha y el motivo sin espacios de más'
);
select is(
  (select count(*)::int from v_movimiento_fondos where origen_id = '00000000-0000-4000-8000-0000000eb001'),
  0, 'Una transferencia anulada desaparece de las dos cuentas'
);
select results_eq(
  $$select saldo_actual from v_cuenta_fondos_saldo
    where cuenta_id in ('00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000ef002') order by cuenta_id$$,
  $$values (449.75::numeric), (1050.25::numeric)$$,
  'Anular la transferencia la saca de los dos saldos'
);
select throws_ok(
  $$update transferencia_fondos set estado = 'vigente', anulado_en = null, motivo_anulacion = null
    where id = '00000000-0000-4000-8000-0000000eb001'$$,
  'FN001', null, 'Una transferencia anulada no se desanula'
);

-- Una transferencia de una cuenta que se desactivó después se anula igual.
update cuenta_fondos set activa = false where id = '00000000-0000-4000-8000-0000000ef001';
select lives_ok(
  $$update transferencia_fondos set estado = 'anulado', motivo_anulacion = 'Error'
    where id = '00000000-0000-4000-8000-0000000eb002'$$,
  'Una transferencia de una cuenta inactiva se anula igual'
);
-- Una cuenta cuyo único movimiento es una transferencia (aunque anulada) no se borra.
insert into cuenta_fondos (id, tipo, nombre) values
  ('00000000-0000-4000-8000-0000000ef004', 'caja', 'Caja sólo transferencias test ef004');
insert into transferencia_fondos (id, cuenta_origen_id, cuenta_destino_id, importe) values
  ('00000000-0000-4000-8000-0000000eb004', '00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000ef004', 10);
update transferencia_fondos set estado = 'anulado', motivo_anulacion = 'Prueba' where id = '00000000-0000-4000-8000-0000000eb004';
select throws_ok(
  $$delete from cuenta_fondos where id = '00000000-0000-4000-8000-0000000ef004'$$,
  '23503', null, 'Una cuenta con transferencias no se borra'
);

select * from finish();
rollback;