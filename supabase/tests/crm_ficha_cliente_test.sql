-- =====================================================================
-- Tests de la ficha completa del cliente: condición IVA, datos
-- bancarios, transportes, sucursales y contactos ampliados.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', 'transporte', 'Existe la tabla transporte');
select has_table('public', 'cliente_sucursal', 'Existe la tabla cliente_sucursal');
select has_column('public', 'cliente', 'condicion_iva', 'cliente tiene condicion_iva');
select has_column('public', 'cliente', 'transporte_id', 'cliente tiene transporte_id');
select has_column('public', 'cliente_contacto', 'sucursal_id', 'cliente_contacto tiene sucursal_id');
select has_function(
  'public', 'marcar_sucursal_principal', array['uuid'],
  'Existe marcar_sucursal_principal(uuid)'
);

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into transporte (nombre) values ('Transporte de prueba'), ('Transporte libre');
insert into cliente (razon_social) values ('Cliente CRM'), ('Otro cliente CRM');

-- ---------------------------------------------------------------------
-- Restricciones de cliente
-- ---------------------------------------------------------------------

select lives_ok(
  $$ update cliente set condicion_iva = 'Responsable Inscripto' where razon_social = 'Cliente CRM' $$,
  'Acepta una condición IVA del catálogo'
);
select throws_ok(
  $$ update cliente set condicion_iva = 'Inventada' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza una condición IVA fuera del catálogo'
);
select lives_ok(
  $$ update cliente set cbu = '0110599520000001234567', cvu = '0000003100000000000000'
      where razon_social = 'Cliente CRM' $$,
  'Acepta CBU y CVU de 22 dígitos'
);
select throws_ok(
  $$ update cliente set cbu = '011059952000000123456' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un CBU de 21 dígitos'
);
select throws_ok(
  $$ update cliente set cbu = '01105995200000012345AB' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un CBU con letras'
);
select throws_ok(
  $$ update cliente set cvu = '00000031000000000000000' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un CVU de 23 dígitos'
);
select lives_ok(
  $$ update cliente set alias_bancario = 'silfe.cosecha-01' where razon_social = 'Cliente CRM' $$,
  'Acepta un alias con letras, números, punto y guion'
);
select throws_ok(
  $$ update cliente set alias_bancario = 'silfe cosecha' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un alias con espacios'
);
select throws_ok(
  $$ update cliente set alias_bancario = 'corto' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un alias de menos de 6 caracteres'
);
select throws_ok(
  $$ update cliente set alias_bancario = 'unaliasdemasiadolargo' where razon_social = 'Cliente CRM' $$,
  '23514', null,
  'Rechaza un alias de más de 20 caracteres'
);

-- ---------------------------------------------------------------------
-- Sucursales: una sola principal por cliente
-- ---------------------------------------------------------------------

insert into cliente_sucursal (cliente_id, nombre, principal)
select id, 'Casa central', true from cliente where razon_social = 'Cliente CRM';
insert into cliente_sucursal (cliente_id, nombre)
select id, 'Depósito' from cliente where razon_social = 'Cliente CRM';

select is(
  (select recibe_entregas from cliente_sucursal where nombre = 'Casa central'),
  true,
  'Una sucursal recibe entregas por defecto'
);
select throws_ok(
  $$ update cliente_sucursal set principal = true where nombre = 'Depósito' $$,
  '23505', null,
  'No puede haber dos sucursales principales para el mismo cliente'
);
select lives_ok(
  $$ insert into cliente_sucursal (cliente_id, nombre, principal)
     select id, 'Principal del otro', true from cliente where razon_social = 'Otro cliente CRM' $$,
  'Otro cliente puede tener su propia sucursal principal'
);

select lives_ok(
  $$ select marcar_sucursal_principal((select id from cliente_sucursal where nombre = 'Depósito')) $$,
  'marcar_sucursal_principal cambia la principal sin violar el índice'
);
select results_eq(
  $$ select nombre from cliente_sucursal
      where principal and cliente_id = (select id from cliente where razon_social = 'Cliente CRM') $$,
  $$ values ('Depósito'::text) $$,
  'La nueva principal es la única del cliente'
);
select is(
  (select principal from cliente_sucursal where nombre = 'Principal del otro'),
  true,
  'Marcar la principal de un cliente no toca las de otro'
);

