-- =====================================================================
-- Tests del seguimiento de clientes (Fase 7, CRM): interacciones, su
-- contacto del mismo cliente, borrados en cascada, la vista
-- v_cliente_seguimiento con el estado calculado contra la fecha de
-- Argentina, y los permisos. Corre con `supabase test db`. Todo se
-- deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(40);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', 'cliente_interaccion', 'Existe cliente_interaccion');
select has_view('public', 'v_cliente_seguimiento', 'Existe v_cliente_seguimiento');
select col_not_null('public', 'cliente_interaccion', 'resumen', 'El resumen es obligatorio');
select col_default_is('public', 'cliente_interaccion', 'sentido', 'SALIENTE', 'El sentido por defecto es saliente');
select col_has_default('public', 'cliente_interaccion', 'fecha', 'La fecha tiene valor por defecto');
select has_index('public', 'cliente_interaccion', 'cliente_interaccion_cliente_fecha_idx', 'Índice por cliente y fecha');
select has_index('public', 'cliente_interaccion', 'cliente_interaccion_proximo_contacto_idx', 'Índice por próximo contacto');
select has_trigger('public', 'cliente_interaccion', 'trg_cliente_interaccion_actualizado', 'actualizado_en se mantiene solo');
select ok(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.v_cliente_seguimiento'::regclass),
  'La vista corre con los permisos de quien consulta (security_invoker)'
);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.cliente_interaccion',
    'select, insert, update, delete, truncate, references, trigger'),
  'anon no tiene privilegios sobre cliente_interaccion'
);
select ok(
  not has_table_privilege('anon', 'public.v_cliente_seguimiento',
    'select, insert, update, delete, truncate, references, trigger'),
  'anon no tiene privilegios sobre v_cliente_seguimiento'
);
select ok(
  has_table_privilege('authenticated', 'public.cliente_interaccion', 'select, insert, update, delete'),
  'authenticated puede leer y escribir interacciones'
);
select ok(
  has_table_privilege('authenticated', 'public.v_cliente_seguimiento', 'select'),
  'authenticated puede leer la vista'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.cliente_interaccion'::regclass),
  'cliente_interaccion tiene RLS habilitada'
);

-- ---------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------

insert into cliente (razon_social) values
  ('Seg atrasado'), ('Seg hoy'), ('Seg próximo'), ('Seg más adelante'),
  ('Seg sin agenda'), ('Seg reemplazo'), ('Seg sin interacciones'), ('Seg otro'),
  ('Seg en 7 días'), ('Seg en 8 días');

insert into cliente_contacto (cliente_id, nombre) values
  ((select id from cliente where razon_social = 'Seg atrasado'), 'Ana atrasado'),
  ((select id from cliente where razon_social = 'Seg otro'), 'Otro contacto');

-- ---------------------------------------------------------------------
-- Como usuario autenticado
-- ---------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}',
  true
);

-- Fecha de hoy en Argentina, la misma que usa la vista.
create temporary table hoy_ar as
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d;

select lives_ok(
  $$ insert into public.cliente_interaccion (cliente_id, contacto_id, tipo, resumen, proximo_contacto, proxima_accion)
     values (
       (select id from public.cliente where razon_social = 'Seg atrasado'),
       (select id from public.cliente_contacto where nombre = 'Ana atrasado'),
       'LLAMADO', 'Pidió presupuesto', (select d - 1 from hoy_ar), 'Mandar presupuesto'
     ) $$,
  'authenticated registra una interacción con un contacto del mismo cliente'
);
select results_eq(
  $$ select sentido, realizado_por, fecha is not null from public.cliente_interaccion
      where resumen = 'Pidió presupuesto' $$,
  $$ values ('SALIENTE'::text, '22222222-2222-2222-2222-222222222222'::uuid, true) $$,
  'Sentido saliente, fecha ahora y realizado_por el usuario de la sesión por defecto'
);

