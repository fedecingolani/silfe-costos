-- =====================================================================
-- Tests de cobranzas: recibos con sus medios de pago, numeración propia,
-- cheques con su historial, imputaciones, anulación, vistas de saldo y
-- cuenta corriente, y permisos. Corre con `supabase test db`. Todo se
-- deshace al final.
--
-- Clientes:
--   C1 (…0001): facturas F1 60 y F2 70, más una de homologación (FH) y
--               un borrador (FB) que no cuentan. Recibo R1 de 100 que
--               imputa 60 + 40: saldos 0 / 30 y nada a favor.
--   C2 (…0002): factura FO 40 y nota de crédito NC2 25.
--   C3 (…0003): factura F3 50 (cuenta corriente), FC 30 (contado) y FP 20
--               (electrónica de producción). Recibo R3 de 80 que imputa
--               50: queda 30 a favor.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(220);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['recibo_punto_venta', 'recibo', 'recibo_medio', 'cheque', 'cheque_estado', 'imputacion']) as t;

select has_view('public', v, format('Existe %s', v))
from unnest(array['v_comprobante_saldo', 'v_cliente_saldo_a_favor', 'v_cuenta_corriente', 'v_cliente_saldo']) as v;

select has_function('public', 'emitir_recibo', array['uuid'], 'Existe emitir_recibo');
select has_function('public', 'anular_recibo', array['uuid', 'text'], 'Existe anular_recibo');
select col_default_is('public', 'recibo', 'estado', 'borrador', 'Un recibo nace en borrador');
select col_default_is('public', 'cheque', 'estado', 'en_cartera', 'Un cheque entra en cartera');
select is(
  (select ultimo_numero from recibo_punto_venta where numero = 1) >= 0,
  true,
  'El punto de venta de recibos 1 existe con su contador'
);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array[
  'recibo_punto_venta', 'recibo', 'recibo_medio', 'cheque', 'cheque_estado', 'imputacion',
  'v_comprobante_saldo', 'v_cliente_saldo_a_favor', 'v_cuenta_corriente', 'v_cliente_saldo'
]) as t;

select ok(not has_function_privilege('anon', f, 'execute'), format('anon no ejecuta %s', f))
from unnest(array['public.emitir_recibo(uuid)', 'public.anular_recibo(uuid, text)']) as f;
select ok(has_function_privilege('authenticated', f, 'execute'), format('authenticated ejecuta %s', f))
from unnest(array['public.emitir_recibo(uuid)', 'public.anular_recibo(uuid, text)']) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000001', 'Cliente cobranzas', 'Responsable Inscripto'),
  ('cb000000-0000-0000-0000-000000000002', 'Otro cliente cobranzas', 'Monotributista'),
  ('cb000000-0000-0000-0000-000000000003', 'Cliente que paga de más', 'Responsable Inscripto');

insert into punto_venta (numero, nombre, electronico) values
  (9107, 'Electrónico cobranzas', true),
  (9199, 'Interno cobranzas', false);

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha)
values
  ('cb100000-0000-0000-0000-000000000001', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000001', 'cuenta_corriente', 60, '2026-10-01'),
  ('cb100000-0000-0000-0000-000000000002', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000001', 'cuenta_corriente', 70, '2026-10-02'),
  ('cb100000-0000-0000-0000-000000000003', 9107, 'homologacion', 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000001', 'cuenta_corriente', 999, '2026-10-03'),
  ('cb100000-0000-0000-0000-000000000004', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000001', 'cuenta_corriente', 10, '2026-10-04'),
  ('cb100000-0000-0000-0000-000000000005', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000002', 'cuenta_corriente', 40, '2026-10-01'),
  ('cb100000-0000-0000-0000-000000000006', 9199, null, 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000002', 'cuenta_corriente', 25, '2026-10-05'),
  ('cb100000-0000-0000-0000-000000000007', 9107, 'homologacion', 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000002', 'cuenta_corriente', 5, '2026-10-05'),
  ('cb100000-0000-0000-0000-000000000008', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000003', 'cuenta_corriente', 50, '2026-10-01'),
  ('cb100000-0000-0000-0000-000000000009', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000003', 'contado', 30, '2026-10-02'),
  ('cb100000-0000-0000-0000-000000000010', 9107, 'produccion', 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000003', 'cuenta_corriente', 20, '2026-10-03'),
  ('cb100000-0000-0000-0000-000000000011', 9199, null, 'nota_debito', 'A', 2,
   'cb000000-0000-0000-0000-000000000003', 'cuenta_corriente', 0, '2026-10-20'),
  ('cb100000-0000-0000-0000-000000000012', 9199, null, 'nota_debito', 'A', 2,
   'cb000000-0000-0000-0000-000000000001', 'cuenta_corriente', 0, '2026-10-20');

-- No electrónicos: de borrador a autorizado con su número.
update comprobante set estado = 'autorizado', numero = 1 where id = 'cb100000-0000-0000-0000-000000000001';
update comprobante set estado = 'autorizado', numero = 2 where id = 'cb100000-0000-0000-0000-000000000002';
update comprobante set estado = 'autorizado', numero = 3 where id = 'cb100000-0000-0000-0000-000000000005';
update comprobante set estado = 'autorizado', numero = 4 where id = 'cb100000-0000-0000-0000-000000000008';
update comprobante set estado = 'autorizado', numero = 5 where id = 'cb100000-0000-0000-0000-000000000009';
update comprobante set estado = 'autorizado', numero = 1 where id = 'cb100000-0000-0000-0000-000000000006';
-- Electrónicos: verificando y autorizado con CAE.
update comprobante set estado = 'verificando', intento_numero = 1
where id in ('cb100000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000007',
             'cb100000-0000-0000-0000-000000000010');
update comprobante set estado = 'autorizado', numero = 1, cae = '12345678901234', cae_vencimiento = '2026-12-31'
where id in ('cb100000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000007',
             'cb100000-0000-0000-0000-000000000010');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
-- El punto de venta de recibos lo crea el administrador: authenticated no
-- escribe en recibo_punto_venta (ver 20261028000001_cobranzas_cartera.sql).
insert into recibo_punto_venta (numero, nombre) values (9, 'Recibos de prueba');

set local role authenticated;

-- ---------------------------------------------------------------------
-- Alta de recibos y medios
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into recibo (punto_venta, cliente_id, estado) values (9, 'cb000000-0000-0000-0000-000000000001', 'emitido')$$,
  'CB002', null, 'Un recibo se crea en borrador'
);
select throws_ok(
  $$insert into recibo (punto_venta, cliente_id, numero) values (9, 'cb000000-0000-0000-0000-000000000001', 7)$$,
  '23514', null, 'Un borrador no tiene número'
);

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000000', 9, 'cb000000-0000-0000-0000-000000000001', '2026-10-10', 0),
  ('cb200000-0000-0000-0000-000000000001', 9, 'cb000000-0000-0000-0000-000000000001', '2026-10-10', 90);

select is(
  (select fecha from recibo where id = 'cb200000-0000-0000-0000-000000000000'),
  '2026-10-10'::date,
  'El recibo guarda su fecha'
);
select is(
  (select numero from recibo where id = 'cb200000-0000-0000-0000-000000000000'),
  null,
  'Un borrador no tiene número'
);

select throws_ok(
  $$select emitir_recibo('cb200000-0000-0000-0000-000000000000')$$,
  'CB003', null, 'No se emite un recibo sin medios de pago'
);

select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000001', 'efectivo', 0)$$,
  '23514', null, 'Un medio de pago tiene importe positivo'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000001', 'tarjeta', 10)$$,
  '23514', null, 'El tipo de medio es uno de los admitidos'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000001', 'cheque', 10)$$,
  '23514', null, 'Un medio cheque apunta a su cheque'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, retencion_tipo, certificado, fecha_retencion)
    values ('cb200000-0000-0000-0000-000000000001', 'retencion', 10, 'iibb', 'C-1', '2026-10-10')$$,
  '23514', null, 'Una retención de IIBB necesita la jurisdicción'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, retencion_tipo, fecha_retencion)
    values ('cb200000-0000-0000-0000-000000000001', 'retencion', 10, 'ganancias', '2026-10-10')$$,
  '23514', null, 'Una retención necesita el certificado'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, retencion_tipo, certificado, fecha_retencion)
    values ('cb200000-0000-0000-0000-000000000001', 'retencion', 10, 'municipal', 'C-1', '2026-10-10')$$,
  '23514', null, 'La retención es de IIBB, Ganancias, IVA o SUSS'
);
select lives_ok(
  $$insert into recibo_medio (recibo_id, orden, tipo, importe, retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion)
    values ('cb200000-0000-0000-0000-000000000001', 1, 'retencion', 10, 'iibb', 'Río Negro', 'C-1', '2026-10-10')$$,
  'Una retención de IIBB con jurisdicción y certificado se carga'
);
select lives_ok(
  $$insert into recibo_medio (recibo_id, orden, tipo, importe, banco, referencia)
    values ('cb200000-0000-0000-0000-000000000001', 2, 'transferencia', 90, 'Banco Nación', 'TR-1')$$,
  'Una transferencia se carga'
);

-- Imputaciones del borrador: F1 60 y F2 40.
select throws_ok(
  $$insert into imputacion (comprobante_id, importe) values ('cb100000-0000-0000-0000-000000000001', 10)$$,
  '23514', null, 'Una imputación sale de un recibo o de una nota de crédito'
);
select throws_ok(
  $$insert into imputacion (recibo_id, nota_credito_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000006',
            'cb100000-0000-0000-0000-000000000001', 10)$$,
  '23514', null, 'Una imputación no sale de un recibo y una nota de crédito a la vez'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 0)$$,
  '23514', null, 'Una imputación tiene importe positivo'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000003', 10)$$,
  'CB007', null, 'Un comprobante de homologación no recibe imputaciones'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000004', 10)$$,
  'CB007', null, 'Un borrador no recibe imputaciones'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000006', 10)$$,
  'CB007', null, 'Una nota de crédito no es un débito'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000005', 10)$$,
  'CB008', null, 'El recibo y el comprobante son del mismo cliente'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 61)$$,
  'CB006', null, 'No se imputa más que el total del comprobante'
);
select lives_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 60),
           ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000002', 30)$$,
  'Un borrador imputa 60 y 30'
);
select throws_ok(
  $$update imputacion set importe = 31
    where recibo_id = 'cb200000-0000-0000-0000-000000000001' and comprobante_id = 'cb100000-0000-0000-0000-000000000002'$$,
  'CB005', null, 'Las imputaciones no superan el total del recibo (90)'
);

-- Emisión
select throws_ok(
  $$update recibo set estado = 'emitido', numero = 5 where id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB014', null, 'El número lo asigna emitir_recibo'
);
select throws_ok(
  $$select emitir_recibo('cb200000-0000-0000-0000-000000000001')$$,
  'CB004', null, 'El total del recibo es la suma de sus medios'
);
select is(
  (select ultimo_numero from recibo_punto_venta where numero = 9),
  0::bigint,
  'Una emisión fallida no consume número'
);

update recibo set total = 100 where id = 'cb200000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000002', 1)$$,
  '23505', null, 'Una sola imputación por recibo y comprobante'
);
update imputacion set importe = 40
where recibo_id = 'cb200000-0000-0000-0000-000000000001' and comprobante_id = 'cb100000-0000-0000-0000-000000000002';

