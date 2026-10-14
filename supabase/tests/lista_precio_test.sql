-- =====================================================================
-- Tests de lista_precio, lista_precio_item y crear_lista_precio:
-- guardado atómico, ítems manuales, foto de los datos e inmutabilidad.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Producto de referencia para los ítems de producto.
insert into producto (codigo, nombre, tipo, unidad_id)
select 'ZP-001', 'Producto de lista', 'TERMINADO', id
from unidad_medida where codigo = 'u';

-- Usuario autenticado simulado (auth.uid() lee el claim "sub").
select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', 'lista_precio', 'Existe la tabla lista_precio');
select has_table('public', 'lista_precio_item', 'Existe la tabla lista_precio_item');
select has_function(
  'public', 'crear_lista_precio', array['text', 'text', 'text', 'jsonb'],
  'Existe crear_lista_precio(text, text, text, jsonb)'
);

-- ---------------------------------------------------------------------
-- Guardado de una lista como usuario autenticado
-- ---------------------------------------------------------------------

set local role authenticated;

select isnt(
  crear_lista_precio(
    'Diciembre 2023',
    'LISTA DE PRECIOS DICIEMBRE 2023',
    'Precios sin IVA',
    jsonb_build_array(
      jsonb_build_object(
        'es_repuesto', false,
        'producto_id', (select id from producto where codigo = 'ZP-001'),
        'codigo', 'ZP-001',
        'descripcion', 'Producto de lista (editado)',
        'presentacion', 'Unidad',
        'alicuota_iva', 10.5,
        'precio_sugerido', 1234.56,
        'precio_final', 1300
      ),
      jsonb_build_object(
        'descripcion', 'Flete a cargo del cliente',
        'precio_final', 0
      )
    )
  ),
  null,
  'crear_lista_precio devuelve el id de la lista'
);

reset role;

select is(
  (select count(*) from lista_precio where nombre = 'Diciembre 2023'),
  1::bigint,
  'Se guardó la lista'
);

select results_eq(
  $$
    select l.titulo, l.notas, l.creado_por
    from lista_precio l where l.nombre = 'Diciembre 2023'
  $$,
  $$
    values ('LISTA DE PRECIOS DICIEMBRE 2023', 'Precios sin IVA',
            '11111111-1111-1111-1111-111111111111'::uuid)
  $$,
  'La lista guarda título, notas y el usuario creador'
);

select ok(
  (select creado_en is not null from lista_precio where nombre = 'Diciembre 2023'),
  'La lista guarda la fecha de creación'
);

select is(
  (select count(*) from lista_precio_item i
     join lista_precio l on l.id = i.lista_id
    where l.nombre = 'Diciembre 2023'),
  2::bigint,
  'Se guardaron todos los ítems'
);

select results_eq(
  $$
    select i.orden, i.es_repuesto, i.producto_id, i.codigo, i.descripcion,
           i.presentacion, i.alicuota_iva, i.precio_sugerido, i.precio_final
    from lista_precio_item i
    join lista_precio l on l.id = i.lista_id
    where l.nombre = 'Diciembre 2023'
    order by i.orden
  $$,
  $$
    values
      (1, false, (select id from producto where codigo = 'ZP-001'), 'ZP-001'::text,
       'Producto de lista (editado)'::text, 'Unidad'::text, 10.5::numeric(5,2),
       1234.56::numeric, 1300::numeric),
      (2, false, null::uuid, null::text,
       'Flete a cargo del cliente'::text, null::text, 21::numeric(5,2),
       null::numeric, 0::numeric)
  $$,
  'Los ítems guardan la foto enviada; el manual queda sin producto e IVA 21 por defecto'
);

-- La foto no cambia si después cambia el producto.
update producto set codigo = 'ZP-999', nombre = 'Otro nombre', alicuota_iva = 21
 where codigo = 'ZP-001';

select results_eq(
  $$
    select i.codigo, i.descripcion, i.alicuota_iva
    from lista_precio_item i
    join lista_precio l on l.id = i.lista_id
    where l.nombre = 'Diciembre 2023' and i.producto_id is not null
  $$,
  $$ values ('ZP-001'::text, 'Producto de lista (editado)'::text, 10.5::numeric(5,2)) $$,
  'El ítem conserva sus datos aunque cambie el producto'
);

select lives_ok(
  $$
    select crear_lista_precio('Con orden explícito', null, null,
      '[{"orden": 20, "descripcion": "B", "precio_final": 1},
        {"orden": 10, "descripcion": "A", "precio_final": 2, "es_repuesto": true}]'::jsonb)
  $$,
  'Acepta un orden explícito en los ítems'
);

