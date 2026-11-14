-- =====================================================================
-- Tests de los cheques de terceros en las cuentas de fondos
-- (20261112000002_finanzas_cheques.sql): depositar pide una cuenta
-- bancaria activa; la cuenta de depósito no se carga ni se cambia fuera
-- del depósito; el depósito acredita la cuenta en su fecha y el rechazo
-- de un depositado la debita en la fecha del rechazo, sin que el depósito
-- desaparezca; los cheques en cartera, entregados, anulados y los
-- depositados antes de Finanzas (sin cuenta) no mueven fondos. Corre con
-- `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_column('public', 'cheque', 'deposito_cuenta_id', 'cheque tiene deposito_cuenta_id');
select col_is_fk('public', 'cheque', 'deposito_cuenta_id', 'cheque.deposito_cuenta_id es una clave foránea');
select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.cheque'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                         where attrelid = 'public.cheque'::regclass and attname = 'deposito_cuenta_id')]),
  'r',
  'Una cuenta con cheques depositados no se borra (restrict)'
);

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, condicion_iva) values
  ('fc000000-0000-4000-8000-000000000001', 'Cliente fondos cheques', 'Responsable Inscripto');
-- rechazar_cheque arma la nota de débito en un punto de venta electrónico activo.
insert into punto_venta (numero, nombre, electronico) values (9708, 'Electrónico cheques fondos', true)
on conflict (numero) do update set activo = true, electronico = true;

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

-- "Hoy" de Argentina (la fecha del recibo no puede pasar la de la ND del rechazo).
create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;
create temp table ch (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from ch where nombre = p_nombre; $$;

-- Nombres únicos: la base local puede tener cuentas cargadas a mano.
create temp table sufijo as select ' ' || gen_random_uuid()::text as texto;

insert into cuenta_fondos (id, tipo, nombre, banco)
select 'fc100000-0000-4000-8000-000000000001', 'banco', 'Banco cheques' || texto, 'Banco Galicia' from sufijo;
insert into cuenta_fondos (id, tipo, nombre)
select 'fc100000-0000-4000-8000-000000000002', 'caja', 'Caja cheques' || texto from sufijo;
insert into cuenta_fondos (id, tipo, nombre, banco, activa)
select 'fc100000-0000-4000-8000-000000000003', 'banco', 'Banco cheques cerrado' || texto, 'Banco Nación', false from sufijo;

-- Saldo inicial del banco: 1000, hace cinco días.
insert into ajuste_fondos (id, cuenta_id, fecha, tipo, importe, concepto)
select 'fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', fecha - 5, 'ingreso', 1000, 'Saldo inicial'
from hoy;

-- Recibo emitido con cinco cheques (A y B se depositan, C se entrega,
-- D queda en cartera, H se deposita "antes de Finanzas") y otro recibo
-- que se anula con su cheque (anulado), más un borrador.
do $$
declare
  v_recibo uuid;
  v_hoy date := (select fecha from hoy);
begin
  v_recibo := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', 'fc000000-0000-4000-8000-000000000001', 'fecha', v_hoy),
    (select jsonb_agg(jsonb_build_object('tipo', 'cheque', 'importe', i,
       'cheque', jsonb_build_object('banco', 'Galicia', 'numero', n, 'fecha_pago', v_hoy + 30,
                                    'librador', 'Librador SA')) order by n)
     from (values ('FC-A', 100), ('FC-B', 200), ('FC-C', 300), ('FC-D', 400), ('FC-H', 500)) v(n, i)),
    '[]'::jsonb);
  perform emitir_recibo(v_recibo);
  insert into ch select replace(c.numero, 'FC-', ''), c.id from cheque c where c.recibo_id = v_recibo;

  v_recibo := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', 'fc000000-0000-4000-8000-000000000001', 'fecha', v_hoy),
    jsonb_build_array(jsonb_build_object('tipo', 'cheque', 'importe', 600,
      'cheque', jsonb_build_object('banco', 'Macro', 'numero', 'FC-N', 'fecha_pago', v_hoy + 30))),
    '[]'::jsonb);
  perform emitir_recibo(v_recibo);
  insert into ch select 'N', c.id from cheque c where c.recibo_id = v_recibo;
  perform anular_recibo(v_recibo, 'Cargado dos veces');

  v_recibo := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', 'fc000000-0000-4000-8000-000000000001', 'fecha', v_hoy),
    jsonb_build_array(jsonb_build_object('tipo', 'cheque', 'importe', 700,
      'cheque', jsonb_build_object('banco', 'Macro', 'numero', 'FC-R', 'fecha_pago', v_hoy + 30))),
    '[]'::jsonb);
  insert into ch select 'BORRADOR', c.id from cheque c where c.recibo_id = v_recibo;
end;
$$;

create function pg_temp.saldo(p_cuenta uuid)
returns numeric
language sql
as $$ select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = p_cuenta; $$;

-- ---------------------------------------------------------------------
-- Cuenta de depósito
-- ---------------------------------------------------------------------

select throws_ok(
  format($$update cheque set estado = 'depositado' where id = %L$$, pg_temp.id('A')),
  'FN007', null, 'Depositar pide la cuenta bancaria'
);
select throws_ok(
  format($$update cheque set estado = 'depositado', deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000002'
           where id = %L$$, pg_temp.id('A')),
  'FN008', null, 'Un cheque no se deposita en una caja'
);
select throws_ok(
  format($$update cheque set estado = 'depositado', deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000003'
           where id = %L$$, pg_temp.id('A')),
  'FN004', null, 'Un cheque no se deposita en una cuenta inactiva'
);
select throws_ok(
  format($$update cheque set deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000001' where id = %L$$, pg_temp.id('D')),
  'FN009', null, 'Un cheque en cartera no tiene cuenta de depósito'
);
select throws_ok(
  format($$update cheque set estado = 'entregado', entregado_a = 'Proveedor',
             deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000001' where id = %L$$, pg_temp.id('C')),
  'FN009', null, 'Un cheque entregado no lleva cuenta de depósito'
);
select throws_ok(
  format($$update cheque set deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000001' where id = %L$$, pg_temp.id('BORRADOR')),
  'FN009', null, 'El cheque de un recibo en borrador no tiene cuenta de depósito'
);

select lives_ok(
  format($$update cheque set estado = 'depositado', deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000001',
             estado_fecha = %L, estado_observacion = 'Boleta 1' where id = %L$$,
    (select fecha - 3 from hoy), pg_temp.id('A')),
  'Un cheque en cartera se deposita en una cuenta bancaria activa'
);
select throws_ok(
  format($$update cheque set deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000003' where id = %L$$, pg_temp.id('A')),
  'FN009', null, 'La cuenta de depósito no cambia después de depositar'
);
select throws_ok(
  format($$update cheque set deposito_cuenta_id = null where id = %L$$, pg_temp.id('A')),
  'FN009', null, 'La cuenta de depósito tampoco se borra después de depositar'
);
select throws_ok(
  format($$insert into cheque (recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe, deposito_cuenta_id)
           select recibo_id, cliente_id, tipo, banco, 'FC-INS', fecha_pago, 10, 'fc100000-0000-4000-8000-000000000001'
           from cheque where id = %L$$, pg_temp.id('BORRADOR')),
  'FN009', null, 'Un cheque no nace con cuenta de depósito'
);
select throws_ok(
  format($$update cheque set estado = 'depositado', deposito_cuenta_id = 'fc100000-0000-4000-8000-0000000000ff'
           where id = %L$$, pg_temp.id('D')),
  '23503', null, 'Depositar en una cuenta inexistente lo rechaza la clave foránea'
);

update cheque set estado = 'depositado', deposito_cuenta_id = 'fc100000-0000-4000-8000-000000000001',
  estado_fecha = (select fecha - 2 from hoy)
where id = pg_temp.id('B');
update cheque set estado = 'entregado', entregado_a = 'Proveedor de lonas' where id = pg_temp.id('C');

-- ---------------------------------------------------------------------
-- Movimientos: depósitos
-- ---------------------------------------------------------------------

select results_eq(
  $$select origen, origen_id, fecha, ingreso, egreso, saldo from v_movimiento_fondos
    where cuenta_id = 'fc100000-0000-4000-8000-000000000001' order by fecha, creado_en, origen_id, origen$$,
  format($$values ('ajuste'::text, 'fc200000-0000-4000-8000-000000000001'::uuid, %L::date, 1000.00::numeric, 0.00::numeric, 1000.00::numeric),
                  ('cheque_deposito', %L::uuid, %L::date, 100.00, 0.00, 1100.00),
                  ('cheque_deposito', %L::uuid, %L::date, 200.00, 0.00, 1300.00)$$,
    (select fecha - 5 from hoy), pg_temp.id('A'), (select fecha - 3 from hoy), pg_temp.id('B'), (select fecha - 2 from hoy)),
  'Cada depósito acredita la cuenta en su fecha, con el saldo acumulado'
);
select is(
  (select descripcion from v_movimiento_fondos where origen = 'cheque_deposito' and origen_id = pg_temp.id('A')),
  'Depósito cheque N° FC-A · Galicia · Librador SA',
  'La descripción del depósito dice el número, el banco y el librador'
);
select is(
  (select observacion from v_movimiento_fondos where origen = 'cheque_deposito' and origen_id = pg_temp.id('A')),
  'Boleta 1',
  'La observación del depósito es la del cambio de estado'
);
select is(pg_temp.saldo('fc100000-0000-4000-8000-000000000001'), 1300.00::numeric, 'Saldo del banco con los depósitos');

-- ---------------------------------------------------------------------
-- Movimientos: rechazo de un depositado
-- ---------------------------------------------------------------------

-- La cuenta se desactiva: el rechazo igual la debita (lo decide el banco).
update cuenta_fondos set activa = false where id = 'fc100000-0000-4000-8000-000000000001';

select lives_ok(
  format('select rechazar_cheque(%L, %L, %L)', pg_temp.id('A'), (select fecha - 1 from hoy), 'Sin fondos'),
  'Un cheque depositado se rechaza aunque su cuenta esté inactiva'
);
select results_eq(
  $$select origen, origen_id, fecha, ingreso, egreso, saldo from v_movimiento_fondos
    where cuenta_id = 'fc100000-0000-4000-8000-000000000001' and origen <> 'ajuste'
    order by fecha, creado_en, origen_id, origen$$,
  format($$values ('cheque_deposito'::text, %L::uuid, %L::date, 100.00::numeric, 0.00::numeric, 1100.00::numeric),
                  ('cheque_deposito', %L::uuid, %L::date, 200.00, 0.00, 1300.00),
                  ('cheque_rechazo', %L::uuid, %L::date, 0.00, 100.00, 1200.00)$$,
    pg_temp.id('A'), (select fecha - 3 from hoy), pg_temp.id('B'), (select fecha - 2 from hoy),
    pg_temp.id('A'), (select fecha - 1 from hoy)),
  'El rechazo debita la misma cuenta en su fecha y el depósito sigue a la vista'
);
select is(
  (select descripcion from v_movimiento_fondos where origen = 'cheque_rechazo' and origen_id = pg_temp.id('A')),
  'Rechazo cheque N° FC-A · Galicia · Librador SA',
  'La descripción del rechazo dice el número, el banco y el librador'
);
select is(pg_temp.saldo('fc100000-0000-4000-8000-000000000001'), 1200.00::numeric, 'Saldo del banco después del rechazo');
select is(
  (select deposito_cuenta_id from cheque where id = pg_temp.id('A')),
  'fc100000-0000-4000-8000-000000000001'::uuid,
  'El cheque rechazado conserva su cuenta de depósito'
);

-- Un rechazo en el mismo día del depósito queda después del depósito.
update cuenta_fondos set activa = true where id = 'fc100000-0000-4000-8000-000000000001';
update cheque set estado = 'rechazado',
  nd_comprobante_id = (select nd_comprobante_id from cheque where id = pg_temp.id('A')),
  estado_fecha = (select fecha - 2 from hoy)
where id = pg_temp.id('B');
select results_eq(
  format($$select origen, saldo from v_movimiento_fondos
           where cuenta_id = 'fc100000-0000-4000-8000-000000000001' and origen_id = %L
           order by fecha, creado_en, origen_id, origen$$, pg_temp.id('B')),
  $$values ('cheque_deposito'::text, 1300.00::numeric), ('cheque_rechazo', 1100.00)$$,
  'Depósito y rechazo del mismo día: primero el ingreso, después el egreso'
);

-- ---------------------------------------------------------------------
-- Lo que no mueve fondos
-- ---------------------------------------------------------------------

-- H: depositado antes de Finanzas (sin cuenta). Se simula sin el trigger nuevo.
reset role;
alter table cheque disable trigger trg_cheque_validar_deposito;
update cheque set estado = 'depositado' where id = pg_temp.id('H');
alter table cheque enable trigger trg_cheque_validar_deposito;
set local role authenticated;

select lives_ok(
  format('select rechazar_cheque(%L, null, %L)', pg_temp.id('H'), 'Sin fondos'),
  'Un depositado sin cuenta (histórico) se sigue rechazando'
);
select lives_ok(
  format('select rechazar_cheque(%L, null, %L)', pg_temp.id('C'), 'Sin fondos'),
  'Un cheque entregado se rechaza'
);
select is(
  (select estado from cheque where id = pg_temp.id('N')),
  'anulado',
  'Control: el cheque del recibo anulado quedó anulado'
);
select is(
  (select count(*)::integer from v_movimiento_fondos
   where origen_id in (pg_temp.id('C'), pg_temp.id('D'), pg_temp.id('H'), pg_temp.id('N'))),
  0,
  'Los cheques en cartera, entregados, anulados y los depositados sin cuenta no mueven fondos'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where cuenta_id = 'fc100000-0000-4000-8000-000000000002'),
  0,
  'La caja no recibe movimientos de cheques'
);

select * from finish();
rollback;