select is(
  emitir_recibo('cb200000-0000-0000-0000-000000000001'),
  1::bigint,
  'emitir_recibo asigna el primer número'
);
select is(
  (select numero_texto from recibo where id = 'cb200000-0000-0000-0000-000000000001'),
  'R-00009-00000001',
  'El número se muestra R-00009-00000001'
);
select isnt(
  (select emitido_en from recibo where id = 'cb200000-0000-0000-0000-000000000001'),
  null,
  'La emisión guarda el momento'
);

-- ---------------------------------------------------------------------
-- Vistas: 2 facturas 60 / 70, recibo de 100 que imputa 60 + 40
-- ---------------------------------------------------------------------

select results_eq(
  $$select comprobante_id::text, total, imputado, saldo, estado_pago
    from v_comprobante_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000001' order by fecha$$,
  $$values ('cb100000-0000-0000-0000-000000000001', 60.00::numeric, 60.00::numeric, 0.00::numeric, 'cancelado'),
           ('cb100000-0000-0000-0000-000000000002', 70.00::numeric, 40.00::numeric, 30.00::numeric, 'parcial')$$,
  'F1 queda cancelada y F2 con 30 pendientes; ni la de homologación ni el borrador cuentan'
);
select is(
  (select coalesce(sum(disponible), 0) from v_cliente_saldo_a_favor where cliente_id = 'cb000000-0000-0000-0000-000000000001'),
  0::numeric,
  'No queda nada a favor'
);
select results_eq(
  $$select tipo, debe, haber, saldo from v_cuenta_corriente
    where cliente_id = 'cb000000-0000-0000-0000-000000000001'$$,
  $$values ('factura', 60.00::numeric, 0::numeric, 60.00::numeric),
           ('factura', 70.00::numeric, 0::numeric, 130.00::numeric),
           ('recibo', 0::numeric, 100.00::numeric, 30.00::numeric)$$,
  'La cuenta corriente tiene debe, haber y saldo acumulado por fecha'
);
select results_eq(
  $$select saldo, deuda_pendiente, saldo_a_favor from v_cliente_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000001'$$,
  $$values (30.00::numeric, 30.00::numeric, 0::numeric)$$,
  'El saldo del cliente es 30'
);
select is(
  (select pendiente_mas_viejo from v_cliente_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000001'),
  '2026-10-02'::date,
  'El comprobante pendiente más viejo es F2'
);

-- ---------------------------------------------------------------------
-- Un recibo emitido no cambia
-- ---------------------------------------------------------------------

select throws_ok(
  $$update recibo set observaciones = 'otra' where id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB001', null, 'Un recibo emitido no se modifica'
);
select throws_ok(
  $$update recibo set estado = 'borrador', numero = null where id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB002', null, 'Un recibo emitido no vuelve a borrador'
);
select throws_ok(
  $$delete from recibo where id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB001', null, 'Un recibo emitido no se borra'
);
select throws_ok(
  $$select emitir_recibo('cb200000-0000-0000-0000-000000000001')$$,
  'CB002', null, 'Un recibo emitido no se vuelve a emitir'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000001', 'efectivo', 5)$$,
  'CB001', null, 'A un recibo emitido no se le agregan medios'
);
select throws_ok(
  $$update recibo_medio set importe = 80 where recibo_id = 'cb200000-0000-0000-0000-000000000001' and tipo = 'transferencia'$$,
  'CB001', null, 'Los medios de un recibo emitido no cambian'
);
select throws_ok(
  $$delete from recibo_medio where recibo_id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB001', null, 'Los medios de un recibo emitido no se borran'
);
select throws_ok(
  $$update imputacion set importe = 39 where recibo_id = 'cb200000-0000-0000-0000-000000000001'
      and comprobante_id = 'cb100000-0000-0000-0000-000000000002'$$,
  'CB001', null, 'Las imputaciones de un recibo emitido no cambian'
);
select throws_ok(
  $$delete from imputacion where recibo_id = 'cb200000-0000-0000-0000-000000000001'$$,
  'CB001', null, 'Las imputaciones de un recibo emitido no se borran'
);
select throws_ok(
  $$select anular_recibo('cb200000-0000-0000-0000-000000000000', 'motivo')$$,
  'CB002', null, 'Sólo se anula un recibo emitido'
);
select throws_ok(
  $$update recibo set estado = 'anulado', motivo_anulacion = 'x' where id = 'cb200000-0000-0000-0000-000000000000'$$,
  'CB002', null, 'Un borrador no pasa a anulado'
);
select throws_ok(
  $$select emitir_recibo('cb2fffff-0000-0000-0000-000000000000')$$,
  'CB013', null, 'emitir_recibo informa un recibo inexistente'
);
select throws_ok(
  $$select anular_recibo('cb2fffff-0000-0000-0000-000000000000', 'motivo')$$,
  'CB013', null, 'anular_recibo informa un recibo inexistente'
);

-- Un borrador sí se borra, con sus medios e imputaciones.
select lives_ok(
  $$delete from recibo where id = 'cb200000-0000-0000-0000-000000000000'$$,
  'Un borrador se borra'
);

-- Un borrador imputado no cuenta para el saldo, pero sí para su propio tope.
insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000002', 9, 'cb000000-0000-0000-0000-000000000001', '2026-10-11', 20);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 25)$$,
  'CB005', null, 'Un recibo no imputa más que su total'
);
update recibo set total = 40 where id = 'cb200000-0000-0000-0000-000000000002';
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 31)$$,
  'CB006', null, 'No se imputa más que el saldo pendiente (30)'
);
insert into imputacion (recibo_id, comprobante_id, importe)
values ('cb200000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 30);
select is(
  (select saldo from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000002'),
  30.00::numeric,
  'Una imputación de un borrador no cancela'
);
delete from recibo where id = 'cb200000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------
-- Cheques
-- ---------------------------------------------------------------------

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000006', 9, 'cb000000-0000-0000-0000-000000000001', '2026-10-12', 30);

select throws_ok(
  $$insert into cheque (recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe, estado)
    values ('cb200000-0000-0000-0000-000000000006', 'cb000000-0000-0000-0000-000000000001', 'fisico', 'Galicia',
            '0001', '2026-11-01', 30, 'depositado')$$,
  'CB009', null, 'Un cheque entra en cartera'
);
select throws_ok(
  $$insert into cheque (recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe)
    values ('cb200000-0000-0000-0000-000000000006', 'cb000000-0000-0000-0000-000000000002', 'fisico', 'Galicia',
            '0001', '2026-11-01', 30)$$,
  'CB008', null, 'El cheque es del cliente del recibo'
);
select throws_ok(
  $$insert into cheque (recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe)
    values ('cb200000-0000-0000-0000-000000000006', 'cb000000-0000-0000-0000-000000000001', 'fisico', 'Galicia',
            '0001', '2026-11-01', 0)$$,
  '23514', null, 'Un cheque tiene importe positivo'
);
select lives_ok(
  $$insert into cheque (id, recibo_id, cliente_id, tipo, banco, numero, fecha_emision, fecha_pago, librador, librador_cuit, importe)
    values ('cb300000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000006',
            'cb000000-0000-0000-0000-000000000001', 'fisico', 'Galicia', '0001', '2026-10-12', '2026-11-01',
            'Librador SA', '30712345671', 30)$$,
  'Un cheque se carga en el borrador'
);
select throws_ok(
  $$update cheque set estado = 'depositado' where id = 'cb300000-0000-0000-0000-000000000001'$$,
  'CB009', null, 'El cheque de un borrador no cambia de estado'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cheque_id)
    values ('cb200000-0000-0000-0000-000000000006', 'cheque', 25, 'cb300000-0000-0000-0000-000000000001')$$,
  'CB012', null, 'El medio cheque lleva el importe del cheque'
);
select throws_ok(
  $$insert into recibo_medio (recibo_id, tipo, importe, cheque_id)
    values ('cb200000-0000-0000-0000-000000000006', 'echeq', 30, 'cb300000-0000-0000-0000-000000000001')$$,
  'CB012', null, 'Un cheque físico no es un e-cheq'
);
insert into recibo_medio (recibo_id, tipo, importe, cheque_id)
values ('cb200000-0000-0000-0000-000000000006', 'cheque', 30, 'cb300000-0000-0000-0000-000000000001');
insert into imputacion (recibo_id, comprobante_id, importe)
values ('cb200000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000002', 30);

select is(
  emitir_recibo('cb200000-0000-0000-0000-000000000006'),
  2::bigint,
  'El siguiente recibo toma el número siguiente'
);
select is(
  (select estado_pago from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000002'),
  'cancelado',
  'F2 queda cancelada con el cheque'
);
select throws_ok(
  $$update cheque set importe = 31 where id = 'cb300000-0000-0000-0000-000000000001'$$,
  'CB017', null, 'Los datos de un cheque de un recibo emitido no cambian'
);
select throws_ok(
  $$update cheque set estado = 'anulado' where id = 'cb300000-0000-0000-0000-000000000001'$$,
  'CB009', null, 'Un cheque se anula sólo con su recibo'
);
select is(
  (select count(*) from cheque_estado where cheque_id = 'cb300000-0000-0000-0000-000000000001'),
  1::bigint,
  'El alta del cheque queda en el historial'
);
select throws_ok(
  $$update cheque_estado set observacion = 'x' where cheque_id = 'cb300000-0000-0000-0000-000000000001'$$,
  'CB011', null, 'El historial no se modifica'
);
select throws_ok(
  $$delete from cheque_estado where cheque_id = 'cb300000-0000-0000-0000-000000000001'$$,
  'CB011', null, 'El historial no se borra'
);
select throws_ok(
  $$insert into cheque_estado (cheque_id, estado) values ('cb300000-0000-0000-0000-000000000001', 'depositado')$$,
  'CB011', null, 'El historial lo escribe el cambio de estado'
);

-- ---------------------------------------------------------------------
-- Anulación
-- ---------------------------------------------------------------------

select throws_ok(
  $$select anular_recibo('cb200000-0000-0000-0000-000000000006', '  ')$$,
  'CB019', null, 'Anular pide un motivo'
);
select lives_ok(
  $$select anular_recibo('cb200000-0000-0000-0000-000000000006', 'Cargado dos veces')$$,
  'Un recibo emitido con sus cheques en cartera se anula'
);
select results_eq(
  $$select estado, motivo_anulacion, anulado_en is not null from recibo where id = 'cb200000-0000-0000-0000-000000000006'$$,
  $$values ('anulado', 'Cargado dos veces', true)$$,
  'El recibo queda anulado con su motivo'
);
select is(
  (select count(*) from imputacion where recibo_id = 'cb200000-0000-0000-0000-000000000006'),
  0::bigint,
  'La anulación deshace sus imputaciones'
);
select is(
  (select saldo from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000002'),
  30.00::numeric,
  'F2 vuelve a tener 30 pendientes'
);
select is(
  (select estado from cheque where id = 'cb300000-0000-0000-0000-000000000001'),
  'anulado',
  'El cheque sale de la cartera'
);
select is(
  (select estado from cheque_estado where cheque_id = 'cb300000-0000-0000-0000-000000000001' order by id desc limit 1),
  'anulado',
  'La anulación del cheque queda en el historial'
);
select is(
  (select count(*) from recibo_medio where recibo_id = 'cb200000-0000-0000-0000-000000000006'),
  1::bigint,
  'Los medios del anulado se conservan'
);
select throws_ok(
  $$update recibo set observaciones = 'x' where id = 'cb200000-0000-0000-0000-000000000006'$$,
  'CB001', null, 'Un recibo anulado no cambia'
);
select throws_ok(
  $$select anular_recibo('cb200000-0000-0000-0000-000000000006', 'otra vez')$$,
  'CB002', null, 'Un anulado no se vuelve a anular'
);
select is(
  (select count(*) from v_cuenta_corriente where recibo_id = 'cb200000-0000-0000-0000-000000000006'),
  0::bigint,
  'Un recibo anulado no mueve la cuenta corriente'
);

-- ---------------------------------------------------------------------
-- Pago de más: queda a favor (C3)
-- ---------------------------------------------------------------------

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000003', 9, 'cb000000-0000-0000-0000-000000000003', '2026-10-13', 80);
insert into cheque (id, recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe)
values ('cb300000-0000-0000-0000-000000000002', 'cb200000-0000-0000-0000-000000000003',
        'cb000000-0000-0000-0000-000000000003', 'echeq', 'Macro', 'E-77', '2026-11-15', 50);
insert into recibo_medio (recibo_id, orden, tipo, importe, cheque_id) values
  ('cb200000-0000-0000-0000-000000000003', 1, 'echeq', 50, 'cb300000-0000-0000-0000-000000000002');
insert into recibo_medio (recibo_id, orden, tipo, importe) values
  ('cb200000-0000-0000-0000-000000000003', 2, 'efectivo', 30);
insert into imputacion (recibo_id, comprobante_id, importe)
values ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000008', 50);

select is(
  emitir_recibo('cb200000-0000-0000-0000-000000000003'),
  3::bigint,
  'Un recibo anulado no libera su número'
);
select results_eq(
  $$select origen, recibo_id::text, total, imputado, disponible from v_cliente_saldo_a_favor
    where cliente_id = 'cb000000-0000-0000-0000-000000000003'$$,
  $$values ('recibo', 'cb200000-0000-0000-0000-000000000003', 80.00::numeric, 50.00::numeric, 30.00::numeric)$$,
  'Lo no imputado queda a favor'
);
select results_eq(
  $$select comprobante_id::text, saldo, estado_pago from v_comprobante_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000003' order by fecha$$,
  $$values ('cb100000-0000-0000-0000-000000000008', 0.00::numeric, 'cancelado'),
           ('cb100000-0000-0000-0000-000000000009', 30.00::numeric, 'pendiente'),
           ('cb100000-0000-0000-0000-000000000010', 20.00::numeric, 'pendiente')$$,
  'Las facturas de producción y no electrónicas cuentan con su estado de pago'
);
select results_eq(
  $$select saldo, deuda_pendiente, saldo_a_favor from v_cliente_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000003'$$,
  $$values (20.00::numeric, 50.00::numeric, 30.00::numeric)$$,
  'Saldo = pendientes − a favor'
);

-- Saldo a favor aplicado automáticamente
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe, automatica)
    values ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000009', 10, true)$$,
  'CB015', null, 'Una factura de contado no consume saldo a favor'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000010', 20)$$,
  'CB001', null, 'A un recibo emitido sólo se le agregan imputaciones automáticas'
);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe, automatica)
    values ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000010', 31, true)$$,
  'CB005', null, 'La aplicación automática no supera lo disponible del recibo'
);
select lives_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe, automatica)
    values ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000010', 20, true)$$,
  'El saldo a favor se imputa automáticamente a una factura de cuenta corriente'
);
select results_eq(
  $$select saldo, deuda_pendiente, saldo_a_favor from v_cliente_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000003'$$,
  $$values (20.00::numeric, 30.00::numeric, 10.00::numeric)$$,
  'Después de aplicarlo quedan 10 a favor'
);

