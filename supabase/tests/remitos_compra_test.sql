-- =====================================================================
-- Tests de los remitos de compra: estructura, permisos, alta y
-- reutilización de artículos del proveedor, materia prima tomada del
-- artículo, renglones siempre con artículo, recepción, anulación, número
-- único por proveedor, inmutabilidad, borrado y las transiciones con la
-- marca de la transacción puesta a mano.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(58);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['remito_compra', 'remito_compra_item']) as t;

select has_function('public', 'guardar_remito_compra', array['uuid', 'jsonb', 'jsonb'], 'Existe guardar_remito_compra');
select has_function('public', 'recibir_remito_compra', array['uuid'], 'Existe recibir_remito_compra');
select has_function('public', 'anular_remito_compra', array['uuid'], 'Existe anular_remito_compra');
select has_index('public', 'remito_compra', 'remito_compra_numero_unico', 'Índice único del número del proveedor');
select col_default_is('public', 'remito_compra', 'estado', 'borrador', 'Un remito de compra nace en borrador');
select col_not_null('public', 'remito_compra_item', 'proveedor_articulo_id', 'Todo renglón tiene un artículo del proveedor');
select has_trigger('public', 'remito_compra_item', 'trg_remito_compra_con_items',
  'Un recibido o anulado no se queda sin renglones');

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
  format('%s tiene RLS habilitada', t)
)
from unnest(array['remito_compra', 'remito_compra_item']) as t;

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['remito_compra', 'remito_compra_item']) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.guardar_remito_compra(uuid, jsonb, jsonb)',
  'public.recibir_remito_compra(uuid)',
  'public.anular_remito_compra(uuid)'
]) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000003a1', 'test-rc-kg', 'Kilo de prueba remitos compra', 'MASA');

insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000003b1', 'TEST-RC-MP-1', 'Soga 8mm de prueba RC',
   '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003a1'),
  ('00000000-0000-4000-8000-0000000003b2', 'TEST-RC-MP-2', 'Soga 10mm de prueba RC',
   '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000003c1', 'Proveedor remitos 1'),
  ('00000000-0000-4000-8000-0000000003c2', 'Proveedor remitos 2');

insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, unidad, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003c1',
   'SG-8', 'SOGA PP diam 8MM', 'rollo', '00000000-0000-4000-8000-0000000003b1'),
  ('00000000-0000-4000-8000-0000000003d2', '00000000-0000-4000-8000-0000000003c2',
   'SG-8', 'SOGA PP diam 8MM', 'rollo', '00000000-0000-4000-8000-0000000003b1');
insert into proveedor_articulo (id, proveedor_id, descripcion) values
  ('00000000-0000-4000-8000-0000000003d3', '00000000-0000-4000-8000-0000000003c1', 'Hilo sin materia prima');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table rc (nombre text primary key, id uuid);

-- Cabecera de un remito del proveedor 1 con el número dado.
create function pg_temp.cabecera(p_numero bigint, p_proveedor uuid default '00000000-0000-4000-8000-0000000003c1')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'proveedor_id', p_proveedor, 'punto_venta', 7, 'numero', p_numero,
    'fecha', '2026-11-02', 'observaciones', 'Entregó Juan'
  );
$$;

-- ---------------------------------------------------------------------
-- Guardar: artículo existente, artículo nuevo y materia prima
-- ---------------------------------------------------------------------

insert into rc values ('A', guardar_remito_compra(
  null,
  pg_temp.cabecera(101),
  jsonb_build_array(
    jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1',
      'descripcion', 'Soga 8 mm (como el remito)', 'materia_prima_id', '00000000-0000-4000-8000-0000000003b2',
      'cantidad', 10.5),
    jsonb_build_object('articulo_nuevo', jsonb_build_object(
        'codigo', 'SG-10', 'descripcion', 'SOGA PP diam 10MM', 'unidad', 'rollo', 'factor_conversion', 200,
        'materia_prima_id', '00000000-0000-4000-8000-0000000003b2'),
      'cantidad', 3)
  )
));