select results_eq(
  $$
    select i.orden, i.descripcion, i.es_repuesto
    from lista_precio_item i
    join lista_precio l on l.id = i.lista_id
    where l.nombre = 'Con orden explícito'
    order by i.orden
  $$,
  $$ values (10, 'A'::text, true), (20, 'B'::text, false) $$,
  'Respeta el orden explícito y la marca de repuesto'
);

-- ---------------------------------------------------------------------
-- Atomicidad y validaciones
-- ---------------------------------------------------------------------

select throws_ok(
  $$
    select crear_lista_precio('Lista rota', null, null,
      '[{"descripcion": "Bien", "precio_final": 10},
        {"descripcion": "IVA imposible", "precio_final": 10, "alicuota_iva": 150}]'::jsonb)
  $$,
  '23514', null,
  'Un ítem inválido hace fallar el guardado'
);

select is(
  (select count(*) from lista_precio where nombre = 'Lista rota'),
  0::bigint,
  'Si falla un ítem no queda la lista (todo o nada)'
);

select is(
  (select count(*) from lista_precio_item where descripcion = 'Bien'),
  0::bigint,
  'Si falla un ítem no queda ninguno de los otros ítems'
);

select throws_like(
  $$ select crear_lista_precio('   ', null, null, '[{"descripcion": "A", "precio_final": 1}]'::jsonb) $$,
  '%nombre%',
  'Rechaza un nombre vacío'
);

select throws_like(
  $$ select crear_lista_precio('Vacía', null, null, '[]'::jsonb) $$,
  '%al menos un ítem%',
  'Rechaza una lista sin ítems'
);

select throws_like(
  $$ select crear_lista_precio('Nula', null, null, null) $$,
  '%al menos un ítem%',
  'Rechaza ítems nulos'
);

select throws_like(
  $$ select crear_lista_precio('Sin descripción', null, null, '[{"precio_final": 1}]'::jsonb) $$,
  '%descripción%',
  'Rechaza un ítem sin descripción'
);

select throws_like(
  $$ select crear_lista_precio('Sin precio', null, null, '[{"descripcion": "A"}]'::jsonb) $$,
  '%precio final%',
  'Rechaza un ítem sin precio final'
);

select throws_like(
  $$ select crear_lista_precio('Precio negativo', null, null,
       '[{"descripcion": "A", "precio_final": -1}]'::jsonb) $$,
  '%precio final%',
  'Rechaza un precio final negativo'
);

-- ---------------------------------------------------------------------
-- Inmutabilidad: un usuario autenticado sólo lee
-- ---------------------------------------------------------------------

set local role authenticated;

select ok(
  (select count(*) from lista_precio where nombre = 'Diciembre 2023') = 1,
  'Un usuario autenticado puede leer las listas'
);

select ok(
  (select count(*) from lista_precio_item) > 0,
  'Un usuario autenticado puede leer los ítems'
);

select throws_ok(
  $$ update lista_precio set nombre = 'Cambiada' $$,
  '42501', null,
  'Un usuario autenticado no puede modificar una lista'
);

select throws_ok(
  $$ delete from lista_precio $$,
  '42501', null,
  'Un usuario autenticado no puede borrar una lista'
);

select throws_ok(
  $$ update lista_precio_item set precio_final = 1 $$,
  '42501', null,
  'Un usuario autenticado no puede modificar un ítem'
);

select throws_ok(
  $$ delete from lista_precio_item $$,
  '42501', null,
  'Un usuario autenticado no puede borrar un ítem'
);

select throws_ok(
  $$
    insert into lista_precio_item (lista_id, orden, descripcion, precio_final)
    select id, 99, 'Colado', 1 from lista_precio where nombre = 'Diciembre 2023'
  $$,
  '42501', null,
  'Un usuario autenticado no puede agregar ítems a una lista ya creada'
);

select throws_ok(
  $$ insert into lista_precio (nombre) values ('Directa') $$,
  '42501', null,
  'Un usuario autenticado no puede crear una lista sin la función'
);

reset role;

-- ---------------------------------------------------------------------
-- Los anónimos no ven ni crean listas
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.lista_precio', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.lista_precio_item', 'select, insert, update, delete'),
  'anon no tiene permisos sobre las tablas de listas'
);

select ok(
  not has_function_privilege('anon', 'public.crear_lista_precio(text, text, text, jsonb)', 'execute'),
  'anon no puede ejecutar crear_lista_precio'
);

select * from finish();
rollback;