select throws_ok(
  $$ insert into public.cliente_interaccion (cliente_id, contacto_id, tipo, resumen)
     values (
       (select id from public.cliente where razon_social = 'Seg atrasado'),
       (select id from public.cliente_contacto where nombre = 'Otro contacto'),
       'LLAMADO', 'Contacto ajeno'
     ) $$,
  '23503', null,
  'No se puede asociar un contacto de otro cliente'
);
select throws_ok(
  $$ insert into public.cliente_interaccion (cliente_id, tipo, resumen)
     values ((select id from public.cliente where razon_social = 'Seg atrasado'), 'LLAMADO', '   ') $$,
  '23514', null,
  'Un resumen en blanco se rechaza'
);
select throws_ok(
  $$ insert into public.cliente_interaccion (cliente_id, tipo, resumen)
     values ((select id from public.cliente where razon_social = 'Seg atrasado'), 'FAX', 'Tipo raro') $$,
  '23514', null,
  'Un tipo fuera de la lista se rechaza'
);
select throws_ok(
  $$ insert into public.cliente_interaccion (cliente_id, tipo, sentido, resumen)
     values ((select id from public.cliente where razon_social = 'Seg atrasado'), 'LLAMADO', 'LATERAL', 'Sentido raro') $$,
  '23514', null,
  'Un sentido fuera de la lista se rechaza'
);

-- Un caso por estado, con la fecha relativa al día de hoy en Argentina.
insert into public.cliente_interaccion (cliente_id, tipo, sentido, resumen, proximo_contacto, proxima_accion)
select c.id, v.tipo, v.sentido, v.resumen, (select d from hoy_ar) + v.dias, v.accion
from (values
  ('Seg hoy', 'VISITA', 'SALIENTE', 'Visita en planta', 0, 'Llamar hoy'),
  ('Seg próximo', 'WHATSAPP', 'ENTRANTE', 'Consultó por lonas', 3, 'Mandar fotos'),
  ('Seg en 7 días', 'EMAIL', 'SALIENTE', 'Mandé lista', 7, 'Confirmar'),
  ('Seg en 8 días', 'EMAIL', 'SALIENTE', 'Mandé lista', 8, 'Confirmar'),
  ('Seg más adelante', 'OTRO', 'SALIENTE', 'Feria', 30, 'Volver a ver')
) as v(razon, tipo, sentido, resumen, dias, accion)
join public.cliente c on c.razon_social = v.razon;

insert into public.cliente_interaccion (cliente_id, tipo, resumen, proximo_contacto)
values ((select id from public.cliente where razon_social = 'Seg sin agenda'), 'LLAMADO', 'Sin novedades', null);

-- La más reciente reemplaza la agenda de la anterior.
insert into public.cliente_interaccion (cliente_id, tipo, resumen, fecha, proximo_contacto, proxima_accion)
values
  ((select id from public.cliente where razon_social = 'Seg reemplazo'), 'LLAMADO', 'Primera charla',
   now() - interval '2 days', (select d - 1 from hoy_ar), 'Llamar de nuevo'),
  ((select id from public.cliente where razon_social = 'Seg reemplazo'), 'VISITA', 'Cerramos pedido',
   now() - interval '1 day', null, null);

select results_eq(
  $$ select razon_social, estado_seguimiento from public.v_cliente_seguimiento
      where razon_social like 'Seg %' order by razon_social $$,
  $$ values
       ('Seg atrasado'::text, 'atrasado'::text),
       ('Seg en 7 días', 'proximo'),
       ('Seg en 8 días', 'mas_adelante'),
       ('Seg hoy', 'hoy'),
       ('Seg más adelante', 'mas_adelante'),
       ('Seg otro', 'sin_agenda'),
       ('Seg próximo', 'proximo'),
       ('Seg reemplazo', 'sin_agenda'),
       ('Seg sin agenda', 'sin_agenda'),
       ('Seg sin interacciones', 'sin_agenda') $$,
  'El estado se calcula contra la fecha de Argentina, con una fila por cliente'
);
select results_eq(
  $$ select ultima_interaccion_tipo, ultimo_resumen, proximo_contacto, proxima_accion
       from public.v_cliente_seguimiento where razon_social = 'Seg reemplazo' $$,
  $$ values ('VISITA'::text, 'Cerramos pedido'::text, null::date, null::text) $$,
  'La interacción más reciente reemplaza la agenda de la anterior'
);
select results_eq(
  $$ select ultima_interaccion_tipo, ultimo_resumen, proximo_contacto, proxima_accion
       from public.v_cliente_seguimiento where razon_social = 'Seg próximo' $$,
  $$ select 'WHATSAPP'::text, 'Consultó por lonas'::text, d + 3, 'Mandar fotos'::text from hoy_ar $$,
  'La vista trae el último contacto y la próxima acción'
);
select results_eq(
  $$ select ultima_interaccion_fecha is null, activo from public.v_cliente_seguimiento
      where razon_social = 'Seg sin interacciones' $$,
  $$ values (true, true) $$,
  'Un cliente sin interacciones aparece igual, sin último contacto'
);

