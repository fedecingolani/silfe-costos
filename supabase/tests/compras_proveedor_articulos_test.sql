-- =====================================================================
-- Tests de los datos fiscales del proveedor (condición frente al IVA,
-- domicilio, CBU y alias) y del catálogo de artículos del proveedor.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ----- Datos de prueba ---------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000000a1', 'test-kg', 'Kilo de prueba', 'MASA');

insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000000b1', 'TEST-MP-1', 'Soga de prueba',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000000c1', 'Proveedor de prueba 1'),
  ('00000000-0000-4000-8000-0000000000c2', 'Proveedor de prueba 2');

-- ----- Proveedor: estructura ---------------------------------------------

select has_column('public', 'proveedor', c, format('proveedor tiene %s', c))
from unnest(array['condicion_iva', 'domicilio', 'cbu', 'alias']) as c;

select col_is_null('public', 'proveedor', c, format('%s es opcional', c))
from unnest(array['condicion_iva', 'domicilio', 'cbu', 'alias']) as c;

-- ----- Proveedor: restricciones ------------------------------------------

select lives_ok(
  $$update proveedor set condicion_iva = 'Responsable Inscripto', domicilio = 'Ruta 40 km 3',
      cbu = '0110599520000001234567', alias = 'SOGAS.ANDINAS-1'
    where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'Se guardan condición IVA, domicilio, CBU y alias válidos'
);
-- Paridad con CONDICIONES_IVA de src/lib/tipos.ts: la base acepta las cuatro.
select lives_ok(
  format('update proveedor set condicion_iva = %L where id = %L', c, '00000000-0000-4000-8000-0000000000c2'),
  format('Se acepta la condición frente al IVA %s', c)
)
from unnest(array['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final']) as c;
select throws_ok(
  $$update proveedor set condicion_iva = 'Inscripto' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'La condición frente al IVA tiene que ser una de las conocidas'
);
select throws_ok(
  $$update proveedor set cbu = '011059952000000123456' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'El CBU tiene 22 dígitos'
);
select throws_ok(
  $$update proveedor set cbu = '0110 599520000001234567' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'El CBU sólo tiene dígitos'
);
select throws_ok(
  $$update proveedor set alias = 'corto' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'El alias tiene al menos 6 caracteres'
);
select throws_ok(
  $$update proveedor set alias = repeat('a', 21) where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'El alias tiene hasta 20 caracteres'
);
select throws_ok(
  $$update proveedor set alias = 'sogas andinas' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'El alias sólo tiene letras, números, puntos y guiones'
);

-- ----- Artículo del proveedor: estructura --------------------------------

select has_table('public', 'proveedor_articulo', 'Existe proveedor_articulo');
select columns_are('public', 'proveedor_articulo', array[
  'id', 'proveedor_id', 'codigo', 'descripcion', 'unidad', 'factor_conversion',
  'materia_prima_id', 'activo', 'creado_en', 'actualizado_en'
], 'proveedor_articulo tiene las columnas esperadas');
select col_not_null('public', 'proveedor_articulo', 'descripcion', 'La descripción es obligatoria');
select col_is_null('public', 'proveedor_articulo', 'materia_prima_id', 'La materia prima es opcional');
select col_default_is('public', 'proveedor_articulo', 'factor_conversion', '1', 'El factor es 1 a 1 por defecto');
select col_default_is('public', 'proveedor_articulo', 'activo', 'true', 'Un artículo nace activo');
select has_index('public', 'proveedor_articulo', 'proveedor_articulo_materia_prima_idx',
  'Índice por materia prima');
select has_trigger('public', 'proveedor_articulo', 'trg_proveedor_articulo_actualizado',
  'proveedor_articulo actualiza actualizado_en');

-- ----- Artículo del proveedor: alta y factor ------------------------------

insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, unidad, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1',
   'SG-8', 'SOGA PP diam 8MM', 'rollo', '00000000-0000-4000-8000-0000000000b1');

