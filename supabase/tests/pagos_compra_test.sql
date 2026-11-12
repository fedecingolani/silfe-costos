-- =====================================================================
-- Tests de las órdenes de pago a proveedores: estructura, permisos,
-- guardado del borrador con sus medios (efectivo, transferencia, cheques
-- de terceros de la cartera y cheques propios) e imputaciones,
-- confirmación con número propio, entrega de los cheques al proveedor,
-- inmutabilidad, anulación (los cheques vuelven a la cartera) y los
-- controles de las imputaciones.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(89);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['orden_pago_numeracion', 'orden_pago', 'orden_pago_medio', 'imputacion_compra']) as t;

select has_view('public', v, format('Existe %s', v))
from unnest(array['v_comprobante_compra_saldo', 'v_proveedor_saldo_a_favor']) as v;

select has_function('public', 'guardar_orden_pago', array['uuid', 'jsonb', 'jsonb', 'jsonb'], 'Existe guardar_orden_pago');
select has_function('public', 'confirmar_orden_pago', array['uuid'], 'Existe confirmar_orden_pago');
select has_function('public', 'anular_orden_pago', array['uuid', 'text'], 'Existe anular_orden_pago');
select has_column('public', 'cheque', c, format('El cheque tiene %s', c))
from unnest(array['orden_pago_id', 'proveedor_id']) as c;
select col_default_is('public', 'orden_pago', 'estado', 'borrador', 'Una orden de pago nace en borrador');

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
  format('%s tiene RLS habilitada', t)
)
from unnest(array['orden_pago_numeracion', 'orden_pago', 'orden_pago_medio', 'imputacion_compra']) as t;

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array[
  'orden_pago_numeracion', 'orden_pago', 'orden_pago_medio', 'imputacion_compra',
  'v_comprobante_compra_saldo', 'v_proveedor_saldo_a_favor'
]) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.guardar_orden_pago(uuid, jsonb, jsonb, jsonb)',
  'public.confirmar_orden_pago(uuid)',
  'public.anular_orden_pago(uuid, text)'
]) as f;

select ok(
  not has_table_privilege('authenticated', 'public.orden_pago_numeracion', 'insert, update, delete'),
  'authenticated sólo lee el contador de las órdenes de pago'
);

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000007c1', 'Proveedor pagos 1'),
  ('00000000-0000-4000-8000-0000000007c2', 'Proveedor pagos 2');

insert into cliente (id, razon_social, condicion_iva) values
  ('00000000-0000-4000-8000-0000000007e1', 'Cliente de los cheques de pagos', 'Responsable Inscripto');

insert into punto_venta (numero, nombre, electronico) values (9707, 'Electrónico pagos', true);

-- Caja y banco de los que salen el efectivo, la transferencia y el cheque
-- propio (nombres únicos: la base local puede tener cuentas cargadas a mano).
insert into cuenta_fondos (id, tipo, nombre, banco) values
  ('00000000-0000-4000-8000-0000000007f1', 'banco', 'Banco pagos ' || gen_random_uuid(), 'Galicia');
insert into cuenta_fondos (id, tipo, nombre) values
  ('00000000-0000-4000-8000-0000000007f2', 'caja', 'Caja pagos ' || gen_random_uuid());

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table op (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from op where nombre = p_nombre; $$;

-- Comprobante de compra letra C (sin IVA) con un renglón libre por el
-- importe: el total es el importe. Se confirma salvo que se pida lo contrario.
create function pg_temp.comprobante(
  p_nombre text, p_tipo text, p_numero bigint, p_importe numeric,
  p_proveedor uuid default '00000000-0000-4000-8000-0000000007c1', p_confirmar boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_comprobante_compra(null,
    jsonb_build_object('proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', 'C',
      'punto_venta', 7, 'numero', p_numero, 'fecha', '2026-11-01'),
    jsonb_build_array(jsonb_build_object('descripcion', 'Servicio', 'cantidad', 1, 'precio_unitario', p_importe)),
    '[]'::jsonb);
  if p_confirmar then
    perform confirmar_comprobante_compra(v_id);
  end if;
  insert into op values (p_nombre, v_id);
  return v_id;
end;
$$;

-- Cabecera de una orden de pago.
create function pg_temp.orden(p_proveedor uuid default '00000000-0000-4000-8000-0000000007c1')
returns jsonb
language sql
as $$
  select jsonb_build_object('proveedor_id', p_proveedor, 'fecha', '2026-11-06', 'observaciones', 'Pago de noviembre');
$$;

create function pg_temp.efectivo(p_importe numeric)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', p_importe,
    'cuenta_id', '00000000-0000-4000-8000-0000000007f2'));
