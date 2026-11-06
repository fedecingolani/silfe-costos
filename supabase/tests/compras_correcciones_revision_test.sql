-- =====================================================================
-- Tests de las correcciones de las revisiones de compras
-- (20261105000009_compras_correcciones_revision.sql):
--   - guardar_comprobante_compra bloquea los remitos de los renglones en
--     orden de id antes de insertarlos (sin deadlock con
--     facturar_remitos_compra), y lo pendiente queda bien aunque los
--     renglones vengan en orden inverso.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000009a1', 'test-ccr-m', 'Metro de prueba correcciones', 'LONGITUD');

insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000009b1', 'TEST-CCR-MP-1', 'Soga CCR',
   '00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-0000000009a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000009c1', 'Proveedor correcciones 1');

insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, unidad, factor_conversion, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009c1',
   'SG-CCR', 'SOGA CCR', 'm', 1, '00000000-0000-4000-8000-0000000009b1');

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

create function pg_temp.remito(p_numero bigint, p_cantidad numeric) returns uuid language sql as $$
  select guardar_remito_compra(null,
    jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000009c1', 'punto_venta', 9,
      'numero', p_numero, 'fecha', '2026-11-01'),
    jsonb_build_array(jsonb_build_object(
      'proveedor_articulo_id', '00000000-0000-4000-8000-0000000009d1', 'cantidad', p_cantidad)));
$$;

create function pg_temp.pendiente(p_remito text) returns numeric language sql as $$
  select p.pendiente
  from v_remito_compra_item_pendiente p
  join remito_compra_item ri on ri.id = p.remito_compra_item_id
  where ri.remito_compra_id = pg_temp.id(p_remito);
$$;

-- Renglón de factura que factura p_cantidad del renglón del remito.
create function pg_temp.renglon(p_remito text, p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'proveedor_articulo_id', '00000000-0000-4000-8000-0000000009d1',
    'cantidad', p_cantidad, 'precio_unitario', 10, 'alicuota_iva', 21,
    'remito_compra_item_id', (select ri.id from remito_compra_item ri where ri.remito_compra_id = pg_temp.id(p_remito)));
$$;

insert into x values ('R1', pg_temp.remito(901, 10));
insert into x values ('R2', pg_temp.remito(902, 10));
select recibir_remito_compra(pg_temp.id(r)) from unnest(array['R1', 'R2']) r;

-- Alto y bajo: el remito de id mayor y el de id menor.
insert into x
select 'alto', id from remito_compra where id in (pg_temp.id('R1'), pg_temp.id('R2')) order by id desc limit 1;
insert into x
select 'bajo', id from remito_compra where id in (pg_temp.id('R1'), pg_temp.id('R2')) order by id limit 1;

-- ---------------------------------------------------------------------
-- Deadlock: guardar_comprobante_compra bloquea los remitos por id
-- ---------------------------------------------------------------------

select ok(
  pg_get_functiondef('public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb)'::regprocedure)
    ~ 'from public\.remito_compra r\s+where r\.id in \(.*\)\s+order by r\.id\s+for update',
  'guardar_comprobante_compra bloquea los remitos de los renglones en orden de id'
);

-- Renglones en orden inverso al id de los remitos.
select lives_ok(
  $$ insert into x values ('F', guardar_comprobante_compra(null,
       jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000009c1', 'tipo', 'factura',
         'letra', 'A', 'punto_venta', 4, 'numero', 901, 'fecha', '2026-11-03'),
       jsonb_build_array(pg_temp.renglon('alto', 3), pg_temp.renglon('bajo', 4)),
       '[]'::jsonb)) $$,
  'Una factura con renglones de dos remitos en orden inverso al id se guarda'
);
select is(pg_temp.pendiente('alto'), 7.0000, 'Del remito de id mayor quedan 7 pendientes');
select is(pg_temp.pendiente('bajo'), 6.0000, 'Del remito de id menor quedan 6 pendientes');

-- Al volver a guardarla, reemplaza los renglones (bloquea también los remitos de los anteriores).
select lives_ok(
  $$ select guardar_comprobante_compra(pg_temp.id('F'),
       jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000009c1', 'tipo', 'factura',
         'letra', 'A', 'punto_venta', 4, 'numero', 901, 'fecha', '2026-11-03'),
       jsonb_build_array(pg_temp.renglon('bajo', 10), pg_temp.renglon('alto', 1)),
       '[]'::jsonb) $$,
  'Volver a guardarla con otro orden y otras cantidades funciona'
);
select is(pg_temp.pendiente('alto'), 9.0000, 'Del remito de id mayor quedan 9 pendientes tras reemplazar');
select is(pg_temp.pendiente('bajo'), 0.0000, 'Del remito de id menor no queda nada pendiente tras reemplazar');

select * from finish();
rollback;