-- actualizado_en: el alta lo deja en el pasado y una modificación lo renueva.
insert into proveedor_articulo (id, proveedor_id, descripcion, actualizado_en) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1',
   'Artículo viejo', '2000-01-01 00:00:00+00');
update proveedor_articulo set unidad = 'caja' where id = '00000000-0000-4000-8000-0000000000d2';
select ok(
  (select actualizado_en > '2000-01-01 00:00:00+00'::timestamptz
   from proveedor_articulo where id = '00000000-0000-4000-8000-0000000000d2'),
  'Modificar un artículo renueva actualizado_en'
);

select is(
  (select factor_conversion from proveedor_articulo where id = '00000000-0000-4000-8000-0000000000d1'),
  1::numeric,
  'Sin factor, el artículo queda 1 a 1'
);
select throws_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion, factor_conversion)
    values ('00000000-0000-4000-8000-0000000000c1', 'Cero', 0)$$,
  '23514', null, 'El factor tiene que ser mayor que cero'
);
select throws_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion, factor_conversion)
    values ('00000000-0000-4000-8000-0000000000c1', 'Negativo', -2)$$,
  '23514', null, 'El factor no puede ser negativo'
);
select throws_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion) values ('00000000-0000-4000-8000-0000000000c1', '   ')$$,
  '23514', null, 'La descripción no puede estar en blanco'
);
select lives_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion) values ('00000000-0000-4000-8000-0000000000c1', 'Flete')$$,
  'Un artículo puede no tener materia prima (fletes, servicios)'
);

-- ----- Unicidad por proveedor --------------------------------------------

select throws_ok(
  $$insert into proveedor_articulo (proveedor_id, codigo, descripcion)
    values ('00000000-0000-4000-8000-0000000000c1', ' sg-8 ', 'Otra descripción')$$,
  '23505', null, 'El código no se repite en el mismo proveedor (sin importar mayúsculas ni espacios)'
);
select lives_ok(
  $$insert into proveedor_articulo (proveedor_id, codigo, descripcion)
    values ('00000000-0000-4000-8000-0000000000c2', 'SG-8', 'SOGA PP diam 8MM')$$,
  'Otro proveedor puede usar el mismo código'
);
select lives_ok(
  $$insert into proveedor_articulo (proveedor_id, codigo, descripcion)
    values ('00000000-0000-4000-8000-0000000000c1', 'SG-10', 'SOGA PP diam 8MM')$$,
  'Con código distinto, la descripción se puede repetir'
);
select throws_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion)
    values ('00000000-0000-4000-8000-0000000000c1', '  flete ')$$,
  '23505', null, 'Sin código, la descripción no se repite en el mismo proveedor'
);
select lives_ok(
  $$insert into proveedor_articulo (proveedor_id, descripcion)
    values ('00000000-0000-4000-8000-0000000000c2', 'Flete')$$,
  'Otro proveedor puede tener la misma descripción sin código'
);

-- ----- Claves foráneas ---------------------------------------------------

select throws_ok(
  $$delete from materia_prima where id = '00000000-0000-4000-8000-0000000000b1'$$,
  '23503', null, 'No se borra una materia prima asociada a un artículo del proveedor'
);

delete from proveedor where id = '00000000-0000-4000-8000-0000000000c2';
select is(
  (select count(*)::int from proveedor_articulo where proveedor_id = '00000000-0000-4000-8000-0000000000c2'),
  0,
  'Al borrar el proveedor se borran sus artículos'
);

-- ----- Permisos ----------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.proveedor_articulo'::regclass),
  'proveedor_articulo tiene RLS habilitada'
);
select ok(
  not has_table_privilege('anon', 'public.proveedor_articulo', 'select, insert, update, delete'),
  'anon no tiene privilegios sobre proveedor_articulo'
);
select ok(
  has_table_privilege('authenticated', 'public.proveedor_articulo', 'select, insert, update, delete'),
  'authenticated puede leer y escribir proveedor_articulo'
);

select * from finish();
rollback;