-- ---------------------------------------------------------------------
-- Cartera: transiciones (C3)
-- ---------------------------------------------------------------------

select lives_ok(
  $$update cheque set estado = 'depositado', estado_fecha = '2026-11-15', estado_observacion = 'Depositado en Nación'
    where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'en_cartera → depositado'
);
select throws_ok(
  $$select anular_recibo('cb200000-0000-0000-0000-000000000003', 'error')$$,
  'CB010', null, 'No se anula un recibo con un cheque que ya salió de la cartera'
);
select throws_ok(
  $$update cheque set estado = 'en_cartera' where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'CB009', null, 'depositado no vuelve a en_cartera'
);
select throws_ok(
  $$update cheque set estado = 'rechazado' where id = 'cb300000-0000-0000-0000-000000000002'$$,
  '23514', null, 'Un cheque rechazado necesita su nota de débito'
);
select throws_ok(
  $$update cheque set estado = 'rechazado', nd_comprobante_id = 'cb100000-0000-0000-0000-000000000012'
    where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'CB018', null, 'La nota de débito es del cliente del cheque'
);
select throws_ok(
  $$update cheque set estado = 'rechazado', nd_comprobante_id = 'cb100000-0000-0000-0000-000000000008'
    where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'CB018', null, 'El rechazo se vincula a una nota de débito'
);
select lives_ok(
  $$update cheque set estado = 'rechazado', nd_comprobante_id = 'cb100000-0000-0000-0000-000000000011'
    where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'depositado → rechazado con su nota de débito'
);
select throws_ok(
  $$update cheque set estado = 'en_cartera', nd_comprobante_id = null where id = 'cb300000-0000-0000-0000-000000000002'$$,
  'CB009', null, 'Un rechazado no cambia más de estado'
);
select results_eq(
  $$select estado, fecha, observacion from cheque_estado
    where cheque_id = 'cb300000-0000-0000-0000-000000000002' order by id$$,
  $$values ('en_cartera', (now() at time zone 'America/Argentina/Buenos_Aires')::date, null::text),
           ('depositado', '2026-11-15'::date, 'Depositado en Nación'),
           ('rechazado', '2026-11-15'::date, 'Depositado en Nación')$$,
  'Cada cambio de estado queda en el historial'
);

