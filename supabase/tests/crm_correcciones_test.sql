-- =====================================================================
-- Tests de las correcciones de la ficha del cliente (Fase 6, CRM):
-- búsqueda por CUIT en cualquier formato, alta y edición atómica de
-- sucursales (guardar_sucursal) y marcar_sucursal_principal serializada
-- por cliente. Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------------
-- CUIT normalizado a dígitos
-- ---------------------------------------------------------------------

select has_column('public', 'cliente', 'cuit_digitos', 'cliente tiene cuit_digitos');
select has_index('public', 'cliente', 'cliente_cuit_digitos_idx', 'cuit_digitos tiene índice');

insert into cliente (razon_social, cuit) values
  ('CUIT con guiones', '20-12345678-9'),
  ('CUIT sin guiones', '27123456784'),
  ('CUIT vacío', '--'),
  ('Sin CUIT', null);

select is(
  (select cuit_digitos from cliente where razon_social = 'CUIT con guiones'),
  '20123456789',
  'cuit_digitos guarda sólo los dígitos del CUIT'
);
select is(
  (select cuit_digitos from cliente where razon_social = 'CUIT vacío'),
  null,
  'Un CUIT sin dígitos deja cuit_digitos vacío'
);
select is(
  (select cuit_digitos from cliente where razon_social = 'Sin CUIT'),
  null,
  'Sin CUIT, cuit_digitos queda vacío'
);
select results_eq(
  $$ select razon_social from cliente where cuit_digitos ilike '%20123456789%' $$,
  $$ values ('CUIT con guiones'::text) $$,
  'Buscar "20123456789" encuentra el CUIT cargado como 20-12345678-9'
);
select results_eq(
  -- Los dígitos de "27-12345678-4", como los arma filtroBusquedaClientes.
  $$ select razon_social from cliente
      where cuit_digitos ilike '%' || regexp_replace('27-12345678-4', '\D', '', 'g') || '%' $$,
  $$ values ('CUIT sin guiones'::text) $$,
  'Buscar "27-12345678-4" encuentra el CUIT cargado sin guiones'
);
select throws_ok(
  $$ update cliente set cuit_digitos = '1' where razon_social = 'Sin CUIT' $$,
  '428C9', null,
  'cuit_digitos es una columna generada: no se escribe a mano'
);

-- ---------------------------------------------------------------------
-- Estructura y permisos de las funciones
-- ---------------------------------------------------------------------

select has_function(
  'public', 'guardar_sucursal', array['uuid', 'uuid', 'jsonb'],
  'Existe guardar_sucursal(uuid, uuid, jsonb)'
);
select ok(
  not has_function_privilege('anon', 'public.guardar_sucursal(uuid, uuid, jsonb)', 'execute'),
  'anon no puede ejecutar guardar_sucursal'
);
select ok(
  has_function_privilege('authenticated', 'public.guardar_sucursal(uuid, uuid, jsonb)', 'execute'),
  'authenticated puede ejecutar guardar_sucursal'
);
select ok(
  not has_function_privilege('anon', 'public.marcar_sucursal_principal(uuid)', 'execute'),
  'anon sigue sin poder ejecutar marcar_sucursal_principal'
);
select ok(
  has_function_privilege('authenticated', 'public.marcar_sucursal_principal(uuid)', 'execute'),
  'authenticated sigue pudiendo ejecutar marcar_sucursal_principal'
);
select is(
  (select proconfig from pg_proc where oid = 'public.guardar_sucursal(uuid, uuid, jsonb)'::regprocedure),
  array['search_path=""'],
  'guardar_sucursal fija search_path vacío'
);
select is(
  (select proconfig from pg_proc where oid = 'public.marcar_sucursal_principal(uuid)'::regprocedure),
  array['search_path=""'],
  'marcar_sucursal_principal sigue con search_path vacío'
);
-- La concurrencia no se puede probar en una sola sesión: se controla que
-- las dos funciones bloqueen la fila del cliente antes de tocar la principal.
select ok(
  pg_get_functiondef('public.guardar_sucursal(uuid, uuid, jsonb)'::regprocedure) ~* 'from public\.cliente\s+where id = \S+\s+for update',
  'guardar_sucursal bloquea la fila del cliente'
);
select ok(
  pg_get_functiondef('public.marcar_sucursal_principal(uuid)'::regprocedure) ~* 'from public\.cliente\s+where id = \S+\s+for update',
  'marcar_sucursal_principal bloquea la fila del cliente'
);

-- ---------------------------------------------------------------------
-- guardar_sucursal, como usuario autenticado
-- ---------------------------------------------------------------------

insert into transporte (nombre) values ('Transporte correcciones');
insert into cliente (razon_social) values ('Cliente correcciones'), ('Otro cliente correcciones');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);

select isnt(
  public.guardar_sucursal(
    null,
    (select id from public.cliente where razon_social = 'Cliente correcciones'),
    jsonb_build_object(
      'nombre', 'Casa central', 'localidad', 'Neuquén', 'principal', true,
      'transporte_id', (select id from public.transporte where nombre = 'Transporte correcciones')
    )
  ),
  null,
  'guardar_sucursal da de alta una sucursal y devuelve su id'
);
select results_eq(
  $$ select localidad, principal, recibe_entregas, orden, transporte_id is not null
       from public.cliente_sucursal where nombre = 'Casa central' $$,
  $$ values ('Neuquén'::text, true, true, 0, true) $$,
  'El alta guarda los datos, marca la principal y usa los valores por defecto'
);

