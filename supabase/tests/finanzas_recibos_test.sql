-- =====================================================================
-- Tests de los recibos en las cuentas de fondos
-- (20261111000003_finanzas_recibos.sql): cuenta por medio de pago (caja
-- para el efectivo, banco para la transferencia, ninguna para cheques y
-- retenciones), obligatoria al emitir, sólo activas; movimientos de los
-- recibos emitidos en v_movimiento_fondos con el saldo acumulado; los
-- borradores y los anulados no aparecen; los recibos históricos sin
-- cuenta siguen valiendo. Corre con `supabase test db`. Todo se deshace al
-- final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_column('public', 'recibo_medio', 'cuenta_id', 'recibo_medio tiene cuenta_id');
select col_is_fk('public', 'recibo_medio', 'cuenta_id', 'recibo_medio.cuenta_id es una clave foránea');
select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.recibo_medio'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                         where attrelid = 'public.recibo_medio'::regclass and attname = 'cuenta_id')]),
  'r',
  'Una cuenta con medios de recibo no se borra (restrict)'
);

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, condicion_iva) values
  ('fe000000-0000-4000-8000-000000000001', 'Cliente fondos', 'Responsable Inscripto');
insert into recibo_punto_venta (numero, nombre) values (31, 'Recibos fondos');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table hoy as select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha;

insert into cuenta_fondos (id, tipo, nombre, banco) values
  ('fe100000-0000-4000-8000-000000000001', 'banco', 'Banco recibos', 'Banco Nación');
insert into cuenta_fondos (id, tipo, nombre) values
  ('fe100000-0000-4000-8000-000000000002', 'caja', 'Caja recibos');
insert into cuenta_fondos (id, tipo, nombre, activa) values
  ('fe100000-0000-4000-8000-000000000003', 'caja', 'Caja cerrada', false);

-- Saldo inicial de la caja, ayer.
insert into ajuste_fondos (id, cuenta_id, fecha, tipo, importe, concepto)
select 'fe200000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000002', fecha - 1, 'ingreso', 1000, 'Saldo inicial'
from hoy;

insert into recibo (id, punto_venta, cliente_id, fecha, total)
select 'fe300000-0000-4000-8000-000000000001', 31, 'fe000000-0000-4000-8000-000000000001', fecha, 330 from hoy;

-- ---------------------------------------------------------------------
-- Cuenta por medio de pago
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cuenta_id)
    values ('fe300000-0000-4000-8000-000000000001', 'efectivo', 10, 'fe100000-0000-4000-8000-000000000001')$$,
  'FN008', null, 'El efectivo va a una caja, no a un banco'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cuenta_id)
    values ('fe300000-0000-4000-8000-000000000001', 'transferencia', 10, 'fe100000-0000-4000-8000-000000000002')$$,
  'FN008', null, 'La transferencia va a un banco, no a una caja'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, retencion_tipo, certificado, fecha_retencion, cuenta_id)
    values ('fe300000-0000-4000-8000-000000000001', 'retencion', 10, 'ganancias', 'C-1', '2026-11-01',
            'fe100000-0000-4000-8000-000000000001')$$,
  'FN009', null, 'Una retención no mueve fondos: no lleva cuenta'
);

insert into cheque (id, recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe) values
  ('fe400000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000001', 'fisico', 'Galicia', 'FE-1', '2026-12-01', 30);

select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cheque_id, cuenta_id)
    values ('fe300000-0000-4000-8000-000000000001', 'cheque', 30, 'fe400000-0000-4000-8000-000000000001',
            'fe100000-0000-4000-8000-000000000001')$$,
  'FN009', null, 'Un cheque no mueve fondos al cobrarlo: no lleva cuenta'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cuenta_id)
    values ('fe300000-0000-4000-8000-000000000001', 'efectivo', 10, 'fe100000-0000-4000-8000-000000000003')$$,
  'FN004', null, 'Un medio no va a una cuenta inactiva'
);

-- R1: efectivo 100 + 50 sin caja todavía, transferencia 150 al banco y el cheque de 30.
select lives_ok(
  $$insert into recibo_medio (recibo_id, orden, tipo, importe) values
      ('fe300000-0000-4000-8000-000000000001', 1, 'efectivo', 100),
      ('fe300000-0000-4000-8000-000000000001', 2, 'efectivo', 50)$$,
  'Un borrador guarda efectivo sin caja'
);
insert into recibo_medio (recibo_id, orden, tipo, importe, cheque_id) values
  ('fe300000-0000-4000-8000-000000000001', 4, 'cheque', 30, 'fe400000-0000-4000-8000-000000000001');