-- Entregado (C2)
insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000009', 9, 'cb000000-0000-0000-0000-000000000002', '2026-10-14', 10);
insert into cheque (id, recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe)
values ('cb300000-0000-0000-0000-000000000003', 'cb200000-0000-0000-0000-000000000009',
        'cb000000-0000-0000-0000-000000000002', 'fisico', 'Santander', '0099', '2026-12-01', 10);
insert into recibo_medio (recibo_id, tipo, importe, cheque_id)
values ('cb200000-0000-0000-0000-000000000009', 'cheque', 10, 'cb300000-0000-0000-0000-000000000003');
do $$ begin perform emitir_recibo('cb200000-0000-0000-0000-000000000009'); end $$;

select throws_ok(
  $$update cheque set estado = 'entregado' where id = 'cb300000-0000-0000-0000-000000000003'$$,
  '23514', null, 'Un cheque entregado dice a quién'
);
select lives_ok(
  $$update cheque set estado = 'entregado', entregado_a = 'Proveedor de lonas'
    where id = 'cb300000-0000-0000-0000-000000000003'$$,
  'en_cartera → entregado'
);
select throws_ok(
  $$update cheque set estado = 'depositado' where id = 'cb300000-0000-0000-0000-000000000003'$$,
  'CB009', null, 'entregado sólo pasa a rechazado'
);

-- ---------------------------------------------------------------------
-- Notas de crédito (C2): crédito a imputar o a favor
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into imputacion (nota_credito_id, comprobante_id, importe, automatica)
    values ('cb100000-0000-0000-0000-000000000007', 'cb100000-0000-0000-0000-000000000005', 1, true)$$,
  'CB016', null, 'Una nota de crédito de homologación no imputa'
);
select throws_ok(
  $$insert into imputacion (nota_credito_id, comprobante_id, importe, automatica)
    values ('cb100000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000001', 1, true)$$,
  'CB008', null, 'La nota de crédito imputa a comprobantes de su cliente'
);
select throws_ok(
  $$insert into imputacion (nota_credito_id, comprobante_id, importe, automatica)
    values ('cb100000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000005', 1, true)$$,
  'CB016', null, 'El origen es una nota de crédito'
);
select throws_ok(
  $$insert into imputacion (nota_credito_id, comprobante_id, importe, automatica)
    values ('cb100000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000005', 26, true)$$,
  'CB005', null, 'Una nota de crédito no imputa más que su total'
);
select lives_ok(
  $$insert into imputacion (nota_credito_id, comprobante_id, importe, automatica)
    values ('cb100000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000005', 10, true)$$,
  'Una nota de crédito imputa a una factura de su cliente'
);
select throws_ok(
  $$update imputacion set importe = 9 where nota_credito_id = 'cb100000-0000-0000-0000-000000000006'$$,
  'CB001', null, 'Las imputaciones de una nota de crédito no cambian'
);
select throws_ok(
  $$delete from imputacion where nota_credito_id = 'cb100000-0000-0000-0000-000000000006'$$,
  'CB001', null, 'Las imputaciones de una nota de crédito no se borran'
);
select results_eq(
  $$select origen, coalesce(recibo_id, nota_credito_id)::text, disponible from v_cliente_saldo_a_favor
    where cliente_id = 'cb000000-0000-0000-0000-000000000002' order by fecha$$,
  $$values ('nota_credito', 'cb100000-0000-0000-0000-000000000006', 15.00::numeric),
           ('recibo', 'cb200000-0000-0000-0000-000000000009', 10.00::numeric)$$,
  'Lo no imputado de la nota de crédito y del recibo queda a favor; la de homologación no cuenta'
);
select results_eq(
  $$select tipo, debe, haber, saldo from v_cuenta_corriente
    where cliente_id = 'cb000000-0000-0000-0000-000000000002'$$,
  $$values ('factura', 40.00::numeric, 0::numeric, 40.00::numeric),
           ('nota_credito', 0::numeric, 25.00::numeric, 15.00::numeric),
           ('recibo', 0::numeric, 10.00::numeric, 5.00::numeric)$$,
  'La nota de crédito va al haber de la cuenta corriente'
);
select results_eq(
  $$select saldo, deuda_pendiente, saldo_a_favor from v_cliente_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000002'$$,
  $$values (5.00::numeric, 30.00::numeric, 25.00::numeric)$$,
  'Saldo de C2 = 30 pendientes − 25 a favor'
);

-- ---------------------------------------------------------------------
-- Pago de una factura de contado (C3, FC 30)
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into recibo (punto_venta, cliente_id, comprobante_contado_id, total)
    values (9, 'cb000000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000008', 50)$$,
  'CB015', null, 'El pago de contado es de una factura de contado'
);
select throws_ok(
  $$insert into recibo (punto_venta, cliente_id, comprobante_contado_id, total)
    values (9, 'cb000000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000009', 30)$$,
  'CB008', null, 'El pago de contado es del cliente de la factura'
);
insert into recibo (id, punto_venta, cliente_id, comprobante_contado_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000004', 9, 'cb000000-0000-0000-0000-000000000003',
   'cb100000-0000-0000-0000-000000000009', '2026-10-15', 25);
insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000004', 'efectivo', 25);
select throws_ok(
  $$insert into imputacion (recibo_id, comprobante_id, importe)
    values ('cb200000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000010', 5)$$,
  'CB015', null, 'El pago de contado sólo imputa a su factura'
);
insert into imputacion (recibo_id, comprobante_id, importe)
values ('cb200000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000009', 25);
select throws_ok(
  $$select emitir_recibo('cb200000-0000-0000-0000-000000000004')$$,
  'CB015', null, 'El pago de contado es por el total exacto'
);
update recibo set total = 30 where id = 'cb200000-0000-0000-0000-000000000004';
update recibo_medio set importe = 30 where recibo_id = 'cb200000-0000-0000-0000-000000000004';
update imputacion set importe = 30 where recibo_id = 'cb200000-0000-0000-0000-000000000004';
select lives_ok(
  $$select emitir_recibo('cb200000-0000-0000-0000-000000000004')$$,
  'El pago de contado por el total se emite'
);
select is(
  (select estado_pago from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000009'),
  'cancelado',
  'La factura de contado queda cancelada'
);

-- ---------------------------------------------------------------------
-- Numeración sin huecos y saldo coherente
-- ---------------------------------------------------------------------

select is(
  (select array_agg(numero order by numero) from recibo where punto_venta = 9 and numero is not null),
  array[1, 2, 3, 4, 5]::bigint[],
  'Los recibos se numeran sin huecos'
);
select is(
  (select ultimo_numero from recibo_punto_venta where numero = 9),
  5::bigint,
  'El contador queda en el último número'
);
select is(
  (select count(*) from v_cliente_saldo
   where cliente_id::text like 'cb000000-%' and saldo <> deuda_pendiente - saldo_a_favor),
  0::bigint,
  'En todos los clientes, saldo = pendientes − a favor'
);
select is(
  (select count(*) from v_cuenta_corriente where comprobante_id in (
    'cb100000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000007')),
  0::bigint,
  'Los comprobantes de homologación no están en la cuenta corriente'
);

-- ---------------------------------------------------------------------
-- guardar_borrador_recibo: guardado atómico de un borrador (C4)
-- ---------------------------------------------------------------------

reset role;
insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000004', 'Cliente del editor de cobranzas', 'Responsable Inscripto');
insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha)
values
  ('cb100000-0000-0000-0000-000000000041', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000004', 'cuenta_corriente', 50, '2026-10-01');
update comprobante set estado = 'autorizado', numero = 41 where id = 'cb100000-0000-0000-0000-000000000041';
set local role authenticated;

select ok(not has_function_privilege('anon', 'public.guardar_borrador_recibo(uuid, jsonb, jsonb, jsonb)', 'execute'),
  'anon no ejecuta guardar_borrador_recibo');
select ok(has_function_privilege('authenticated', 'public.guardar_borrador_recibo(uuid, jsonb, jsonb, jsonb)', 'execute'),
  'authenticated ejecuta guardar_borrador_recibo');

create temporary table t_borrador (id uuid) on commit drop;
insert into t_borrador
select guardar_borrador_recibo(
  null,
  '{"cliente_id": "cb000000-0000-0000-0000-000000000004", "fecha": "2026-10-18", "observaciones": " Primera "}',
  '[{"tipo": "cheque", "importe": 40, "cheque": {"banco": "Galicia", "numero": "123", "fecha_pago": "2026-11-01", "librador_cuit": "20-12345678-9"}},
    {"tipo": "retencion", "importe": 10, "retencion_tipo": "iibb", "retencion_jurisdiccion": "Río Negro", "certificado": "C-1", "fecha_retencion": "2026-10-18"}]',
  '[{"comprobante_id": "cb100000-0000-0000-0000-000000000041", "importe": 30}, {"comprobante_id": "cb100000-0000-0000-0000-000000000041", "importe": 0}]'
);

select results_eq(
  $$select r.estado, r.total, r.observaciones, (select count(*) from recibo_medio m where m.recibo_id = r.id),
           (select count(*) from cheque ch where ch.recibo_id = r.id and ch.estado = 'en_cartera'),
           (select sum(importe) from imputacion i where i.recibo_id = r.id)
    from recibo r where r.id = (select id from t_borrador)$$,
  $$values ('borrador', 50.00::numeric, 'Primera', 2::bigint, 1::bigint, 30.00::numeric)$$,
  'Guarda el borrador con sus medios, su cheque y su imputación en una transacción'
);
select is(
  (select librador_cuit from cheque where recibo_id = (select id from t_borrador)),
  '20123456789',
  'La CUIT del librador se guarda sólo con dígitos'
);

select lives_ok(
  $$select guardar_borrador_recibo(
      (select id from t_borrador),
      '{"cliente_id": "cb000000-0000-0000-0000-000000000004", "fecha": "2026-10-19"}',
      '[{"tipo": "efectivo", "importe": 20}]',
      '[]')$$,
  'Un borrador se reemplaza entero'
);
select results_eq(
  $$select r.fecha, r.total, (select count(*) from recibo_medio m where m.recibo_id = r.id),
           (select count(*) from cheque ch where ch.recibo_id = r.id),
           (select count(*) from imputacion i where i.recibo_id = r.id)
    from recibo r where r.id = (select id from t_borrador)$$,
  $$values ('2026-10-19'::date, 20.00::numeric, 1::bigint, 0::bigint, 0::bigint)$$,
  'Al reemplazarlo se van los medios, los cheques y las imputaciones anteriores'
);

select throws_ok(
  $$select guardar_borrador_recibo(
      (select id from t_borrador),
      '{"cliente_id": "cb000000-0000-0000-0000-000000000004", "fecha": "2026-10-19"}',
      '[{"tipo": "efectivo", "importe": 20}]',
      '[{"comprobante_id": "cb100000-0000-0000-0000-000000000041", "importe": 25}]')$$,
  'CB005', null, 'Guardar no imputa más que el total del recibo'
);
select throws_ok(
  $$select guardar_borrador_recibo(null, '{"cliente_id": "cb000000-0000-0000-0000-000000000004", "fecha": "2026-10-19"}',
      '{}', '[]')$$,
  'CB012', null, 'Los medios tienen que ser una lista'
);

-- Un borrador con cheque se borra con su cheque y su historial.
select guardar_borrador_recibo(
  (select id from t_borrador),
  '{"cliente_id": "cb000000-0000-0000-0000-000000000004", "fecha": "2026-10-19"}',
  '[{"tipo": "echeq", "importe": 20, "cheque": {"banco": "Macro", "numero": "E-9", "fecha_pago": "2026-11-01"}}]',
  '[]'
);
create temporary table t_cheque_borrador on commit drop as
  select id from cheque where recibo_id = (select id from t_borrador);
select lives_ok(
  $$delete from recibo where id = (select id from t_borrador)$$,
  'Un borrador con cheques se borra'
);
select is(
  (select count(*) from cheque where id in (select id from t_cheque_borrador))
    + (select count(*) from cheque_estado where cheque_id in (select id from t_cheque_borrador)),
  0::bigint,
  'Sus cheques y su historial se van con el borrador'
);

select throws_ok(
  $$select guardar_borrador_recibo('cb200000-0000-0000-0000-000000000003',
      '{"cliente_id": "cb000000-0000-0000-0000-000000000003", "fecha": "2026-10-19"}',
      '[{"tipo": "efectivo", "importe": 20}]', '[]')$$,
  'CB001', null, 'Un recibo emitido no se guarda como borrador'
);

-- ---------------------------------------------------------------------
-- Saldo a favor automático al autorizar (C5) e imputación de notas de
-- crédito a sus asociados (C6)
-- ---------------------------------------------------------------------

reset role;
insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000005', 'Cliente con saldo a favor', 'Responsable Inscripto'),
  ('cb000000-0000-0000-0000-000000000006', 'Cliente con notas de crédito', 'Responsable Inscripto');

