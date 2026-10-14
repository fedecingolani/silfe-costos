-- =====================================================================
-- Tests de permisos de anon en las tablas de clientes y contactos:
-- anon no tiene ningún privilegio sobre ellas.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  not has_table_privilege('anon', 'public.' || t,
    'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['cliente', 'cliente_contacto', 'proveedor_contacto', 'zona']) as t;

select * from finish();
rollback;