select is(
  (select estado || '|' || punto_venta || '|' || numero || '|' || fecha || '|' || observaciones
   from remito_compra where id = (select id from rc where nombre = 'A')),
  'borrador|7|101|2026-11-02|Entregó Juan',
  'guardar_remito_compra crea un borrador con la cabecera'
);
select is(
  (select array_agg(descripcion || '|' || coalesce(codigo_proveedor, '') || '|' || coalesce(unidad, '') || '|' || cantidad order by orden)
   from remito_compra_item where remito_compra_id = (select id from rc where nombre = 'A')),
  array['Soga 8 mm (como el remito)|SG-8|rollo|10.5000', 'SOGA PP diam 10MM|SG-10|rollo|3.0000'],
  'Los renglones guardan la descripción tal cual y toman código y unidad del artículo'
);
select is(
  (select materia_prima_id from remito_compra_item where remito_compra_id = (select id from rc where nombre = 'A') and orden = 0),
  '00000000-0000-4000-8000-0000000003b1'::uuid,
  'La materia prima sale del artículo, no de lo que manda la app'
);
select is(
  (select factor_conversion || '|' || materia_prima_id from proveedor_articulo
   where proveedor_id = '00000000-0000-4000-8000-0000000003c1' and codigo = 'SG-10'),
  '200.00000000|00000000-0000-4000-8000-0000000003b2',
  'El artículo nuevo se da de alta en el catálogo del proveedor'
);

-- El mismo artículo nuevo (código con otro formato) se reutiliza.
insert into rc values ('B', guardar_remito_compra(
  null,
  pg_temp.cabecera(102),
  jsonb_build_array(jsonb_build_object('articulo_nuevo', jsonb_build_object(
    'codigo', ' sg-10 ', 'descripcion', 'Otra descripción', 'materia_prima_id', '00000000-0000-4000-8000-0000000003b1'),
    'cantidad', 1))
));
select is(
  (select count(*)::int from proveedor_articulo
   where proveedor_id = '00000000-0000-4000-8000-0000000003c1' and lower(codigo) = 'sg-10'),
  1,
  'Un artículo nuevo que ya está en el catálogo se reutiliza'
);

select throws_ok(
  format('select guardar_remito_compra(null, %L, %L)', pg_temp.cabecera(103),
    jsonb_build_array(jsonb_build_object('descripcion', 'Flete', 'cantidad', 1))),
  'RC011', null, 'Un renglón sin artículo no se guarda en un remito'
);
select throws_ok(
  format('select guardar_remito_compra(null, %L, %L)', pg_temp.cabecera(103),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d2', 'cantidad', 1))),
  'RC006', null, 'Un artículo de otro proveedor no se guarda'
);
select throws_ok(
  format('select guardar_remito_compra(null, %L, %L)', pg_temp.cabecera(103),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 0))),
  '23514', null, 'La cantidad tiene que ser mayor que cero'
);
select throws_ok(
  format('select guardar_remito_compra(null, %L, %L)',
    jsonb_set(pg_temp.cabecera(103), '{punto_venta}', '0'),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 1))),
  '23514', null, 'El punto de venta va de 1 a 99999'
);

-- Un borrador se vuelve a guardar: reemplaza cabecera y renglones.
select lives_ok(
  format('select guardar_remito_compra(%L, %L, %L)', (select id from rc where nombre = 'B'),
    jsonb_set(pg_temp.cabecera(102), '{observaciones}', '"Corregido"'),
    jsonb_build_array(
      jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 4),
      jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 5))),
  'Un borrador se vuelve a guardar'
);
select is(
  (select observaciones || '|' || (select count(*) from remito_compra_item i where i.remito_compra_id = r.id)
   from remito_compra r where r.id = (select id from rc where nombre = 'B')),
  'Corregido|2',
  'Al volver a guardar se reemplazan la cabecera y los renglones'
);