-- C5: un recibo de 100 sin imputar (todo a favor).
insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000051', 9, 'cb000000-0000-0000-0000-000000000005', '2026-10-05', 100);
insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000051', 'efectivo', 100);
select emitir_recibo('cb200000-0000-0000-0000-000000000051');

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha)
values
  ('cb100000-0000-0000-0000-000000000051', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000005', 'contado', 30, '2026-10-06'),
  ('cb100000-0000-0000-0000-000000000052', 9107, 'homologacion', 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000005', 'cuenta_corriente', 40, '2026-10-06'),
  ('cb100000-0000-0000-0000-000000000053', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000005', 'cuenta_corriente', 70, '2026-10-07'),
  ('cb100000-0000-0000-0000-000000000054', 9107, 'produccion', 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000005', 'cuenta_corriente', 50, '2026-10-08');

set local role authenticated;

update comprobante set estado = 'autorizado', numero = 51 where id = 'cb100000-0000-0000-0000-000000000051';
select is(
  (select count(*) from imputacion where comprobante_id = 'cb100000-0000-0000-0000-000000000051'),
  0::bigint,
  'Una factura de contado no consume saldo a favor al autorizarse'
);

update comprobante set estado = 'verificando', intento_numero = 52 where id = 'cb100000-0000-0000-0000-000000000052';
update comprobante set estado = 'autorizado', numero = 52, cae = '12345678901234', cae_vencimiento = '2026-12-31'
where id = 'cb100000-0000-0000-0000-000000000052';
select is(
  (select count(*) from imputacion where comprobante_id = 'cb100000-0000-0000-0000-000000000052'),
  0::bigint,
  'Un comprobante de homologación no toca el saldo a favor'
);

update comprobante set estado = 'autorizado', numero = 53 where id = 'cb100000-0000-0000-0000-000000000053';
select results_eq(
  $$select recibo_id::text, importe, automatica from imputacion
    where comprobante_id = 'cb100000-0000-0000-0000-000000000053'$$,
  $$values ('cb200000-0000-0000-0000-000000000051', 70.00::numeric, true)$$,
  'Al autorizar una factura de cuenta corriente se le aplica el saldo a favor'
);
select is(
  (select estado_pago from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000053'),
  'cancelado',
  'La factura cubierta por el saldo a favor queda cancelada'
);

update comprobante set estado = 'verificando', intento_numero = 54 where id = 'cb100000-0000-0000-0000-000000000054';
update comprobante set estado = 'autorizado', numero = 54, cae = '12345678901234', cae_vencimiento = '2026-12-31'
where id = 'cb100000-0000-0000-0000-000000000054';
select results_eq(
  $$select saldo, estado_pago from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000054'$$,
  $$values (20.00::numeric, 'parcial')$$,
  'Una electrónica de producción consume lo que queda a favor (30 de 50)'
);
select is(
  (select saldo_a_favor from v_cliente_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000005'),
  0.00::numeric,
  'El saldo a favor se agotó'
);

select anular_recibo('cb200000-0000-0000-0000-000000000051', 'Cargado al cliente equivocado');
select results_eq(
  $$select comprobante_id::text, saldo, estado_pago from v_comprobante_saldo
    where cliente_id = 'cb000000-0000-0000-0000-000000000005' and condicion_pago = 'cuenta_corriente'
    order by fecha$$,
  $$values ('cb100000-0000-0000-0000-000000000053', 70.00::numeric, 'pendiente'),
           ('cb100000-0000-0000-0000-000000000054', 50.00::numeric, 'pendiente')$$,
  'Anular el recibo deshace también lo aplicado automáticamente'
);

-- C6: notas de crédito.
reset role;
insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha,
                         periodo_asoc_desde, periodo_asoc_hasta)
values
  ('cb100000-0000-0000-0000-000000000061', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 80, '2026-10-01', null, null),
  ('cb100000-0000-0000-0000-000000000062', 9199, null, 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 30, '2026-10-02', null, null),
  ('cb100000-0000-0000-0000-000000000063', 9199, null, 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 60, '2026-10-03', null, null),
  ('cb100000-0000-0000-0000-000000000064', 9199, null, 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 15, '2026-10-04', '2026-10-01', '2026-10-04'),
  ('cb100000-0000-0000-0000-000000000065', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000006', 'contado', 20, '2026-10-05', null, null),
  ('cb100000-0000-0000-0000-000000000066', 9199, null, 'nota_credito', 'A', 3,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 5, '2026-10-06', null, null),
  ('cb100000-0000-0000-0000-000000000067', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000006', 'cuenta_corriente', 100, '2026-10-07', null, null);
update comprobante set estado = 'autorizado', numero = 61 where id = 'cb100000-0000-0000-0000-000000000061';
update comprobante set estado = 'autorizado', numero = 65 where id = 'cb100000-0000-0000-0000-000000000065';
insert into comprobante_asociado (comprobante_id, asociado_id) values
  ('cb100000-0000-0000-0000-000000000062', 'cb100000-0000-0000-0000-000000000061'),
  ('cb100000-0000-0000-0000-000000000063', 'cb100000-0000-0000-0000-000000000061'),
  ('cb100000-0000-0000-0000-000000000066', 'cb100000-0000-0000-0000-000000000065');
set local role authenticated;

update comprobante set estado = 'autorizado', numero = 62 where id = 'cb100000-0000-0000-0000-000000000062';
select results_eq(
  $$select nota_credito_id::text, importe, automatica from imputacion
    where comprobante_id = 'cb100000-0000-0000-0000-000000000061'$$,
  $$values ('cb100000-0000-0000-0000-000000000062', 30.00::numeric, true)$$,
  'Una nota de crédito se imputa sola a su comprobante asociado'
);

update comprobante set estado = 'autorizado', numero = 63 where id = 'cb100000-0000-0000-0000-000000000063';
select results_eq(
  $$select nota_credito_id::text, imputado, disponible from v_cliente_saldo_a_favor
    where cliente_id = 'cb000000-0000-0000-0000-000000000006'$$,
  $$values ('cb100000-0000-0000-0000-000000000063', 50.00::numeric, 10.00::numeric)$$,
  'Imputa hasta el saldo pendiente del asociado y el resto queda a favor'
);
select is(
  (select estado_pago from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000061'),
  'cancelado',
  'El asociado queda cancelado'
);

update comprobante set estado = 'autorizado', numero = 64 where id = 'cb100000-0000-0000-0000-000000000064';
select is(
  (select disponible from v_cliente_saldo_a_favor where nota_credito_id = 'cb100000-0000-0000-0000-000000000064'),
  15.00::numeric,
  'Una nota de crédito asociada a un período queda entera a favor'
);

update comprobante set estado = 'autorizado', numero = 66 where id = 'cb100000-0000-0000-0000-000000000066';
select results_eq(
  $$select (select count(*) from imputacion where nota_credito_id = 'cb100000-0000-0000-0000-000000000066'),
           (select saldo from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000065')$$,
  $$values (0::bigint, 20.00::numeric)$$,
  'Una nota de crédito sobre una factura de contado no la imputa: queda a favor'
);

update comprobante set estado = 'autorizado', numero = 67 where id = 'cb100000-0000-0000-0000-000000000067';
select results_eq(
  $$select (select count(*) from imputacion where comprobante_id = 'cb100000-0000-0000-0000-000000000067' and automatica),
           (select saldo from v_comprobante_saldo where comprobante_id = 'cb100000-0000-0000-0000-000000000067'),
           (select saldo_a_favor from v_cliente_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000006')$$,
  $$values (3::bigint, 70.00::numeric, 0.00::numeric)$$,
  'La próxima factura de cuenta corriente consume lo que las notas dejaron a favor (10 + 15 + 5)'
);
select is(
  (select count(*) from v_cliente_saldo
   where cliente_id::text like 'cb000000-%' and saldo <> deuda_pendiente - saldo_a_favor),
  0::bigint,
  'Después de las aplicaciones automáticas, saldo = pendientes − a favor'
);

reset role;

-- C9: si la aplicación del saldo a favor falla a mitad de camino, la
-- autorización igual se guarda y no queda ninguna imputación parcial (el
-- bloque con exception de fn_comprobante_aplicar_creditos deshace su
-- subtransacción entera). La falla se fuerza con un trigger de prueba que
-- rechaza la segunda imputación automática a la factura (se deshace con el
-- resto del test).
insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000009', 'Cliente con falla al aplicar', 'Responsable Inscripto');
insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000075', 9, 'cb000000-0000-0000-0000-000000000009', '2026-10-01', 40),
  ('cb200000-0000-0000-0000-000000000076', 9, 'cb000000-0000-0000-0000-000000000009', '2026-10-02', 40);
insert into recibo_medio (recibo_id, tipo, importe) values
  ('cb200000-0000-0000-0000-000000000075', 'efectivo', 40),
  ('cb200000-0000-0000-0000-000000000076', 'efectivo', 40);
select emitir_recibo('cb200000-0000-0000-0000-000000000075');
select emitir_recibo('cb200000-0000-0000-0000-000000000076');
insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha)
values ('cb100000-0000-0000-0000-000000000075', 9199, null, 'factura', 'A', 1,
        'cb000000-0000-0000-0000-000000000009', 'cuenta_corriente', 70, '2026-10-03');

create function public.test_fallar_segunda_imputacion() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.imputacion i where i.comprobante_id = new.comprobante_id) then
    raise exception 'Falla forzada por el test';
  end if;
  return new;
end;
$$;
create trigger test_fallar_segunda_imputacion before insert on imputacion
  for each row when (new.comprobante_id = 'cb100000-0000-0000-0000-000000000075')
  execute function public.test_fallar_segunda_imputacion();

update comprobante set estado = 'autorizado', numero = 75 where id = 'cb100000-0000-0000-0000-000000000075';
select is(
  (select estado from comprobante where id = 'cb100000-0000-0000-0000-000000000075'),
  'autorizado',
  'Si falla la aplicación del saldo a favor, la autorización igual queda guardada'
);
select is(
  (select count(*) from imputacion where comprobante_id = 'cb100000-0000-0000-0000-000000000075'),
  0::bigint,
  'Una falla a mitad de la aplicación no deja imputaciones parciales'
);
select results_eq(
  $$select saldo, saldo_a_favor from v_cliente_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000009'$$,
  $$values (-10.00::numeric, 80.00::numeric)$$,
  'El saldo a favor queda entero y disponible después de la falla'
);

drop trigger test_fallar_segunda_imputacion on imputacion;
drop function public.test_fallar_segunda_imputacion();

-- ---------------------------------------------------------------------
-- Contador de recibos protegido: authenticated no lo escribe; sólo
-- emitir_recibo (security definer) lo avanza.
-- ---------------------------------------------------------------------

set local role authenticated;

select throws_ok(
  $$update recibo_punto_venta set ultimo_numero = 0 where numero = 9$$,
  '42501', null, 'authenticated no cambia el contador de recibos directamente'
);
select throws_ok(
  $$insert into recibo_punto_venta (numero, nombre) values (8, 'Otro')$$,
  '42501', null, 'authenticated no crea puntos de venta de recibos'
);
select throws_ok(
  $$delete from recibo_punto_venta where numero = 9$$,
  '42501', null, 'authenticated no borra puntos de venta de recibos'
);
select ok(
  has_table_privilege('authenticated', 'public.recibo_punto_venta', 'select'),
  'authenticated sigue leyendo los puntos de venta de recibos'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.emitir_recibo(uuid)'::regprocedure)
    and (select proconfig from pg_proc where oid = 'public.emitir_recibo(uuid)'::regprocedure) = array['search_path=""'],
  'emitir_recibo es security definer con search_path fijo'
);

create temporary table t_contador on commit drop as
  select ultimo_numero from recibo_punto_venta where numero = 9;
insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000091', 9, 'cb000000-0000-0000-0000-000000000004', '2026-10-18', 5);
insert into recibo_medio (recibo_id, tipo, importe) values ('cb200000-0000-0000-0000-000000000091', 'efectivo', 5);
select is(
  emitir_recibo('cb200000-0000-0000-0000-000000000091'),
  (select ultimo_numero + 1 from t_contador),
  'Como authenticated, emitir_recibo sigue tomando el número siguiente'
);
select results_eq(
  $$select r.estado, r.numero, (select ultimo_numero from recibo_punto_venta where numero = 9), r.creado_por::text
    from recibo r where r.id = 'cb200000-0000-0000-0000-000000000091'$$,
  $$select 'emitido'::text, ultimo_numero + 1, ultimo_numero + 1, '11111111-1111-1111-1111-111111111111'::text
    from t_contador$$,
  'El recibo queda emitido con ese número y el contador avanzado'
);

-- ---------------------------------------------------------------------
-- Cartera de cheques y rechazo con nota de débito obligatoria
--   C7 (…0007, RI): factura F71 A 100 cancelada por R71 con el cheque
--                   CH71 (100). Su rechazo → ND A asociada a F71.
--   C8 (…0008, CF): R81 a cuenta (fecha 2026-10-10) con CH81 (50) y
--                   CH82 (30). El rechazo de CH81 con gastos → ND B al
--                   período 2026-10-01..2026-10-10, con un ítem al 21%.
--   R83: borrador con CH83; R84: anulado con CH84. No son cartera.
-- ---------------------------------------------------------------------

reset role;
-- La ND del rechazo de CH71 se crea en producción (se autoriza abajo).
update arca_emisor set ambiente = 'produccion' where id;
insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000007', 'Cliente con cheque rechazado', 'Responsable Inscripto'),
  ('cb000000-0000-0000-0000-000000000008', 'Consumidor con cheque a cuenta', 'Consumidor Final');
insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, condicion_pago, total, fecha)
values
  ('cb100000-0000-0000-0000-000000000071', 9199, null, 'factura', 'A', 1,
   'cb000000-0000-0000-0000-000000000007', 'cuenta_corriente', 100, '2026-10-01');
update comprobante set estado = 'autorizado', numero = 71 where id = 'cb100000-0000-0000-0000-000000000071';

set local role authenticated;

select has_function('public', 'rechazar_cheque', array['uuid', 'date', 'text', 'jsonb'], 'Existe rechazar_cheque');
select ok(not has_function_privilege('anon', 'public.rechazar_cheque(uuid, date, text, jsonb)', 'execute'),
  'anon no ejecuta rechazar_cheque');
select ok(has_function_privilege('authenticated', 'public.rechazar_cheque(uuid, date, text, jsonb)', 'execute'),
  'authenticated ejecuta rechazar_cheque');
select has_view('public', 'v_cheque_cartera', 'Existe v_cheque_cartera');
select ok(not has_table_privilege('anon', 'public.v_cheque_cartera', 'select'), 'anon no lee la cartera');

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cb200000-0000-0000-0000-000000000071', 9, 'cb000000-0000-0000-0000-000000000007', '2026-10-05', 100),
  ('cb200000-0000-0000-0000-000000000081', 9, 'cb000000-0000-0000-0000-000000000008', '2026-10-10', 80),
  ('cb200000-0000-0000-0000-000000000083', 9, 'cb000000-0000-0000-0000-000000000008', '2026-10-11', 10),
  ('cb200000-0000-0000-0000-000000000084', 9, 'cb000000-0000-0000-0000-000000000008', '2026-10-12', 15);
insert into cheque (id, recibo_id, cliente_id, tipo, banco, numero, fecha_pago, importe) values
  ('cb300000-0000-0000-0000-000000000071', 'cb200000-0000-0000-0000-000000000071',
   'cb000000-0000-0000-0000-000000000007', 'fisico', 'Banco Nación', '71', '2026-11-01', 100),
  ('cb300000-0000-0000-0000-000000000081', 'cb200000-0000-0000-0000-000000000081',
   'cb000000-0000-0000-0000-000000000008', 'echeq', 'Banco Galicia', 'E-81', '2026-11-02', 50),
  ('cb300000-0000-0000-0000-000000000082', 'cb200000-0000-0000-0000-000000000081',
   'cb000000-0000-0000-0000-000000000008', 'fisico', 'Banco Macro', '82', '2026-11-03', 30),
  ('cb300000-0000-0000-0000-000000000083', 'cb200000-0000-0000-0000-000000000083',
   'cb000000-0000-0000-0000-000000000008', 'fisico', 'Banco Macro', '83', '2026-11-04', 10),
  ('cb300000-0000-0000-0000-000000000084', 'cb200000-0000-0000-0000-000000000084',
   'cb000000-0000-0000-0000-000000000008', 'fisico', 'Banco Macro', '84', '2026-11-05', 15);
insert into recibo_medio (recibo_id, tipo, importe, cheque_id) values
  ('cb200000-0000-0000-0000-000000000071', 'cheque', 100, 'cb300000-0000-0000-0000-000000000071'),
  ('cb200000-0000-0000-0000-000000000081', 'echeq', 50, 'cb300000-0000-0000-0000-000000000081'),
  ('cb200000-0000-0000-0000-000000000081', 'cheque', 30, 'cb300000-0000-0000-0000-000000000082'),
  ('cb200000-0000-0000-0000-000000000083', 'cheque', 10, 'cb300000-0000-0000-0000-000000000083'),
  ('cb200000-0000-0000-0000-000000000084', 'cheque', 15, 'cb300000-0000-0000-0000-000000000084');
insert into imputacion (recibo_id, comprobante_id, importe) values
  ('cb200000-0000-0000-0000-000000000071', 'cb100000-0000-0000-0000-000000000071', 100);
select emitir_recibo('cb200000-0000-0000-0000-000000000071');
select emitir_recibo('cb200000-0000-0000-0000-000000000081');
select emitir_recibo('cb200000-0000-0000-0000-000000000084');
select anular_recibo('cb200000-0000-0000-0000-000000000084', 'Cargado dos veces');

select results_eq(
  $$select id::text, recibo_numero_texto is not null, razon_social from v_cheque_cartera
    where cliente_id in ('cb000000-0000-0000-0000-000000000007', 'cb000000-0000-0000-0000-000000000008')
    order by id$$,
  $$values ('cb300000-0000-0000-0000-000000000071', true, 'Cliente con cheque rechazado'),
           ('cb300000-0000-0000-0000-000000000081', true, 'Consumidor con cheque a cuenta'),
           ('cb300000-0000-0000-0000-000000000082', true, 'Consumidor con cheque a cuenta')$$,
  'La cartera sólo tiene cheques de recibos emitidos (sin borradores ni anulados)'
);

-- Transiciones
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000083', null, null, null)$$,
  'CB009', null, 'El cheque de un recibo en borrador no se rechaza'
);
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000084', null, null, null)$$,
  'CB009', null, 'Un cheque anulado no se rechaza'
);
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000099', null, null, null)$$,
  'CB021', null, 'Un cheque inexistente se informa'
);
select throws_ok(
  $$update cheque set estado = 'rechazado' where id = 'cb300000-0000-0000-0000-000000000082'$$,
  '23514', null, 'Un cheque no queda rechazado sin su nota de débito'
);
select lives_ok(
  $$update cheque set estado = 'depositado', estado_fecha = '2026-11-01', estado_observacion = 'Banco propio'
    where id = 'cb300000-0000-0000-0000-000000000071'$$,
  'Un cheque en cartera se deposita'
);
select throws_ok(
  $$update cheque set estado = 'entregado', entregado_a = 'Proveedor' where id = 'cb300000-0000-0000-0000-000000000071'$$,
  'CB009', null, 'Un cheque depositado no se entrega'
);

-- Rechazo de un cheque que canceló facturas: ND asociada a ellas.
create temporary table t_nd71 on commit drop as
  select rechazar_cheque('cb300000-0000-0000-0000-000000000071', '2026-11-03', ' Sin fondos ', null) as id;

select results_eq(
  $$select estado, nd_comprobante_id = (select id from t_nd71), estado_fecha, estado_observacion
    from cheque where id = 'cb300000-0000-0000-0000-000000000071'$$,
  $$values ('rechazado'::text, true, '2026-11-03'::date, 'Sin fondos'::text)$$,
  'El cheque queda rechazado con su nota de débito, fecha y observación'
);
select results_eq(
  $$select estado, fecha, observacion from cheque_estado
    where cheque_id = 'cb300000-0000-0000-0000-000000000071' order by id$$,
  $$values ('en_cartera'::text, (now() at time zone 'America/Argentina/Buenos_Aires')::date, null::text),
           ('depositado', '2026-11-01'::date, 'Banco propio'),
           ('rechazado', '2026-11-03'::date, 'Sin fondos')$$,
  'El historial registra el depósito y el rechazo'
);
select results_eq(
  $$select c.clase, c.estado, c.letra, c.tipo_arca, c.condicion_pago, c.cliente_id::text, c.ambiente,
           c.punto_venta = (select min(numero) from punto_venta where activo and electronico),
           c.neto, c.no_gravado, c.iva, c.total, c.periodo_asoc_desde
    from comprobante c where c.id = (select id from t_nd71)$$,
  $$values ('nota_debito'::text, 'borrador'::text, 'A'::text, 2, 'cuenta_corriente'::text,
            'cb000000-0000-0000-0000-000000000007'::text, 'produccion'::text, true,
            0.00::numeric, 100.00::numeric, 0.00::numeric, 100.00::numeric, null::date)$$,
  'La ND es un borrador de cuenta corriente, letra de la factura, en el electrónico activo más bajo'
);
select results_eq(
  $$select descripcion, gravado, alicuota_iva, cantidad, precio_unitario, importe, iva
    from comprobante_item where comprobante_id = (select id from t_nd71) order by orden$$,
  $$values ('Cheque rechazado N° 71 – Banco Nación'::text, false, null::numeric, 1.0000::numeric, 100.0000::numeric,
            100.00::numeric, 0.00::numeric)$$,
  'Lleva el capital del cheque como único ítem, no gravado'
);
select results_eq(
  $$select asociado_id::text from comprobante_asociado where comprobante_id = (select id from t_nd71)$$,
  $$values ('cb100000-0000-0000-0000-000000000071')$$,
  'Se asocia a la factura que canceló el recibo del cheque'
);
select results_eq(
  $$select estado, nd_estado, nd_numero_texto from v_cheque_cartera where id = 'cb300000-0000-0000-0000-000000000071'$$,
  $$values ('rechazado'::text, 'borrador'::text, null::text)$$,
  'En la cartera figura rechazado con la ND pendiente'
);
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000071', null, null, null)$$,
  'CB009', null, 'Un cheque rechazado no se vuelve a rechazar'
);

-- La ND es obligatoria: su borrador no se borra ni cambia de cliente.
select throws_ok(
  $$delete from comprobante where id = (select id from t_nd71)$$,
  'CB020', null, 'La ND de un cheque rechazado no se puede borrar'
);
select throws_ok(
  $$update comprobante set cliente_id = 'cb000000-0000-0000-0000-000000000008' where id = (select id from t_nd71)$$,
  'CB020', null, 'La ND de un cheque rechazado no cambia de cliente'
);
select lives_ok(
  $$update comprobante set observaciones = 'Revisada' where id = (select id from t_nd71)$$,
  'La ND se sigue editando como cualquier borrador'
);

-- Al autorizarla, vuelve a cargar la deuda.
update comprobante set estado = 'verificando', intento_numero = 71 where id = (select id from t_nd71);
update comprobante set estado = 'autorizado', numero = 71, cae = '12345678901234', cae_vencimiento = '2026-12-31'
where id = (select id from t_nd71);
select results_eq(
  $$select saldo, estado_pago from v_comprobante_saldo where comprobante_id = (select id from t_nd71)$$,
  $$values (100.00::numeric, 'pendiente'::text)$$,
  'Autorizada, la ND es un débito más de la cuenta corriente'
);
select is(
  (select nd_numero_texto from v_cheque_cartera where id = 'cb300000-0000-0000-0000-000000000071'),
  'A-' || lpad((select punto_venta::text from comprobante where id = (select id from t_nd71)), 5, '0') || '-00000071',
  'En la cartera figura el número de la ND autorizada'
);

-- Rechazo de un cheque a cuenta, con gastos bancarios.
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000081', null, null, '{"importe": 10}')$$,
  'CB022', null, 'Los gastos bancarios llevan descripción'
);
select throws_ok(
  $$select rechazar_cheque('cb300000-0000-0000-0000-000000000081', null, null, '{"importe": -1, "descripcion": "x"}')$$,
  'CB022', null, 'Los gastos bancarios no son negativos'
);

create temporary table t_nd81 on commit drop as
  select rechazar_cheque('cb300000-0000-0000-0000-000000000081', null, null,
    '{"importe": 1000, "descripcion": " Gastos bancarios "}') as id;

select results_eq(
  $$select c.letra, c.tipo_arca, c.periodo_asoc_desde, c.periodo_asoc_hasta,
           (select count(*) from comprobante_asociado a where a.comprobante_id = c.id),
           c.neto, c.no_gravado, c.iva, c.total
    from comprobante c where c.id = (select id from t_nd81)$$,
  $$values ('B'::text, 7, '2026-10-01'::date, '2026-10-10'::date, 0::bigint,
            1000.00::numeric, 50.00::numeric, 210.00::numeric, 1260.00::numeric)$$,
  'Un cheque a cuenta: ND con la letra del cliente, asociada al período del mes del recibo'
);
select results_eq(
  $$select descripcion, gravado, alicuota_iva, importe, iva
    from comprobante_item where comprobante_id = (select id from t_nd81) order by orden$$,
  $$values ('Cheque rechazado N° E-81 – Banco Galicia'::text, false, null::numeric, 50.00::numeric, 0.00::numeric),
           ('Gastos bancarios', true, 21.00::numeric, 1000.00::numeric, 210.00::numeric)$$,
  'Los gastos bancarios van en un segundo ítem gravado al 21%'
);
select is(
  (select estado_fecha from cheque where id = 'cb300000-0000-0000-0000-000000000081'),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'Sin fecha, el rechazo es de hoy'
);

reset role;

-- ---------------------------------------------------------------------
-- Resumen de cuenta corriente por cliente (listado general)
-- ---------------------------------------------------------------------

select has_view('public', 'v_cliente_cuenta_resumen', 'Existe v_cliente_cuenta_resumen');
select ok(not has_table_privilege('anon', 'public.v_cliente_cuenta_resumen', 'select'), 'anon no lee el resumen de cuentas');
select ok(has_table_privilege('authenticated', 'public.v_cliente_cuenta_resumen', 'select'),
  'authenticated lee el resumen de cuentas');

insert into cliente (id, razon_social, condicion_iva) values
  ('cb000000-0000-0000-0000-000000000010', 'Cliente sin movimientos', 'Responsable Inscripto');

set local role authenticated;

select results_eq(
  $$select razon_social, saldo, deuda_pendiente, saldo_a_favor, pendientes, pendiente_mas_viejo
    from v_cliente_cuenta_resumen where cliente_id = 'cb000000-0000-0000-0000-000000000009'$$,
  $$values ('Cliente con falla al aplicar'::text, -10.00::numeric, 70.00::numeric, 80.00::numeric, 1::bigint,
            '2026-10-03'::date)$$,
  'El resumen trae saldo, deuda, a favor, cantidad de pendientes y la deuda más vieja'
);
select results_eq(
  $$select saldo, pendientes, pendiente_mas_viejo from v_cliente_cuenta_resumen
    where cliente_id = 'cb000000-0000-0000-0000-000000000001'$$,
  $$select saldo, (select count(*) from v_comprobante_saldo
                   where cliente_id = 'cb000000-0000-0000-0000-000000000001' and saldo > 0),
           pendiente_mas_viejo
    from v_cliente_saldo where cliente_id = 'cb000000-0000-0000-0000-000000000001'$$,
  'El resumen coincide con v_cliente_saldo y con los débitos pendientes'
);
select is(
  (select count(*) from v_cliente_cuenta_resumen where cliente_id = 'cb000000-0000-0000-0000-000000000010'),
  0::bigint,
  'Un cliente sin saldo, sin pendientes y sin nada a favor no aparece'
);
select is(
  (select count(*) from v_cliente_cuenta_resumen
   where cliente_id::text like 'cb000000-%' and saldo <> deuda_pendiente - saldo_a_favor),
  0::bigint,
  'En el resumen, saldo = pendientes − a favor para cada cliente'
);
select is(
  (select count(*) from v_cliente_cuenta_resumen r
   where r.cliente_id::text like 'cb000000-%'
     and r.pendientes <> (select count(*) from v_comprobante_saldo s where s.cliente_id = r.cliente_id and s.saldo > 0)),
  0::bigint,
  'La cantidad de pendientes coincide con los débitos con saldo de cada cliente'
);

reset role;

select * from finish();
rollback;