-- ---------------------------------------------------------------------
-- Transporte en uso: no se puede borrar
-- ---------------------------------------------------------------------

update cliente set transporte_id = (select id from transporte where nombre = 'Transporte de prueba')
 where razon_social = 'Cliente CRM';

select throws_ok(
  $$ delete from transporte where nombre = 'Transporte de prueba' $$,
  '23503', null,
  'No se puede borrar un transporte asignado a un cliente'
);

update cliente set transporte_id = null where razon_social = 'Cliente CRM';
update cliente_sucursal
   set transporte_id = (select id from transporte where nombre = 'Transporte de prueba')
 where nombre = 'Casa central';

select throws_ok(
  $$ delete from transporte where nombre = 'Transporte de prueba' $$,
  '23503', null,
  'No se puede borrar un transporte asignado a una sucursal'
);
select lives_ok(
  $$ delete from transporte where nombre = 'Transporte libre' $$,
  'Se puede borrar un transporte sin uso'
);

-- ---------------------------------------------------------------------
-- Contactos
-- ---------------------------------------------------------------------

insert into cliente_contacto (cliente_id, nombre, email, whatsapp, sucursal_id)
select c.id, 'Contacto de casa central', 'compras@ejemplo.com', '+54 9 299 000-0000', s.id
from cliente c join cliente_sucursal s on s.cliente_id = c.id
where c.razon_social = 'Cliente CRM' and s.nombre = 'Casa central';

select throws_ok(
  $$ update cliente_contacto set email = 'sin-arroba' where nombre = 'Contacto de casa central' $$,
  '23514', null,
  'Rechaza un email sin arroba'
);

select throws_ok(
  $$ update cliente_contacto
        set sucursal_id = (select id from cliente_sucursal where nombre = 'Principal del otro')
      where nombre = 'Contacto de casa central' $$,
  '23503', null,
  'Un contacto no puede apuntar a una sucursal de otro cliente'
);

delete from cliente_sucursal where nombre = 'Casa central';

select ok(
  (select sucursal_id is null from cliente_contacto where nombre = 'Contacto de casa central'),
  'Borrar una sucursal deja a sus contactos sin sucursal'
);

delete from cliente where razon_social = 'Cliente CRM';

select is(
  (select count(*) from cliente_sucursal where nombre = 'Depósito'),
  0::bigint,
  'Borrar el cliente borra sus sucursales'
);
select is(
  (select count(*) from cliente_contacto where nombre = 'Contacto de casa central'),
  0::bigint,
  'Borrar el cliente borra sus contactos'
);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t,
    'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['transporte', 'cliente_sucursal']) as t;

select ok(
  not has_function_privilege('anon', 'public.marcar_sucursal_principal(uuid)', 'execute'),
  'anon no puede ejecutar marcar_sucursal_principal'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);

select lives_ok(
  $$
    with t as (insert into transporte (nombre) values ('Transporte autenticado') returning id),
         c as (insert into cliente (razon_social, transporte_id)
               select 'Cliente autenticado', id from t returning id)
    insert into cliente_sucursal (cliente_id, nombre, principal)
    select id, 'Sucursal autenticada', true from c
  $$,
  'authenticated puede crear transportes, clientes y sucursales'
);
select is(
  (select count(*) from cliente_sucursal where nombre = 'Sucursal autenticada'),
  1::bigint,
  'authenticated puede leer sucursales'
);
select lives_ok(
  $$
    update cliente_sucursal set telefono = '123' where nombre = 'Sucursal autenticada';
    update transporte set telefono = '456' where nombre = 'Transporte autenticado';
    delete from cliente_sucursal where nombre = 'Sucursal autenticada';
    delete from cliente where razon_social = 'Cliente autenticado';
    delete from transporte where nombre = 'Transporte autenticado';
  $$,
  'authenticated puede editar y borrar transportes y sucursales'
);

reset role;

select * from finish();
rollback;
