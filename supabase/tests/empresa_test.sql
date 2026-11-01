-- =====================================================================
-- Tests de la identidad de la empresa (fila única): nombre de fantasía,
-- color de marca, contacto y logo en base64.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ----- Estructura --------------------------------------------------------

select has_table('public', 'empresa', 'Existe empresa');

select columns_are('public', 'empresa', array[
  'id', 'nombre_fantasia', 'color_marca', 'telefono', 'email', 'web',
  'logo_base64', 'logo_tipo', 'actualizado_en'
], 'empresa tiene las columnas esperadas');

select col_is_pk('public', 'empresa', 'id', 'empresa tiene clave primaria id');
select col_is_null('public', 'empresa', 'nombre_fantasia', 'El nombre de fantasía es opcional');
select col_is_null('public', 'empresa', 'logo_base64', 'El logo es opcional');
select col_not_null('public', 'empresa', 'actualizado_en', 'actualizado_en es obligatoria');

select is(
  (select count(*)::int from empresa),
  1,
  'empresa viene con su única fila'
);
select ok(
  (select nombre_fantasia is null and color_marca is null and logo_base64 is null from empresa),
  'Una instancia nueva arranca con la empresa vacía'
);

select has_trigger('public', 'empresa', 'trg_empresa_actualizado', 'empresa actualiza actualizado_en');

select throws_ok(
  $$insert into empresa (id) values (true)$$,
  '23505', null, 'No se puede agregar otra fila de empresa'
);
select throws_ok(
  $$insert into empresa (id) values (false)$$,
  '23514', null, 'El id de la empresa sólo puede ser true'
);

-- ----- Restricciones -----------------------------------------------------

select throws_ok(
  $$update empresa set nombre_fantasia = '   ' where id$$,
  '23514', null, 'El nombre de fantasía no puede estar en blanco'
);
select throws_ok(
  $$update empresa set nombre_fantasia = ' Acme ' where id$$,
  '23514', null, 'El nombre de fantasía se guarda sin espacios en los bordes'
);
select throws_ok(
  $$update empresa set nombre_fantasia = repeat('a', 81) where id$$,
  '23514', null, 'El nombre de fantasía tiene hasta 80 caracteres'
);
select lives_ok(
  $$update empresa set nombre_fantasia = repeat('a', 80) where id$$,
  'Un nombre de fantasía de 80 caracteres se acepta'
);

select throws_ok(
  $$update empresa set color_marca = 'red' where id$$,
  '23514', null, 'El color de marca es un hex'
);
select throws_ok(
  $$update empresa set color_marca = '#abc' where id$$,
  '23514', null, 'El color de marca tiene 6 dígitos hex'
);
select lives_ok(
  $$update empresa set color_marca = '#1A7f3C' where id$$,
  'Un color hex de 6 dígitos se acepta'
);

select throws_ok(
  $$update empresa set email = 'sin-arroba.com' where id$$,
  '23514', null, 'El email tiene arroba'
);
select throws_ok(
  $$update empresa set email = 'ventas@empresa' where id$$,
  '23514', null, 'El email tiene dominio con punto'
);
select lives_ok(
  $$update empresa set email = 'ventas@empresa.com.ar' where id$$,
  'Un email válido se acepta'
);

select throws_ok(
  $$update empresa set telefono = repeat('1', 41) where id$$,
  '23514', null, 'El teléfono tiene hasta 40 caracteres'
);
select throws_ok(
  $$update empresa set web = repeat('w', 201) where id$$,
  '23514', null, 'La web tiene hasta 200 caracteres'
);

select throws_ok(
  $$update empresa set logo_tipo = 'image/gif', logo_base64 = 'iVBORw0KGgo=' where id$$,
  '23514', null, 'El logo es PNG o JPEG'
);
select throws_ok(
  $$update empresa set logo_base64 = 'iVBORw0KGgo=' where id$$,
  '23514', null, 'El logo no se guarda sin su tipo'
);
select throws_ok(
  $$update empresa set logo_tipo = 'image/png' where id$$,
  '23514', null, 'El tipo no se guarda sin el logo'
);
select throws_ok(
  $$update empresa set logo_base64 = repeat('A', 700004), logo_tipo = 'image/png' where id$$,
  '23514', null, 'El logo tiene hasta ~500 KB'
);
select lives_ok(
  $$update empresa set logo_base64 = repeat('A', 700000), logo_tipo = 'image/jpeg' where id$$,
  'Un logo en el tope de tamaño se acepta'
);
select lives_ok(
  $$update empresa set logo_base64 = null, logo_tipo = null where id$$,
  'El logo se puede quitar'
);

-- ----- Permisos de un usuario autenticado --------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$update empresa
    set nombre_fantasia = 'Empresa de Prueba', color_marca = '#123456',
        telefono = '+54 299 400-0000', email = 'hola@empresa.test', web = 'https://empresa.test',
        logo_base64 = 'iVBORw0KGgo=', logo_tipo = 'image/png'
    where id$$,
  'Un usuario autenticado edita la empresa'
);
select is(
  (select nombre_fantasia from empresa),
  'Empresa de Prueba',
  'Un usuario autenticado lee la empresa'
);

select throws_ok(
  $$insert into empresa (id) values (true)$$,
  '42501', null, 'Un usuario autenticado no agrega otra fila de empresa'
);

-- authenticated no tiene privilegio de borrado sobre empresa.
select throws_ok(
  $$delete from empresa$$,
  '42501', null, 'Un usuario autenticado no puede borrar la empresa'
);
select is(
  (select count(*)::int from empresa),
  1,
  'Un usuario autenticado no borra la fila de la empresa'
);

reset role;

-- ----- Anónimos ---------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.empresa'::regclass),
  'empresa tiene RLS habilitado'
);
select ok(
  not has_table_privilege('anon', 'public.empresa',
    'select, insert, update, delete, truncate, references, trigger'),
  'anon no tiene privilegios sobre empresa'
);

set local role anon;
select throws_ok(
  $$select nombre_fantasia from empresa$$,
  '42501', null, 'Un anónimo no lee la empresa'
);
reset role;

select * from finish();
rollback;
