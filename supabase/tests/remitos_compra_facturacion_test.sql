-- =====================================================================
-- Tests de la facturación de remitos de compra: vínculo
-- comprobante_compra_item -> remito_compra_item, lo facturado y lo
-- pendiente por renglón, estado de facturación del remito,
-- facturar_remitos_compra (precio sugerido y tope de lo pendiente),
-- facturación parcial en dos facturas, factura anulada que libera la
-- cantidad, reglas del vínculo (remito recibido, mismo proveedor, mismo
-- artículo, sólo facturas), remito bloqueado mientras tenga algo
-- facturado y vínculo conservado al volver a guardar la factura.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(53);

-- ---------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------

select has_column('public', 'comprobante_compra_item', 'remito_compra_item_id',
  'comprobante_compra_item apunta al renglón del remito de compra');
select fk_ok('public', 'comprobante_compra_item', 'remito_compra_item_id', 'public', 'remito_compra_item', 'id',
  'remito_compra_item_id referencia a remito_compra_item');
select has_index('public', 'comprobante_compra_item', 'comprobante_compra_item_remito_idx',
  'Índice por renglón de remito de compra');
select has_view('public', 'v_remito_compra_item_pendiente', 'Existe v_remito_compra_item_pendiente');
select has_view('public', 'v_remito_compra_estado', 'Existe v_remito_compra_estado');
select has_function('public', 'facturar_remitos_compra', array['jsonb', 'jsonb'], 'Existe facturar_remitos_compra');
select has_trigger('public', 'comprobante_compra_item', 'trg_comprobante_compra_item_remito',
  'Los renglones de factura controlan el remito');

select ok(
  not has_table_privilege('anon', 'public.' || v, 'select'),
  format('anon no lee %s', v)
)
from unnest(array['v_remito_compra_item_pendiente', 'v_remito_compra_estado']) as v;
select ok(
  not has_function_privilege('anon', 'public.facturar_remitos_compra(jsonb, jsonb)', 'execute'),
  'anon no ejecuta facturar_remitos_compra'
);

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000004a1', 'test-rcf-m', 'Metro de prueba remitos compra', 'LONGITUD');

insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000004b1', 'TEST-RCF-MP-1', 'Soga 8mm RCF',
   '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004a1'),
  ('00000000-0000-4000-8000-0000000004b2', 'TEST-RCF-MP-2', 'Malla RCF',
   '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000004c1', 'Proveedor facturación remitos 1'),
  ('00000000-0000-4000-8000-0000000004c2', 'Proveedor facturación remitos 2');

-- d1: un rollo de 10 metros de soga; d2: malla; d3: soga del proveedor 2.
insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, unidad, factor_conversion, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004c1',
   'SG-8', 'SOGA PP 8MM ROLLO 10M', 'rollo', 10, '00000000-0000-4000-8000-0000000004b1'),
  ('00000000-0000-4000-8000-0000000004d2', '00000000-0000-4000-8000-0000000004c1',
   'ML-1', 'MALLA', 'm', 1, '00000000-0000-4000-8000-0000000004b2'),
  ('00000000-0000-4000-8000-0000000004d3', '00000000-0000-4000-8000-0000000004c2',
   'SG-8', 'SOGA 8', 'rollo', 1, '00000000-0000-4000-8000-0000000004b1');

-- Precios de la soga del proveedor 1: el vigente al 2026-11-03 es 120 por metro.
insert into precio_materia_prima (materia_prima_id, proveedor_id, precio, vigente_desde) values
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004c1', 100, '2026-10-01'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004c1', 120, '2026-10-20'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004c1', 999, '2026-12-01'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004c2', 555, '2026-10-01');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table x (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text) returns uuid language sql as $$
  select id from x where nombre = p_nombre;
$$;

create function pg_temp.remito(p_numero bigint, p_proveedor uuid, p_items jsonb) returns uuid language sql as $$
  select guardar_remito_compra(null,
    jsonb_build_object('proveedor_id', p_proveedor, 'punto_venta', 9, 'numero', p_numero, 'fecha', '2026-11-01'),
    p_items);
$$;

create function pg_temp.factura(p_letra text, p_numero bigint, p_tipo text default 'factura',
  p_proveedor uuid default '00000000-0000-4000-8000-0000000004c1')