$$;

create function pg_temp.cheque_tercero(p_nombre text)
returns jsonb
language sql
as $$ select jsonb_build_array(jsonb_build_object('tipo', 'cheque_tercero', 'cheque_id', pg_temp.id(p_nombre), 'importe', 1)); $$;

create function pg_temp.imputar(p_nombre text, p_importe numeric)
returns jsonb
language sql
as $$ select jsonb_build_array(jsonb_build_object('comprobante_compra_id', pg_temp.id(p_nombre), 'importe', p_importe)); $$;

-- Cheques de terceros: un recibo emitido con CH1 (1000), CH2 (500) y CH3
-- (300), y un recibo en borrador con CH_B (200).
do $$
declare
  v_recibo uuid;
  v_borrador uuid;
  v_cheques jsonb := '[]'::jsonb;
  v_n text;
  v_importe numeric;
begin
  foreach v_n in array array['CH1', 'CH2', 'CH3'] loop
    v_importe := case v_n when 'CH1' then 1000 when 'CH2' then 500 else 300 end;
    v_cheques := v_cheques || jsonb_build_array(jsonb_build_object(
      'tipo', 'cheque', 'importe', v_importe,
      'cheque', jsonb_build_object('banco', 'Nación', 'numero', 'N-' || v_n, 'fecha_pago', '2026-12-01')));
  end loop;
  v_recibo := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', '00000000-0000-4000-8000-0000000007e1', 'fecha', current_date),
    v_cheques, '[]'::jsonb);
  perform emitir_recibo(v_recibo);
  insert into op select 'N-' || n, ch.id from cheque ch, unnest(array['CH1', 'CH2', 'CH3']) n
    where ch.recibo_id = v_recibo and ch.numero = 'N-' || n;
  insert into op select substr(nombre, 3), id from op where nombre like 'N-CH%';

  v_borrador := guardar_borrador_recibo(null,
    jsonb_build_object('cliente_id', '00000000-0000-4000-8000-0000000007e1', 'fecha', current_date),
    jsonb_build_array(jsonb_build_object('tipo', 'cheque', 'importe', 200,
      'cheque', jsonb_build_object('banco', 'Nación', 'numero', 'N-CHB', 'fecha_pago', '2026-12-01'))),
    '[]'::jsonb);
  insert into op select 'CH_B', ch.id from cheque ch where ch.recibo_id = v_borrador;
end;
$$;

-- Comprobantes: F1 (1000), F2 (2000) y ND1 (300) del proveedor 1;
-- F_otro (500) del proveedor 2; F_borr (100) en borrador; NC1 (50).
do $$
begin
  perform pg_temp.comprobante('F1', 'factura', 1, 1000);
  perform pg_temp.comprobante('F2', 'factura', 2, 2000);
  perform pg_temp.comprobante('ND1', 'nota_debito', 3, 300);
  perform pg_temp.comprobante('F_otro', 'factura', 4, 500, '00000000-0000-4000-8000-0000000007c2');
  perform pg_temp.comprobante('F_borr', 'factura', 5, 100, '00000000-0000-4000-8000-0000000007c1', false);
  perform pg_temp.comprobante('NC1', 'nota_credito', 6, 50);
end;
$$;

-- ---------------------------------------------------------------------
-- Guardar el borrador
-- ---------------------------------------------------------------------

