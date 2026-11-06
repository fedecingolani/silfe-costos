-- =====================================================================
-- Tests de las notas de crédito y débito asociadas a una factura de
-- compra: qué se puede asociar (sólo una nota, a una factura confirmada
-- del mismo proveedor y la misma letra, no a sí misma), el nuevo control
-- al confirmar, que las notas no actualizan precios y que una factura con
-- notas confirmadas no se anula (una nota en borrador no lo impide).
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_column('public', 'comprobante_compra', 'comprobante_asociado_id', 'El comprobante tiene la factura asociada');
select col_is_null('public', 'comprobante_compra', 'comprobante_asociado_id', 'La factura asociada es opcional');
select fk_ok('public', 'comprobante_compra', 'comprobante_asociado_id', 'public', 'comprobante_compra', 'id',
  'La factura asociada es otro comprobante de compra');
select has_index('public', 'comprobante_compra', 'comprobante_compra_asociado_idx', 'Índice de la factura asociada');

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000003a1', 'test-na-kg', 'Kilo de prueba notas', 'MASA');
insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000003b1', 'TEST-NA-MP-1', 'Malla de prueba notas',
   '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003a1');
insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000003c1', 'Proveedor notas 1'),
  ('00000000-0000-4000-8000-0000000003c2', 'Proveedor notas 2');
insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003c1', 'M-1', 'MALLA',
   '00000000-0000-4000-8000-0000000003b1');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table cc (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from cc where nombre = p_nombre; $$;

create function pg_temp.cabecera(p_tipo text, p_letra text, p_numero bigint,
  p_asociado uuid default null, p_proveedor uuid default '00000000-0000-4000-8000-0000000003c1')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', p_letra,
    'punto_venta', 4, 'numero', p_numero, 'fecha', '2026-11-01',
    'comprobante_asociado_id', p_asociado
  );
$$;