returns jsonb language sql as $$
  select jsonb_build_object('proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', p_letra,
    'punto_venta', 4, 'numero', p_numero, 'fecha', '2026-11-03');
$$;

-- R1: 10 rollos de soga y 4 m de malla. R2: 5 rollos. R3: del proveedor 2. RB: borrador.
insert into x values ('R1', pg_temp.remito(1, '00000000-0000-4000-8000-0000000004c1', jsonb_build_array(
  jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1', 'cantidad', 10),
  jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d2', 'cantidad', 4))));
insert into x values ('R2', pg_temp.remito(2, '00000000-0000-4000-8000-0000000004c1', jsonb_build_array(
  jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1', 'descripcion', 'Soga (remito 2)',
    'cantidad', 5))));
insert into x values ('R3', pg_temp.remito(3, '00000000-0000-4000-8000-0000000004c2', jsonb_build_array(
  jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d3', 'cantidad', 1))));
insert into x values ('RB', pg_temp.remito(4, '00000000-0000-4000-8000-0000000004c1', jsonb_build_array(
  jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1', 'cantidad', 1))));
select recibir_remito_compra(pg_temp.id(r)) from unnest(array['R1', 'R2', 'R3']) r;

insert into x
select 'i1', id from remito_compra_item where remito_compra_id = pg_temp.id('R1') and orden = 0
union all select 'i2', id from remito_compra_item where remito_compra_id = pg_temp.id('R1') and orden = 1
union all select 'i3', id from remito_compra_item where remito_compra_id = pg_temp.id('R2')
union all select 'i4', id from remito_compra_item where remito_compra_id = pg_temp.id('R3')
union all select 'i5', id from remito_compra_item where remito_compra_id = pg_temp.id('RB');

create function pg_temp.pendiente(p_item text) returns numeric language sql as $$
  select pendiente from v_remito_compra_item_pendiente where remito_compra_item_id = pg_temp.id(p_item);
$$;
create function pg_temp.estado(p_remito text) returns text language sql as $$
  select estado_facturacion from v_remito_compra_estado where remito_compra_id = pg_temp.id(p_remito);
$$;

select is(
  (select cantidad || '|' || facturada || '|' || pendiente from v_remito_compra_item_pendiente
   where remito_compra_item_id = pg_temp.id('i1')),
  '10.0000|0|10.0000',
  'Un renglón sin facturar tiene todo pendiente'
);
select is(pg_temp.estado('R1'), 'pendiente', 'Un remito sin nada facturado está pendiente');

-- ---------------------------------------------------------------------
-- facturar_remitos_compra
-- ---------------------------------------------------------------------

insert into x values ('F1', facturar_remitos_compra(
  jsonb_build_array(
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 6),
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i3'), 'cantidad', 5)),
  -- El tipo y el proveedor que mande la app se ignoran.
  pg_temp.factura('A', 501, 'nota_credito', '00000000-0000-4000-8000-0000000004c2')
));

select is(
  (select tipo || '|' || letra || '|' || estado || '|' || proveedor_id || '|' || punto_venta || '|' || numero || '|' || fecha
   from comprobante_compra where id = pg_temp.id('F1')),
  'factura|A|borrador|00000000-0000-4000-8000-0000000004c1|4|501|2026-11-03',
  'facturar_remitos_compra crea un borrador de factura del proveedor de los remitos'
);
select is(
  (select array_agg(proveedor_articulo_id || '|' || codigo_proveedor || '|' || descripcion || '|' || unidad || '|'
     || cantidad || '|' || precio_unitario || '|' || alicuota_iva || '|' || remito_compra_item_id order by orden)
   from comprobante_compra_item where comprobante_compra_id = pg_temp.id('F1')),
  array[
    '00000000-0000-4000-8000-0000000004d1|SG-8|SOGA PP 8MM ROLLO 10M|rollo|6.0000|1200.0000|21.00|' || pg_temp.id('i1'),
    '00000000-0000-4000-8000-0000000004d1|SG-8|Soga (remito 2)|rollo|5.0000|1200.0000|21.00|' || pg_temp.id('i3')
  ],
  'Un renglón por renglón de remito, con su artículo, la cantidad pedida, el precio vigente × factor y 21% de IVA'
);
select is(pg_temp.pendiente('i1'), 4.0000, 'Lo facturado en un borrador ya no está pendiente');
select is(pg_temp.estado('R1'), 'parcial', 'Un remito con algo facturado y algo pendiente está parcial');
select is(pg_temp.estado('R2'), 'facturado', 'Un remito sin nada pendiente está facturado');

select throws_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 5)), pg_temp.factura('A', 502)),
  'RC010', null, 'No se factura más que lo pendiente'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)', jsonb_build_array(
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 1),
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i4'), 'cantidad', 1)), pg_temp.factura('A', 502)),
  'RC009', null, 'Remitos de proveedores distintos no van en una factura'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', pg_temp.id('i5'), 'cantidad', 1)), pg_temp.factura('A', 502)),
  'RC009', null, 'Un remito en borrador no se factura'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)', jsonb_build_array(
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 1),
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 1)), pg_temp.factura('A', 502)),
  'RC009', null, 'Un renglón de remito no se repite'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)', '[]', pg_temp.factura('A', 502)),
  'RC009', null, 'Sin renglones no se factura'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 0)), pg_temp.factura('A', 502)),
  'RC009', null, 'La cantidad a facturar es mayor que cero'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', '00000000-0000-4000-8000-0000000004ff', 'cantidad', 1)),
    pg_temp.factura('A', 502)),
  'RC004', null, 'Un renglón de remito inexistente'
);