-- Mismo instante: desempata creado_en (la última cargada manda).
insert into public.cliente_interaccion (cliente_id, tipo, resumen, fecha, creado_en, proximo_contacto)
values
  ((select id from public.cliente where razon_social = 'Seg otro'), 'LLAMADO', 'Empate viejo',
   '2026-01-01 10:00-03', now() - interval '1 minute', null),
  ((select id from public.cliente where razon_social = 'Seg otro'), 'EMAIL', 'Empate nuevo',
   '2026-01-01 10:00-03', now(), (select d + 2 from hoy_ar));
select results_eq(
  $$ select ultimo_resumen, estado_seguimiento from public.v_cliente_seguimiento where razon_social = 'Seg otro' $$,
  $$ values ('Empate nuevo'::text, 'proximo'::text) $$,
  'Con la misma fecha, desempata la cargada más tarde'
);

-- Editar y actualizado_en.
update public.cliente_interaccion
   set actualizado_en = '2000-01-01', resumen = 'Visita en planta'
 where resumen = 'Visita en planta';
select ok(
  (select actualizado_en > '2000-01-02' from public.cliente_interaccion where resumen = 'Visita en planta'),
  'Al editar, actualizado_en se pone al día solo'
);

select lives_ok(
  $$ update public.cliente_interaccion set proximo_contacto = null
      where cliente_id = (select id from public.cliente where razon_social = 'Seg hoy') $$,
  'authenticated edita una interacción'
);
select is(
  (select estado_seguimiento from public.v_cliente_seguimiento where razon_social = 'Seg hoy'),
  'sin_agenda',
  'Sacar la fecha de próximo contacto pasa el cliente a sin agenda'
);

-- Borrar el contacto deja la interacción sin contacto (y sin tocar el cliente).
select lives_ok(
  $$ delete from public.cliente_contacto where nombre = 'Ana atrasado' $$,
  'authenticated borra un contacto con interacciones'
);
select results_eq(
  $$ select contacto_id is null, cliente_id = (select id from public.cliente where razon_social = 'Seg atrasado')
       from public.cliente_interaccion where resumen = 'Pidió presupuesto' $$,
  $$ values (true, true) $$,
  'Borrar el contacto deja la interacción sin contacto y con su cliente'
);

select lives_ok(
  $$ delete from public.cliente_interaccion where resumen = 'Feria' $$,
  'authenticated borra una interacción'
);
select is(
  (select estado_seguimiento from public.v_cliente_seguimiento where razon_social = 'Seg más adelante'),
  'sin_agenda',
  'Sin interacciones, el cliente queda sin agenda'
);

-- Borrar el cliente borra sus interacciones.
select is(
  (select count(*) from public.cliente_interaccion
    where cliente_id = (select id from public.cliente where razon_social = 'Seg reemplazo')),
  2::bigint,
  'El cliente tiene dos interacciones antes de borrarlo'
);
create temporary table cliente_borrado as
  select id from public.cliente where razon_social = 'Seg reemplazo';
select lives_ok(
  $$ delete from public.cliente where razon_social = 'Seg reemplazo' $$,
  'authenticated borra un cliente con interacciones'
);
select is(
  (select count(*) from public.cliente_interaccion where cliente_id = (select id from cliente_borrado)),
  0::bigint,
  'Borrar el cliente borra sus interacciones'
);

-- Un cliente inactivo sigue en la vista, marcado.
update public.cliente set activo = false where razon_social = 'Seg en 8 días';
select is(
  (select activo from public.v_cliente_seguimiento where razon_social = 'Seg en 8 días'),
  false,
  'La vista expone si el cliente está activo'
);

-- ---------------------------------------------------------------------
-- Como anon: no ve nada
-- ---------------------------------------------------------------------

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.cliente_interaccion $$,
  '42501', null,
  'anon no puede leer interacciones'
);
select throws_ok(
  $$ select * from public.v_cliente_seguimiento $$,
  '42501', null,
  'anon no puede leer la vista de seguimiento'
);
reset role;

-- Las columnas de la vista que usa la app.
select has_column('public', 'v_cliente_seguimiento', 'cliente_id', 'La vista tiene cliente_id');
select has_column('public', 'v_cliente_seguimiento', 'zona', 'La vista tiene el nombre de la zona');

select * from finish();
rollback;