insert into recibo_medio (recibo_id, orden, tipo, importe, referencia, cuenta_id) values
  ('fe300000-0000-4000-8000-000000000001', 3, 'transferencia', 150, 'TR-9', 'fe100000-0000-4000-8000-000000000001');

select is(
  (select count(*)::integer from v_movimiento_fondos where origen = 'recibo'),
  0,
  'Un borrador no mueve fondos'
);

select throws_ok(
  $$select emitir_recibo('fe300000-0000-4000-8000-000000000001')$$,
  'FN007', null, 'No se emite con efectivo sin caja'
);
select is(
  (select ultimo_numero from recibo_punto_venta where numero = 31),
  0::bigint,
  'La emisión rechazada no consume número'
);

update recibo_medio set cuenta_id = 'fe100000-0000-4000-8000-000000000002'
where recibo_id = 'fe300000-0000-4000-8000-000000000001' and tipo = 'efectivo';

select lives_ok(
  $$select emitir_recibo('fe300000-0000-4000-8000-000000000001')$$,
  'Con caja y banco elegidos, el recibo se emite'
);

-- ---------------------------------------------------------------------
-- Movimientos del recibo emitido
-- ---------------------------------------------------------------------

select is(
  (select count(*)::integer from v_movimiento_fondos
   where origen = 'recibo' and origen_id = 'fe300000-0000-4000-8000-000000000001'),
  2,
  'El recibo da un movimiento por cuenta: la caja y el banco (el cheque no)'
);
select results_eq(
  $$select origen, ingreso, egreso, importe, saldo from v_movimiento_fondos
    where cuenta_id = 'fe100000-0000-4000-8000-000000000002' order by fecha, creado_en$$,
  $$values ('ajuste'::text, 1000::numeric, 0::numeric, 1000::numeric, 1000::numeric),
           ('recibo'::text, 150::numeric, 0::numeric, 150::numeric, 1150::numeric)$$,
  'En la caja, el efectivo del recibo suma un ingreso (los dos medios juntos) y acumula el saldo'
);
select is(
  (select descripcion from v_movimiento_fondos
   where cuenta_id = 'fe100000-0000-4000-8000-000000000002' and origen = 'recibo'),
  'Recibo R-00031-00000001 · Cliente fondos',
  'La descripción dice el número del recibo y el cliente'
);
select is(
  (select fecha from v_movimiento_fondos
   where cuenta_id = 'fe100000-0000-4000-8000-000000000002' and origen = 'recibo'),
  (select fecha from hoy),
  'El movimiento lleva la fecha del recibo'
);
select is(
  (select ingreso from v_movimiento_fondos
   where cuenta_id = 'fe100000-0000-4000-8000-000000000001' and origen = 'recibo'),
  150::numeric,
  'En el banco, la transferencia suma un ingreso'
);
select is(
  (select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = 'fe100000-0000-4000-8000-000000000002'),
  1150::numeric,
  'El saldo actual de la caja incluye el recibo'
);
select is(
  (select banco from recibo_medio
   where recibo_id = 'fe300000-0000-4000-8000-000000000001' and tipo = 'transferencia'),
  null,
  'Cargada a mano, la transferencia no inventa el texto del banco'
);

-- ---------------------------------------------------------------------
-- Tipo de cuenta, borrado y cuenta inactiva al emitir
-- ---------------------------------------------------------------------

select throws_ok(
  $$update cuenta_fondos set tipo = 'banco' where id = 'fe100000-0000-4000-8000-000000000002'$$,
  'FN006', null, 'Una caja con recibos no pasa a banco'
);
select throws_ok(
  $$delete from cuenta_fondos where id = 'fe100000-0000-4000-8000-000000000002'$$,
  '23503', null, 'Una cuenta con recibos no se borra'
);

insert into recibo (id, punto_venta, cliente_id, fecha, total)
select 'fe300000-0000-4000-8000-000000000002', 31, 'fe000000-0000-4000-8000-000000000001', fecha, 20 from hoy;
insert into recibo_medio (recibo_id, tipo, importe, cuenta_id) values
  ('fe300000-0000-4000-8000-000000000002', 'efectivo', 20, 'fe100000-0000-4000-8000-000000000002');
update cuenta_fondos set activa = false where id = 'fe100000-0000-4000-8000-000000000002';