-- Segunda factura, B: sin alícuota; la malla no tiene precio del proveedor.
insert into x values ('F2', facturar_remitos_compra(
  jsonb_build_array(
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 4),
    jsonb_build_object('remito_compra_item_id', pg_temp.id('i2'), 'cantidad', 1.5)),
  pg_temp.factura('B', 502)
));
select is(
  (select array_agg(cantidad || '|' || precio_unitario || '|' || coalesce(alicuota_iva::text, 'sin alícuota') order by orden)
   from comprobante_compra_item where comprobante_compra_id = pg_temp.id('F2')),
  array['4.0000|1200.0000|sin alícuota', '1.5000|0.0000|sin alícuota'],
  'En B no hay alícuota; sin precio del proveedor, el sugerido es 0'
);
select is(
  (select facturada || '|' || pendiente from v_remito_compra_item_pendiente where remito_compra_item_id = pg_temp.id('i1')),
  '10.0000|0.0000',
  'Dos facturas cubren entre las dos todo el renglón'
);
select is(pg_temp.estado('R1'), 'parcial', 'R1 sigue parcial: a la malla le queda pendiente');

-- ---------------------------------------------------------------------
-- Reglas del vínculo (también con guardar_comprobante_compra)
-- ---------------------------------------------------------------------

select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)', pg_temp.factura('A', 503),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1',
      'remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC010', null, 'Guardando una factura tampoco se pasa de lo pendiente'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)', pg_temp.factura('A', 503),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1',
      'remito_compra_item_id', pg_temp.id('i2'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC009', null, 'El renglón de la factura tiene el mismo artículo que el del remito'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)', pg_temp.factura('A', 503, 'nota_credito'),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d2',
      'remito_compra_item_id', pg_temp.id('i2'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC009', null, 'Una nota de crédito no factura remitos'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)', pg_temp.factura('A', 503, 'nota_debito'),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d2',
      'remito_compra_item_id', pg_temp.id('i2'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC009', null, 'Una nota de débito no factura remitos'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)',
    pg_temp.factura('A', 503, 'factura', '00000000-0000-4000-8000-0000000004c2'),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d3',
      'remito_compra_item_id', pg_temp.id('i2'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC009', null, 'Una factura de otro proveedor no factura el remito'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L, %L, %L)', pg_temp.factura('A', 503),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1',
      'remito_compra_item_id', pg_temp.id('i5'), 'cantidad', 1, 'precio_unitario', 1)), '[]'),
  'RC009', null, 'Un remito en borrador no se factura guardando la factura'
);
select throws_ok(
  format($$update comprobante_compra set tipo = 'nota_credito' where id = %L$$, pg_temp.id('F2')),
  'RC009', null, 'Una factura con renglones de remitos no pasa a ser una nota'
);

