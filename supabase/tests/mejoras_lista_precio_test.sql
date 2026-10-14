-- =====================================================================
-- Tests de la pasada de mejoras de listas de precios:
--   - un producto usado en una lista guardada no se puede borrar;
--   - crear_lista_precio rechaza precios NaN o infinitos y un precio
--     sugerido negativo, y conserva security definer, search_path y
--     permisos.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into producto (codigo, nombre, tipo, unidad_id)
select x.codigo, x.nombre, 'TERMINADO', (select id from unidad_medida where codigo = 'u')
from (values
  ('ZM-001', 'Producto en una lista'),
  ('ZM-002', 'Producto sin listas')
) as x(codigo, nombre);

select crear_lista_precio(
  'Lista con producto', null, null,
  jsonb_build_array(jsonb_build_object(
    'producto_id', (select id from producto where codigo = 'ZM-001'),
    'codigo', 'ZM-001',
    'descripcion', 'Producto en una lista',
    'precio_sugerido', 100,
    'precio_final', 100
  ))
);

-- ---------------------------------------------------------------------
-- Borrado de productos usados en listas
-- ---------------------------------------------------------------------

select ok(
  (select pg_get_constraintdef(oid) like '%ON DELETE RESTRICT%'
     from pg_constraint where conname = 'lista_precio_item_producto_id_fkey'),
  'La FK lista_precio_item.producto_id es on delete restrict'
);

select throws_ok(
  $$ delete from producto where codigo = 'ZM-001' $$,
  '23503', null,
  'No se puede borrar un producto usado en una lista guardada'
);

select is(
  (select i.producto_id from lista_precio_item i
     join lista_precio l on l.id = i.lista_id
    where l.nombre = 'Lista con producto'),
  (select id from producto where codigo = 'ZM-001'),
  'El ítem de la lista conserva su producto'
);

select lives_ok(
  $$ delete from producto where codigo = 'ZM-002' $$,
  'Un producto que no está en ninguna lista se puede borrar'
);

select is(
  (select count(*) from producto where codigo = 'ZM-002'),
  0::bigint,
  'El producto sin listas se borró'
);

-- ---------------------------------------------------------------------
-- Precios no numéricos o infinitos
-- ---------------------------------------------------------------------

select throws_like(
  $$ select crear_lista_precio('NaN final', null, null,
       '[{"descripcion": "A", "precio_final": "NaN"}]'::jsonb) $$,
  '%precio final%',
  'Rechaza un precio final NaN'
);

select throws_like(
  $$ select crear_lista_precio('Infinito final', null, null,
       '[{"descripcion": "A", "precio_final": "Infinity"}]'::jsonb) $$,
  '%precio final%',
  'Rechaza un precio final infinito'
);

select throws_like(
  $$ select crear_lista_precio('NaN sugerido', null, null,
       '[{"descripcion": "A", "precio_final": 1, "precio_sugerido": "NaN"}]'::jsonb) $$,
  '%precio sugerido%',
  'Rechaza un precio sugerido NaN'
);

select throws_like(
  $$ select crear_lista_precio('Infinito sugerido', null, null,
       '[{"descripcion": "A", "precio_final": 1, "precio_sugerido": "-Infinity"}]'::jsonb) $$,
  '%precio sugerido%',
  'Rechaza un precio sugerido infinito'
);

select throws_like(
  $$ select crear_lista_precio('Sugerido negativo', null, null,
       '[{"descripcion": "A", "precio_final": 1, "precio_sugerido": -5}]'::jsonb) $$,
  '%precio sugerido%',
  'Rechaza un precio sugerido negativo'
);

select lives_ok(
  $$ select crear_lista_precio('Sugerido nulo', null, null,
       '[{"descripcion": "A", "precio_final": 1, "precio_sugerido": null}]'::jsonb) $$,
  'Acepta un precio sugerido nulo (ítem manual)'
);

-- ---------------------------------------------------------------------
-- La función conserva su configuración
-- ---------------------------------------------------------------------

select ok(
  (select prosecdef from pg_proc
    where oid = 'public.crear_lista_precio(text, text, text, jsonb)'::regprocedure),
  'crear_lista_precio sigue siendo security definer'
);

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.crear_lista_precio(text, text, text, jsonb)'::regprocedure),
  'crear_lista_precio sigue con search_path vacío'
);

select ok(
  has_function_privilege('authenticated', 'public.crear_lista_precio(text, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.crear_lista_precio(text, text, text, jsonb)', 'execute'),
  'crear_lista_precio la ejecuta authenticated y no anon'
);

select * from finish();
rollback;