insert into op values ('OP1', guardar_orden_pago(
  null,
  pg_temp.orden(),
  jsonb_build_array(
    jsonb_build_object('tipo', 'efectivo', 'importe', 500, 'cuenta_id', '00000000-0000-4000-8000-0000000007f2'),
    jsonb_build_object('tipo', 'transferencia', 'importe', 1000, 'referencia', 'TRF-1',
      'cuenta_id', '00000000-0000-4000-8000-0000000007f1'),
    jsonb_build_object('tipo', 'cheque_tercero', 'cheque_id', pg_temp.id('CH1'), 'importe', 1),
    jsonb_build_object('tipo', 'cheque_propio', 'importe', 700,
      'banco', 'Galicia', 'numero', '123', 'fecha_pago', '2026-12-15', 'cuenta_id', '00000000-0000-4000-8000-0000000007f1')
  ),
  pg_temp.imputar('F1', 1000) || pg_temp.imputar('F2', 1500) || pg_temp.imputar('ND1', 0)
));

select is(
  (select estado || '|' || total || '|' || coalesce(numero::text, '-') || '|' || fecha || '|' || observaciones
   from orden_pago where id = pg_temp.id('OP1')),
  'borrador|3200.00|-|2026-11-06|Pago de noviembre',
  'guardar_orden_pago crea un borrador sin número, con el total de sus medios'
);
select is(
  (select array_agg(tipo || '|' || importe || '|' || coalesce(referencia, '') || '|' || coalesce(banco, '') || '|'
     || coalesce(numero, '') || '|' || coalesce(fecha_pago::text, '') order by orden)
   from orden_pago_medio where orden_pago_id = pg_temp.id('OP1')),
  array['efectivo|500.00||||', 'transferencia|1000.00|TRF-1|||', 'cheque_tercero|1000.00||||',
        'cheque_propio|700.00||Galicia|123|2026-12-15'],
  'Los medios guardan sus datos; el cheque de terceros va por su importe, no por el que manda la app'
);
select is(
  (select array_agg(importe order by importe) from imputacion_compra where orden_pago_id = pg_temp.id('OP1')),
  array[1000.00, 1500.00]::numeric[],
  'Las imputaciones en cero se ignoran'
);
select is(
  (select saldo from v_comprobante_compra_saldo where comprobante_compra_id = pg_temp.id('F2')),
  2000.00::numeric,
  'Las imputaciones de un borrador no cancelan nada todavía'
);
select is(
  (select estado from cheque where id = pg_temp.id('CH1')),
  'en_cartera',
  'El cheque sigue en cartera mientras la orden es borrador'
);

-- ---------------------------------------------------------------------
-- Confirmar
-- ---------------------------------------------------------------------

create temp table contador as select ultimo_numero from orden_pago_numeracion;