-- ---------------------------------------------------------------------
-- El remito facturado queda bloqueado
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_remito_compra(%L)', pg_temp.id('R1')),
  'RC008', null, 'Un remito con algo facturado no se anula'
);
select throws_ok(
  format($$select set_config('compras.anulando_remito', %L, true);
    update remito_compra set estado = 'anulado', anulado_en = now() where id = %L$$, pg_temp.id('R1'), pg_temp.id('R1')),
  'RC008', null, 'Con SQL directo tampoco se anula un remito con algo facturado'
);
select throws_ok(
  format($$update remito_compra set observaciones = 'otra' where id = %L$$, pg_temp.id('R1')),
  'RC001', null, 'Un remito facturado no se modifica'
);
select throws_ok(
  format($$update remito_compra_item set cantidad = 20 where id = %L$$, pg_temp.id('i1')),
  'RC001', null, 'Los renglones de un remito facturado no se modifican'
);

-- ---------------------------------------------------------------------
-- Confirmar y anular la factura; volver a guardar
-- ---------------------------------------------------------------------

select lives_ok(
  format('select confirmar_comprobante_compra(%L)', pg_temp.id('F1')),
  'Una factura armada desde remitos se confirma'
);
select is(pg_temp.pendiente('i1'), 0.0000, 'Lo confirmado sigue contando como facturado');
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('F1')),
  'Una factura armada desde remitos se anula'
);
select is(pg_temp.pendiente('i1'), 6.0000, 'Una factura anulada libera su cantidad');
select is(pg_temp.estado('R2'), 'pendiente', 'R2 vuelve a pendiente');
select is(
  (select count(*)::int from comprobante_compra_item where comprobante_compra_id = pg_temp.id('F1')
     and remito_compra_item_id is not null),
  2,
  'La factura anulada conserva el vínculo con los remitos'
);

-- Volver a guardar el borrador F2 con el vínculo y otra cantidad lo conserva.
select lives_ok(
  format('select guardar_comprobante_compra(%L, %L, %L, %L)', pg_temp.id('F2'), pg_temp.factura('B', 502),
    jsonb_build_array(
      jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d1',
        'remito_compra_item_id', pg_temp.id('i1'), 'descripcion', 'Soga', 'cantidad', 3, 'precio_unitario', 1200),
      jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000004d2',
        'remito_compra_item_id', pg_temp.id('i2'), 'descripcion', 'Malla', 'cantidad', 4, 'precio_unitario', 10)),
    '[]'),
  'Un borrador armado desde remitos se vuelve a guardar'
);
select is(
  (select array_agg(remito_compra_item_id order by orden) from comprobante_compra_item
   where comprobante_compra_id = pg_temp.id('F2')),
  array[pg_temp.id('i1'), pg_temp.id('i2')],
  'guardar_comprobante_compra conserva el vínculo de cada renglón'
);
select is(pg_temp.pendiente('i1'), 7.0000, 'Lo pendiente sigue a la nueva cantidad');
select is(pg_temp.estado('R1'), 'parcial', 'R1 sigue parcial');

select lives_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 7)), pg_temp.factura('A', 504)),
  'Se factura justo lo pendiente'
);

-- Borrar los borradores deja el remito sin nada facturado y se puede anular.
delete from comprobante_compra where proveedor_id = '00000000-0000-4000-8000-0000000004c1' and estado = 'borrador';
select is(pg_temp.estado('R1'), 'pendiente', 'Sin borradores, R1 no tiene nada facturado');
select lives_ok(
  format('select anular_remito_compra(%L)', pg_temp.id('R2')),
  'Un remito cuya factura se anuló se puede anular'
);
select lives_ok(
  format('select anular_remito_compra(%L)', pg_temp.id('R1')),
  'Un remito cuyos borradores de factura se borraron se puede anular'
);
select throws_ok(
  format('select facturar_remitos_compra(%L, %L)',
    jsonb_build_array(jsonb_build_object('remito_compra_item_id', pg_temp.id('i1'), 'cantidad', 1)), pg_temp.factura('A', 505)),
  'RC009', null, 'Un remito anulado no se factura'
);

select * from finish();
rollback;