-- ---------------------------------------------------------------------
-- Número único por proveedor
-- ---------------------------------------------------------------------

select throws_ok(
  format('select guardar_remito_compra(null, %L, %L)', pg_temp.cabecera(101),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 1))),
  '23505', null, 'El mismo remito del mismo proveedor no se carga dos veces'
);
select lives_ok(
  format('select guardar_remito_compra(null, %L, %L)',
    pg_temp.cabecera(101, '00000000-0000-4000-8000-0000000003c2'),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d2', 'cantidad', 1))),
  'El mismo número de otro proveedor sí se carga'
);

-- ---------------------------------------------------------------------
-- Recibir
-- ---------------------------------------------------------------------

insert into rc values ('vacio', guardar_remito_compra(null, pg_temp.cabecera(201), '[]'));
select throws_ok(
  format('select recibir_remito_compra(%L)', (select id from rc where nombre = 'vacio')),
  'RC005', null, 'Un remito sin renglones no se recibe'
);

insert into rc values ('sin_mp', guardar_remito_compra(null, pg_temp.cabecera(202),
  jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d3', 'cantidad', 2))));
select throws_ok(
  format('select recibir_remito_compra(%L)', (select id from rc where nombre = 'sin_mp')),
  'RC007', null, 'Un remito con un artículo sin materia prima no se recibe'
);

-- La marca de la transacción sola no saltea las reglas: las controla el trigger.
select throws_ok(
  format($$select set_config('compras.recibiendo_remito', %L, true);
    update remito_compra set estado = 'recibido', recibido_en = now() where id = %L$$,
    (select id from rc where nombre = 'vacio'), (select id from rc where nombre = 'vacio')),
  'RC005', null, 'Con SQL directo tampoco se recibe un remito sin renglones'
);
select throws_ok(
  format($$select set_config('compras.recibiendo_remito', %L, true);
    update remito_compra set estado = 'recibido', recibido_en = now() where id = %L$$,
    (select id from rc where nombre = 'sin_mp'), (select id from rc where nombre = 'sin_mp')),
  'RC007', null, 'Con SQL directo tampoco se recibe con un artículo sin materia prima'
);
select throws_ok(
  format($$update remito_compra set estado = 'recibido', recibido_en = now() where id = %L$$,
    (select id from rc where nombre = 'A')),
  'RC002', null, 'Sin recibir_remito_compra no se pasa a recibido'
);
select throws_ok(
  format($$insert into remito_compra (proveedor_id, punto_venta, numero, estado, recibido_en)
    values ('00000000-0000-4000-8000-0000000003c1', 7, 999, 'recibido', now())$$),
  'RC002', null, 'Un remito no se crea recibido'
);

-- Asociar la materia prima en el catálogo destraba la recepción.
update proveedor_articulo set materia_prima_id = '00000000-0000-4000-8000-0000000003b2'
where id = '00000000-0000-4000-8000-0000000003d3';
select lives_ok(
  format('select recibir_remito_compra(%L)', (select id from rc where nombre = 'sin_mp')),
  'Con la materia prima asociada en el catálogo, se recibe'
);
select is(
  (select materia_prima_id from remito_compra_item where remito_compra_id = (select id from rc where nombre = 'sin_mp')),
  '00000000-0000-4000-8000-0000000003b2'::uuid,
  'Al recibir, el renglón toma la materia prima vigente del artículo'
);

select lives_ok(
  format('select recibir_remito_compra(%L)', (select id from rc where nombre = 'A')),
  'Un borrador con renglones se recibe'
);
select ok(
  (select estado = 'recibido' and recibido_en is not null and anulado_en is null
   from remito_compra where id = (select id from rc where nombre = 'A')),
  'El remito queda recibido con la fecha de recepción'
);
select throws_ok(
  format('select recibir_remito_compra(%L)', (select id from rc where nombre = 'A')),
  'RC002', null, 'Un recibido no se vuelve a recibir'
);
select throws_ok(
  format('select recibir_remito_compra(%L)', '00000000-0000-4000-8000-0000000003ff'),
  'RC004', null, 'Recibir un remito inexistente'
);

-- ---------------------------------------------------------------------
-- Inmutabilidad y borrado
-- ---------------------------------------------------------------------

select throws_ok(
  format($$update remito_compra set observaciones = 'otra' where id = %L$$, (select id from rc where nombre = 'A')),
  'RC001', null, 'Un recibido no se modifica'
);
select throws_ok(
  format('select guardar_remito_compra(%L, %L, %L)', (select id from rc where nombre = 'A'), pg_temp.cabecera(101),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 1))),
  'RC001', null, 'guardar_remito_compra no modifica un recibido'
);
select throws_ok(
  format($$update remito_compra_item set cantidad = 99 where remito_compra_id = %L$$, (select id from rc where nombre = 'A')),
  'RC001', null, 'Los renglones de un recibido no se modifican'
);
select throws_ok(
  format($$insert into remito_compra_item (remito_compra_id, proveedor_articulo_id, descripcion, cantidad)
    values (%L, '00000000-0000-4000-8000-0000000003d1', 'Otro', 1)$$, (select id from rc where nombre = 'A')),
  'RC001', null, 'A un recibido no se le agregan renglones'
);
select throws_ok(
  format($$delete from remito_compra_item where remito_compra_id = %L$$, (select id from rc where nombre = 'A')),
  'RC001', null, 'A un recibido no se le borran renglones'
);
select throws_ok(
  format($$delete from remito_compra where id = %L$$, (select id from rc where nombre = 'A')),
  'RC003', null, 'Un recibido no se borra'
);
select throws_ok(
  format($$update remito_compra set estado = 'borrador', recibido_en = null where id = %L$$, (select id from rc where nombre = 'A')),
  'RC002', null, 'Un recibido no vuelve a borrador'
);
select lives_ok(
  format($$delete from remito_compra where id = %L$$, (select id from rc where nombre = 'vacio')),
  'Un borrador se borra'
);

-- ---------------------------------------------------------------------
-- Anular
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_remito_compra(%L)', (select id from rc where nombre = 'B')),
  'RC002', null, 'Un borrador no se anula (se borra)'
);
select throws_ok(
  format($$update remito_compra set estado = 'anulado', anulado_en = now() where id = %L$$, (select id from rc where nombre = 'A')),
  'RC002', null, 'Sin anular_remito_compra no se pasa a anulado'
);
select lives_ok(
  format('select anular_remito_compra(%L)', (select id from rc where nombre = 'A')),
  'Un recibido se anula'
);
select ok(
  (select estado = 'anulado' and anulado_en is not null and recibido_en is not null
   from remito_compra where id = (select id from rc where nombre = 'A')),
  'El remito queda anulado y conserva la recepción'
);
select is(
  (select count(*)::int from remito_compra_item where remito_compra_id = (select id from rc where nombre = 'A')),
  2,
  'Un anulado conserva sus renglones'
);
select throws_ok(
  format($$update remito_compra set observaciones = 'otra' where id = %L$$, (select id from rc where nombre = 'A')),
  'RC001', null, 'Un anulado no se modifica'
);
select throws_ok(
  format($$delete from remito_compra where id = %L$$, (select id from rc where nombre = 'A')),
  'RC003', null, 'Un anulado no se borra'
);
select throws_ok(
  format('select anular_remito_compra(%L)', (select id from rc where nombre = 'A')),
  'RC002', null, 'Un anulado no se vuelve a anular'
);
select lives_ok(
  format('select guardar_remito_compra(null, %L, %L)', pg_temp.cabecera(101),
    jsonb_build_array(jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'cantidad', 1))),
  'Anular deja libre el número para cargarlo bien'
);

select * from finish();
rollback;