select is(
  confirmar_orden_pago(pg_temp.id('OP1')),
  (select ultimo_numero + 1 from contador),
  'confirmar_orden_pago asigna el número siguiente y lo devuelve'
);
select is(
  (select estado || '|' || numero_texto || '|' || (confirmado_en is not null) from orden_pago where id = pg_temp.id('OP1')),
  'confirmado|OP-' || lpad((select ultimo_numero + 1 from contador)::text, 8, '0') || '|true',
  'La orden queda confirmada, con su número OP-00000001'
);
select is(
  (select ultimo_numero from orden_pago_numeracion),
  (select ultimo_numero + 1 from contador),
  'El contador avanza'
);
select is(
  (select estado || '|' || entregado_a || '|' || proveedor_id || '|' || orden_pago_id from cheque where id = pg_temp.id('CH1')),
  'entregado|Proveedor pagos 1|00000000-0000-4000-8000-0000000007c1|' || pg_temp.id('OP1'),
  'El cheque de terceros pasa a entregado, con el proveedor y la orden de pago'
);
select is(
  (select estado || '|' || fecha || '|' || observacion from cheque_estado
   where cheque_id = pg_temp.id('CH1') order by id desc limit 1),
  'entregado|2026-11-06|Orden de pago ' || (select numero_texto from orden_pago where id = pg_temp.id('OP1')),
  'La entrega queda en el historial del cheque con la fecha y el número de la orden'
);
select is(
  (select array_agg(saldo || '|' || estado_pago order by numero)
   from v_comprobante_compra_saldo where comprobante_compra_id in (pg_temp.id('F1'), pg_temp.id('F2'), pg_temp.id('ND1'))),
  array['0.00|cancelado', '500.00|parcial', '300.00|pendiente'],
  'v_comprobante_compra_saldo: lo imputado por la orden confirmada baja el saldo'
);
select is(
  (select origen || '|' || total || '|' || imputado || '|' || disponible
   from v_proveedor_saldo_a_favor where orden_pago_id = pg_temp.id('OP1')),
  'orden_pago|3200.00|2500.00|700.00',
  'Lo no imputado de la orden queda como saldo a favor'
);
select ok(
  not exists (
    select 1 from v_comprobante_compra_saldo
    where comprobante_compra_id in (pg_temp.id('F_borr'), pg_temp.id('NC1'))
  ),
  'v_comprobante_compra_saldo muestra sólo facturas y notas de débito confirmadas'
);

-- ---------------------------------------------------------------------
-- Una orden confirmada no cambia
-- ---------------------------------------------------------------------

select throws_ok(
  format($$update orden_pago set observaciones = 'otra' where id = %L$$, pg_temp.id('OP1')),
  'OP001', null, 'Una orden confirmada no se modifica'
);
select throws_ok(
  format('delete from orden_pago_medio where orden_pago_id = %L', pg_temp.id('OP1')),
  'OP001', null, 'Sus medios no se borran'
);
select throws_ok(
  format($$insert into orden_pago_medio (orden_pago_id, tipo, importe) values (%L, 'efectivo', 1)$$, pg_temp.id('OP1')),
  'OP001', null, 'Ni se le agregan medios'
);
select throws_ok(
  format('delete from imputacion_compra where orden_pago_id = %L', pg_temp.id('OP1')),
  'OP001', null, 'Sus imputaciones no se borran'
);
select throws_ok(
  format('insert into imputacion_compra (orden_pago_id, comprobante_compra_id, importe) values (%L, %L, 1)',
    pg_temp.id('OP1'), pg_temp.id('ND1')),
  'OP001', null, 'Ni se le agregan imputaciones a mano'
);
select throws_ok(
  format('delete from orden_pago where id = %L', pg_temp.id('OP1')),
  'OP001', null, 'Una orden confirmada no se borra'
);
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP1')),
  'OP002', null, 'No se confirma dos veces'
);

-- ---------------------------------------------------------------------
-- El vínculo del cheque con la orden lo maneja la base
-- ---------------------------------------------------------------------

select throws_ok(
  format('update cheque set orden_pago_id = null, proveedor_id = null where id = %L', pg_temp.id('CH1')),
  'OP017', null, 'El cheque entregado con una orden confirmada no se desvincula a mano'
);
select throws_ok(
  format($$update cheque set estado = 'entregado', entregado_a = 'x', orden_pago_id = %L,
           proveedor_id = '00000000-0000-4000-8000-0000000007c1' where id = %L$$,
    pg_temp.id('OP1'), pg_temp.id('CH2')),
  'OP017', null, 'Un cheque no se vincula a una orden que no lo tiene como medio'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.cheque_tercero('CH1'), '[]'),
  'OP009', null, 'Un cheque ya entregado no va en otra orden'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.cheque_tercero('CH_B'), '[]'),
  'OP009', null, 'Un cheque de un recibo en borrador no está en la cartera'
);

-- Entrega manual desde la cartera (sin orden): sigue funcionando.
select lives_ok(
  format($$update cheque set estado = 'entregado', entregado_a = 'Un tercero' where id = %L$$, pg_temp.id('CH3')),
  'Un cheque de la cartera se sigue entregando a mano, sin orden de pago'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.cheque_tercero('CH3'), '[]'),
  'OP009', null, 'Un cheque entregado a mano no va en una orden'
);