select lives_ok(
  $$ select public.guardar_sucursal(
       null,
       (select id from public.cliente where razon_social = 'Cliente correcciones'),
       '{"nombre": "Depósito", "principal": true, "recibe_entregas": false, "orden": 2}'
     ) $$,
  'Dar de alta otra sucursal principal no viola el índice único'
);
select results_eq(
  $$ select nombre from public.cliente_sucursal
      where principal
        and cliente_id = (select id from public.cliente where razon_social = 'Cliente correcciones') $$,
  $$ values ('Depósito'::text) $$,
  'La nueva sucursal principal desmarca la anterior'
);

select lives_ok(
  $$ select public.guardar_sucursal(
       (select id from public.cliente_sucursal where nombre = 'Casa central'),
       (select id from public.cliente where razon_social = 'Cliente correcciones'),
       '{"nombre": "Casa central", "telefono": "299 444-5555", "principal": true}'
     ) $$,
  'Editar una sucursal y marcarla principal'
);
select results_eq(
  $$ select nombre, telefono, localidad, transporte_id is null from public.cliente_sucursal
      where principal
        and cliente_id = (select id from public.cliente where razon_social = 'Cliente correcciones') $$,
  $$ values ('Casa central'::text, '299 444-5555'::text, null::text, true) $$,
  'La edición reemplaza los datos y deja una sola principal'
);

select lives_ok(
  $$ select public.guardar_sucursal(
       (select id from public.cliente_sucursal where nombre = 'Casa central'),
       (select id from public.cliente where razon_social = 'Cliente correcciones'),
       '{"nombre": "Casa central", "principal": false}'
     ) $$,
  'Editar una sucursal y desmarcarla como principal'
);
select is(
  (select count(*) from public.cliente_sucursal
    where principal
      and cliente_id = (select id from public.cliente where razon_social = 'Cliente correcciones')),
  0::bigint,
  'Desmarcarla deja al cliente sin principal'
);

-- Un error a mitad de camino no deja nada a medias.
do $$
begin
  perform public.guardar_sucursal(
    (select id from public.cliente_sucursal where nombre = 'Depósito'),
    (select id from public.cliente where razon_social = 'Cliente correcciones'),
    '{"nombre": "Depósito", "principal": true}'
  );
end;
$$;

select throws_ok(
  $$ select public.guardar_sucursal(
       null,
       (select id from public.cliente where razon_social = 'Cliente correcciones'),
       '{"principal": true}'
     ) $$,
  '23502', null,
  'Una sucursal sin nombre se rechaza'
);
select throws_ok(
  $$ select public.guardar_sucursal(
       null,
       (select id from public.cliente where razon_social = 'Cliente correcciones'),
       '{"nombre": "Con transporte inexistente", "principal": true,
         "transporte_id": "00000000-0000-0000-0000-000000000000"}'
     ) $$,
  '23503', null,
  'Una sucursal con un transporte inexistente se rechaza'
);
select results_eq(
  $$ select nombre, principal from public.cliente_sucursal
      where cliente_id = (select id from public.cliente where razon_social = 'Cliente correcciones')
      order by nombre $$,
  $$ values ('Casa central'::text, false), ('Depósito'::text, true) $$,
  'Si el alta falla, la principal anterior sigue marcada y no queda nada a medias'
);

select throws_ok(
  $$ select public.guardar_sucursal(
       null, '00000000-0000-0000-0000-000000000000', '{"nombre": "Huérfana"}'
     ) $$,
  'P0002', null,
  'guardar_sucursal avisa si el cliente no existe'
);
select throws_ok(
  $$ select public.guardar_sucursal(
       (select id from public.cliente_sucursal where nombre = 'Depósito'),
       (select id from public.cliente where razon_social = 'Otro cliente correcciones'),
       '{"nombre": "Robada"}'
     ) $$,
  'P0002', null,
  'guardar_sucursal no edita una sucursal de otro cliente'
);

-- ---------------------------------------------------------------------
-- marcar_sucursal_principal, como usuario autenticado
-- ---------------------------------------------------------------------

select lives_ok(
  $$ select public.marcar_sucursal_principal(
       (select id from public.cliente_sucursal where nombre = 'Casa central')
     ) $$,
  'authenticated puede marcar la sucursal principal'
);
select results_eq(
  $$ select nombre from public.cliente_sucursal
      where principal
        and cliente_id = (select id from public.cliente where razon_social = 'Cliente correcciones') $$,
  $$ values ('Casa central'::text) $$,
  'marcar_sucursal_principal deja una sola principal'
);
select throws_ok(
  $$ select public.marcar_sucursal_principal('00000000-0000-0000-0000-000000000000') $$,
  'P0002',
  'No existe la sucursal 00000000-0000-0000-0000-000000000000',
  'marcar_sucursal_principal avisa con claridad si la sucursal no existe'
);

reset role;

select * from finish();
rollback;