select throws_ok(
  $$select emitir_recibo('fe300000-0000-4000-8000-000000000002')$$,
  'FN004', null, 'No se emite con una caja que se desactivó después de cargar el borrador'
);
update cuenta_fondos set activa = true where id = 'fe100000-0000-4000-8000-000000000002';
select lives_ok(
  $$select emitir_recibo('fe300000-0000-4000-8000-000000000002')$$,
  'Reactivada la caja, se emite'
);
select is(
  (select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = 'fe100000-0000-4000-8000-000000000002'),
  1170::numeric,
  'El segundo recibo suma a la caja'
);

-- ---------------------------------------------------------------------
-- Anulación
-- ---------------------------------------------------------------------

select lives_ok(
  $$select anular_recibo('fe300000-0000-4000-8000-000000000002', 'Cargado dos veces')$$,
  'Se anula el segundo recibo'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = 'fe300000-0000-4000-8000-000000000002'),
  0,
  'Un recibo anulado no mueve fondos'
);
select is(
  (select saldo_actual from v_cuenta_fondos_saldo where cuenta_id = 'fe100000-0000-4000-8000-000000000002'),
  1150::numeric,
  'Al anularlo, la caja vuelve al saldo anterior'
);

-- ---------------------------------------------------------------------
-- Guardado desde la pantalla (guardar_borrador_recibo)
-- ---------------------------------------------------------------------

create temp table guardado (id uuid);
insert into guardado
select guardar_borrador_recibo(
  null,
  jsonb_build_object('cliente_id', 'fe000000-0000-4000-8000-000000000001', 'fecha', fecha),
  jsonb_build_array(
    jsonb_build_object('tipo', 'efectivo', 'importe', 10, 'cuenta_id', 'fe100000-0000-4000-8000-000000000002'),
    jsonb_build_object('tipo', 'transferencia', 'importe', 20, 'cuenta_id', 'fe100000-0000-4000-8000-000000000001',
                       'banco', 'texto viejo', 'referencia', 'TR-10'),
    jsonb_build_object('tipo', 'retencion', 'importe', 5, 'cuenta_id', 'fe100000-0000-4000-8000-000000000001',
                       'retencion_tipo', 'iva', 'certificado', 'C-9', 'fecha_retencion', fecha)
  ),
  '[]'::jsonb
)
from hoy;

select results_eq(
  $$select tipo, cuenta_id, banco from recibo_medio where recibo_id = (select id from guardado) order by orden$$,
  $$values ('efectivo'::text, 'fe100000-0000-4000-8000-000000000002'::uuid, null::text),
           ('transferencia'::text, 'fe100000-0000-4000-8000-000000000001'::uuid, 'Banco recibos'::text),
           ('retencion'::text, null::uuid, null::text)$$,
  'Se guarda la cuenta del efectivo y la transferencia (con el nombre de la cuenta como banco); la retención no la lleva'
);
select lives_ok(
  $$select emitir_recibo((select id from guardado))$$,
  'El recibo guardado desde la pantalla se emite'
);
select is(
  (select ingreso from v_movimiento_fondos
   where cuenta_id = 'fe100000-0000-4000-8000-000000000001' and origen_id = (select id from guardado)),
  20::numeric,
  'Su transferencia entra al banco'
);
select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = (select id from guardado)),
  2,
  'La retención no mueve fondos'
);

-- ---------------------------------------------------------------------
-- Recibos históricos (emitidos antes de las cuentas)
-- ---------------------------------------------------------------------

reset role;
insert into recibo (id, punto_venta, cliente_id, fecha, total)
select 'fe300000-0000-4000-8000-000000000003', 31, 'fe000000-0000-4000-8000-000000000001', fecha, 40 from hoy;
insert into recibo_medio (recibo_id, tipo, importe) values ('fe300000-0000-4000-8000-000000000003', 'efectivo', 40);
-- Como si se hubiera emitido antes de esta migración: sin la regla de la cuenta.
alter table recibo disable trigger trg_recibo_validar_cuentas;
select emitir_recibo('fe300000-0000-4000-8000-000000000003');
alter table recibo enable trigger trg_recibo_validar_cuentas;
set local role authenticated;

select is(
  (select count(*)::integer from v_movimiento_fondos where origen_id = 'fe300000-0000-4000-8000-000000000003'),
  0,
  'Un recibo histórico sin cuenta no aparece en los movimientos'
);
select lives_ok(
  $$select anular_recibo('fe300000-0000-4000-8000-000000000003', 'Histórico mal cargado')$$,
  'Un recibo histórico sin cuenta se sigue anulando'
);

select * from finish();
rollback;