-- ---------------------------------------------------------------------
-- Controles del borrador y de la confirmación
-- ---------------------------------------------------------------------

select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(),
    jsonb_build_array(jsonb_build_object('tipo', 'cheque_propio', 'importe', 10, 'numero', '1', 'fecha_pago', '2026-12-01')),
    '[]'),
  '23514', null, 'Un cheque propio lleva banco, número y fecha de pago'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(),
    jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 10, 'banco', 'Galicia')), '[]'),
  '23514', null, 'El efectivo no lleva banco'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(),
    jsonb_build_array(jsonb_build_object('tipo', 'retencion', 'importe', 10)), '[]'),
  '23514', null, 'Sin retenciones: sólo efectivo, transferencia y cheques'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), '{}', '[]'),
  'OP011', null, 'Los medios tienen que ser una lista'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.efectivo(500), pg_temp.imputar('F_otro', 100)),
  'OP008', null, 'No se imputa a un comprobante de otro proveedor'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.efectivo(500), pg_temp.imputar('F_borr', 100)),
  'OP007', null, 'No se imputa a un comprobante en borrador'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.efectivo(500), pg_temp.imputar('NC1', 10)),
  'OP007', null, 'No se imputa a una nota de crédito'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.efectivo(5000), pg_temp.imputar('F2', 600)),
  'OP006', null, 'No se imputa más que el saldo pendiente del comprobante'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)', pg_temp.orden(), pg_temp.efectivo(100), pg_temp.imputar('ND1', 300)),
  'OP005', null, 'Las imputaciones no superan el total de la orden'
);

insert into op values ('OP_sin', guardar_orden_pago(null, pg_temp.orden(), '[]', '[]'));
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP_sin')),
  'OP003', null, 'Una orden sin medios no se confirma'
);

insert into op values ('OP_total', guardar_orden_pago(null, pg_temp.orden(), pg_temp.efectivo(100), '[]'));
update orden_pago set total = 1 where id = pg_temp.id('OP_total');
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP_total')),
  'OP004', null, 'El total tiene que ser la suma de los medios'
);
select throws_ok(
  format($$update orden_pago set estado = 'confirmado', numero = 999999 where id = %L$$, pg_temp.id('OP_total')),
  'OP013', null, 'El número lo asigna confirmar_orden_pago'
);
select throws_ok(
  $$select confirmar_orden_pago('00000000-0000-4000-8000-00000000ffff')$$,
  'OP012', null, 'Confirmar una orden que no existe'
);
select throws_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP_total'), 'error'),
  'OP002', null, 'Un borrador no se anula: se borra'
);
select lives_ok(
  format('delete from orden_pago where id = %L', pg_temp.id('OP_total')),
  'Un borrador se borra'
);
select is(
  (select count(*) from orden_pago_medio where orden_pago_id = pg_temp.id('OP_total')),
  0::bigint,
  'Con sus medios'
);
select throws_ok(
  'update orden_pago_numeracion set ultimo_numero = 0',
  '42501', null, 'authenticated no mueve el contador'
);

-- Dos borradores con el mismo cheque: sólo se confirma el primero.
insert into op values ('OP2', guardar_orden_pago(null, pg_temp.orden(), pg_temp.cheque_tercero('CH2'), '[]'));
insert into op values ('OP3', guardar_orden_pago(null, pg_temp.orden(), pg_temp.cheque_tercero('CH2'), '[]'));
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP2')),
  'Se confirma la primera orden con el cheque'
);
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP3')),
  'OP009', null, 'La segunda ya no lo encuentra en la cartera'
);