-- Un renglón con artículo (con materia prima, del proveedor 1) y uno
-- libre. Para otro proveedor, sólo el libre.
create function pg_temp.renglones(p_letra text, p_con_articulo boolean default true)
returns jsonb
language sql
as $$
  select case when p_con_articulo then jsonb_build_array(
    jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000003d1', 'descripcion', 'MALLA',
      'cantidad', 2, 'precio_unitario', 100,
      'alicuota_iva', case when p_letra in ('A', 'M') then 21 end)
  ) else '[]'::jsonb end
  || jsonb_build_array(jsonb_build_object('descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 10));
$$;

-- Guarda un comprobante nuevo y lo registra con un nombre.
create function pg_temp.nuevo(p_nombre text, p_cabecera jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_comprobante_compra(null, p_cabecera,
    pg_temp.renglones(p_cabecera->>'letra', p_cabecera->>'proveedor_id' = '00000000-0000-4000-8000-0000000003c1'),
    '[]'::jsonb);
  insert into cc values (p_nombre, v_id);
  return v_id;
end;
$$;

-- Facturas: FA (A, confirmada), FB (B, confirmada), F_borrador (A),
-- F_anulada (A), F_otro (A, de otro proveedor, confirmada).
do $$
begin
  perform pg_temp.nuevo('FA', pg_temp.cabecera('factura', 'A', 1));
  perform pg_temp.nuevo('FB', pg_temp.cabecera('factura', 'B', 2));
  perform pg_temp.nuevo('F_borrador', pg_temp.cabecera('factura', 'A', 3));
  perform pg_temp.nuevo('F_anulada', pg_temp.cabecera('factura', 'A', 4));
  perform pg_temp.nuevo('F_otro', pg_temp.cabecera('factura', 'A', 5, null, '00000000-0000-4000-8000-0000000003c2'));
  perform confirmar_comprobante_compra(pg_temp.id(n)) from unnest(array['FA', 'FB', 'F_anulada', 'F_otro']) as n;
  perform anular_comprobante_compra(pg_temp.id('F_anulada'));
end;
$$;

-- ---------------------------------------------------------------------
-- Qué se puede asociar
-- ---------------------------------------------------------------------

select lives_ok(
  format('select pg_temp.nuevo(%L, %L::jsonb)', 'NC', pg_temp.cabecera('nota_credito', 'A', 10, pg_temp.id('FA'))),
  'Una nota de crédito se asocia a una factura confirmada del mismo proveedor y letra'
);
select is(
  (select comprobante_asociado_id from comprobante_compra where id = pg_temp.id('NC')),
  pg_temp.id('FA'),
  'guardar_comprobante_compra guarda la factura asociada'
);
select lives_ok(
  format('select pg_temp.nuevo(%L, %L::jsonb)', 'ND', pg_temp.cabecera('nota_debito', 'A', 11, pg_temp.id('FA'))),
  'Una nota de débito también se asocia'
);
select lives_ok(
  format('select pg_temp.nuevo(%L, %L::jsonb)', 'NC_suelta', pg_temp.cabecera('nota_credito', 'A', 12)),
  'Una nota sin factura asociada (suelta) se guarda'
);
select lives_ok(
  format('select guardar_comprobante_compra(%L, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.id('NC'), pg_temp.cabecera('nota_credito', 'A', 10), pg_temp.renglones('A'), '[]'),
  'Al volver a guardar sin factura asociada, la nota queda suelta'
);
select is(
  (select comprobante_asociado_id from comprobante_compra where id = pg_temp.id('NC')),
  null,
  'La asociación se puede quitar'
);

select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('factura', 'A', 20, pg_temp.id('FA')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Una factura no lleva factura asociada'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('nota_credito', 'A', 21, pg_temp.id('NC_suelta')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Lo asociado tiene que ser una factura'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('nota_credito', 'A', 22, pg_temp.id('F_borrador')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Una factura en borrador no se asocia'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('nota_credito', 'A', 23, pg_temp.id('F_anulada')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Una factura anulada no se asocia'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('nota_credito', 'A', 24, pg_temp.id('F_otro')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Una factura de otro proveedor no se asocia'
);
select throws_ok(
  format('select guardar_comprobante_compra(null, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.cabecera('nota_credito', 'A', 25, pg_temp.id('FB')), pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Una factura de otra letra no se asocia'
);
select throws_ok(
  format('select guardar_comprobante_compra(%L, %L::jsonb, %L::jsonb, %L::jsonb)',
    pg_temp.id('NC_suelta'), pg_temp.cabecera('nota_credito', 'A', 12, pg_temp.id('NC_suelta')),
    pg_temp.renglones('A'), '[]'),
  'CP012', null, 'Un comprobante no se asocia a sí mismo'
);
select throws_ok(
  format('update comprobante_compra set comprobante_asociado_id = %L where id = %L',
    pg_temp.id('FB'), pg_temp.id('NC_suelta')),
  'CP012', null, 'El control vale también para SQL directo'
);

-- ---------------------------------------------------------------------
-- Al confirmar se vuelve a controlar
-- ---------------------------------------------------------------------

do $$
begin
  perform pg_temp.nuevo('F_luego_anulada', pg_temp.cabecera('factura', 'A', 30));
  perform confirmar_comprobante_compra(pg_temp.id('F_luego_anulada'));
  perform pg_temp.nuevo('NC_huerfana', pg_temp.cabecera('nota_credito', 'A', 31, pg_temp.id('F_luego_anulada')));
end;
$$;

select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('F_luego_anulada')),
  'Una nota en borrador no impide anular su factura'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L)', pg_temp.id('NC_huerfana')),
  'CP012', null, 'Una nota cuya factura se anuló después no se confirma'
);
select is(
  (select estado from comprobante_compra where id = pg_temp.id('NC_huerfana')),
  'borrador',
  'La nota rechazada sigue en borrador'
);

-- ---------------------------------------------------------------------
-- Las notas no actualizan precios
-- ---------------------------------------------------------------------

select is(
  (select count(*) from precios_comprobante_compra(pg_temp.id('ND'))),
  0::bigint,
  'precios_comprobante_compra no devuelve renglones de una nota'
);
select is(
  (select count(*) from precios_comprobante_compra(pg_temp.id('F_borrador'))),
  1::bigint,
  'De una factura sigue devolviendo los renglones con materia prima'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L, array[%L]::uuid[])',
    pg_temp.id('ND'),
    (select i.id from comprobante_compra_item i where i.comprobante_compra_id = pg_temp.id('ND') and i.orden = 0)),
  'CP013', null, 'Una nota no actualiza precios al confirmarse'
);
select is(
  (select estado from comprobante_compra where id = pg_temp.id('ND')),
  'borrador',
  'La nota rechazada sigue en borrador'
);
select lives_ok(
  format('select confirmar_comprobante_compra(%L)', pg_temp.id('ND')),
  'Sin precios elegidos, la nota asociada se confirma'
);
select lives_ok(
  format('select confirmar_comprobante_compra(%L, %L::uuid[])', pg_temp.id('NC_suelta'), '{}'),
  'Una nota suelta se confirma'
);

-- ---------------------------------------------------------------------
-- Anular una factura con notas
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('FA')),
  'CP014', null, 'Una factura con una nota confirmada no se anula'
);
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('ND')),
  'La nota se anula'
);
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('FA')),
  'Con sus notas anuladas, la factura se anula'
);

select * from finish();
rollback;
