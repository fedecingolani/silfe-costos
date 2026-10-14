-- La agenda (próximo contacto y acción) sale de la interacción cargada más
-- recientemente, aunque tenga una fecha anterior. El "último contacto" sigue
-- siendo el de fecha más reciente.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into public.cliente (razon_social) values ('Agenda carga tardía');

-- Hoy: visita con próximo contacto en 10 días (cargada primero).
insert into public.cliente_interaccion (cliente_id, tipo, resumen, fecha, creado_en, proximo_contacto, proxima_accion)
values (
  (select id from public.cliente where razon_social = 'Agenda carga tardía'),
  'VISITA', 'Visita de hoy', now(), now() - interval '1 hour',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date + 10, 'Volver a visitar'
);

-- Después se carga un llamado de ayer que había quedado sin registrar.
insert into public.cliente_interaccion (cliente_id, tipo, resumen, fecha, creado_en, proximo_contacto, proxima_accion)
values (
  (select id from public.cliente where razon_social = 'Agenda carga tardía'),
  'LLAMADO', 'Llamado de ayer', now() - interval '1 day', now(),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date + 2, 'Mandar lista'
);

select results_eq(
  $$ select proxima_accion, estado_seguimiento from public.v_cliente_seguimiento
     where razon_social = 'Agenda carga tardía' $$,
  $$ values ('Mandar lista'::text, 'proximo'::text) $$,
  'La agenda es la de la interacción cargada último, aunque tenga fecha anterior'
);

select results_eq(
  $$ select ultimo_resumen from public.v_cliente_seguimiento
     where razon_social = 'Agenda carga tardía' $$,
  $$ values ('Visita de hoy'::text) $$,
  'El último contacto sigue siendo el de fecha más reciente'
);

-- Cargar otra interacción sin próximo contacto deja al cliente sin agenda.
insert into public.cliente_interaccion (cliente_id, tipo, resumen, fecha, creado_en)
values (
  (select id from public.cliente where razon_social = 'Agenda carga tardía'),
  'EMAIL', 'Email viejo', now() - interval '3 days', now() + interval '1 minute'
);

select results_eq(
  $$ select estado_seguimiento from public.v_cliente_seguimiento
     where razon_social = 'Agenda carga tardía' $$,
  $$ values ('sin_agenda'::text) $$,
  'Una carga nueva sin próximo contacto deja al cliente sin agenda'
);

select * from finish();
rollback;
