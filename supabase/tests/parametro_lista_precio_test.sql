-- =====================================================================
-- Tests del pie de la lista de precios en parametro_costeo: columnas
-- nuevas opcionales, editables por un usuario autenticado e invisibles
-- para los anónimos. Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select has_column('public', 'parametro_costeo', 'lista_texto_destacado', 'Existe lista_texto_destacado');
select has_column('public', 'parametro_costeo', 'lista_contacto', 'Existe lista_contacto');
select col_is_null('public', 'parametro_costeo', 'lista_contacto', 'lista_contacto es opcional');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$update parametro_costeo
    set lista_texto_destacado = 'SIL – FE 30 AÑOS',
        lista_contacto = E'Ventas: 555-1234\nventas@silfe.com.ar'
    where id$$,
  'Un usuario autenticado edita el pie de la lista'
);

select is(
  (select lista_contacto from parametro_costeo),
  E'Ventas: 555-1234\nventas@silfe.com.ar',
  'El contacto conserva los saltos de línea'
);

reset role;
set local role anon;

select throws_ok(
  $$select lista_contacto from parametro_costeo$$,
  '42501',
  null,
  'Un anónimo no lee el pie de la lista'
);

reset role;
select * from finish();
rollback;