-- Un borrador que imputa más de lo que quedó pendiente no se confirma.
insert into op values ('OP4', guardar_orden_pago(null, pg_temp.orden(), pg_temp.efectivo(500), pg_temp.imputar('F2', 500)));
insert into op values ('OP5', guardar_orden_pago(null, pg_temp.orden(), pg_temp.efectivo(500), pg_temp.imputar('F2', 500)));
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP4')),
  'Se confirma la orden que cancela F2'
);
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP5')),
  'OP006', null, 'La otra ya supera el saldo pendiente de F2'
);
select throws_ok(
  format('select guardar_orden_pago(%L, %L, %L, %L)', pg_temp.id('OP4'), pg_temp.orden(), pg_temp.efectivo(1), '[]'),
  'OP001', null, 'guardar_orden_pago no reemplaza una orden confirmada'
);

-- ---------------------------------------------------------------------
-- Anular
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP1'), '  '),
  'OP015', null, 'Para anular hace falta el motivo'
);
select lives_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP1'), ' Se cargó mal '),
  'Se anula una orden confirmada'
);
select is(
  (select estado || '|' || motivo_anulacion || '|' || (anulado_en is not null) || '|' || numero_texto
   from orden_pago where id = pg_temp.id('OP1')),
  'anulado|Se cargó mal|true|' || (select numero_texto from orden_pago where id = pg_temp.id('OP1')),
  'Queda anulada con su motivo y conserva el número'
);
select is(
  (select count(*) from imputacion_compra where orden_pago_id = pg_temp.id('OP1')),
  0::bigint,
  'Sus imputaciones se deshacen'
);
select is(
  (select array_agg(saldo order by numero)
   from v_comprobante_compra_saldo where comprobante_compra_id in (pg_temp.id('F1'), pg_temp.id('ND1'))),
  array[1000.00, 300.00]::numeric[],
  'Los comprobantes vuelven a quedar pendientes'
);
select ok(
  not exists (select 1 from v_proveedor_saldo_a_favor where orden_pago_id = pg_temp.id('OP1')),
  'Una orden anulada no deja saldo a favor'
);
select is(
  (select estado || '|' || coalesce(entregado_a, '-') || '|' || coalesce(proveedor_id::text, '-') || '|'
     || coalesce(orden_pago_id::text, '-') from cheque where id = pg_temp.id('CH1')),
  'en_cartera|-|-|-',
  'El cheque vuelve a la cartera, sin proveedor ni orden'
);
select is(
  (select estado || '|' || observacion from cheque_estado where cheque_id = pg_temp.id('CH1') order by id desc limit 1),
  'en_cartera|Orden de pago ' || (select numero_texto from orden_pago where id = pg_temp.id('OP1')) || ' anulada: Se cargó mal',
  'La vuelta a la cartera queda en el historial'
);
select throws_ok(
  format($$update orden_pago set observaciones = 'otra' where id = %L$$, pg_temp.id('OP1')),
  'OP001', null, 'Una orden anulada no se modifica'
);
select throws_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP1'), 'otra vez'),
  'OP002', null, 'No se anula dos veces'
);
select throws_ok(
  $$select anular_orden_pago('00000000-0000-4000-8000-00000000ffff', 'x')$$,
  'OP012', null, 'Anular una orden que no existe'
);

-- El cheque se vuelve a usar; si después se rechaza, la orden no se anula.
insert into op values ('OP6', guardar_orden_pago(null, pg_temp.orden(), pg_temp.cheque_tercero('CH1'), '[]'));
select lives_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP6')),
  'Un cheque que volvió a la cartera va en otra orden'
);
select lives_ok(
  format('select rechazar_cheque(%L, null, %L)', pg_temp.id('CH1'), 'Sin fondos'),
  'El proveedor devuelve el cheque rechazado'
);
select is(
  (select estado || '|' || orden_pago_id from cheque where id = pg_temp.id('CH1')),
  'rechazado|' || pg_temp.id('OP6'),
  'El cheque rechazado conserva la orden con que se entregó'
);
select throws_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP6'), 'x'),
  'OP010', null, 'Una orden con un cheque que ya no está entregado no se anula'
);

select * from finish();
rollback;
