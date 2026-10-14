-- =====================================================================
-- Silfe Costos - Seguimiento de clientes (Fase 7, CRM)
-- Cada contacto con un cliente (llamado, visita, WhatsApp, email) queda
-- registrado con su resumen y el próximo paso. La vista
-- v_cliente_seguimiento calcula, por cliente, el último contacto y si el
-- próximo está atrasado, es hoy o se viene en los próximos días.
-- =====================================================================

-- Permite que una interacción apunte a un contacto de su mismo cliente.
alter table cliente_contacto
  add constraint cliente_contacto_id_cliente_key unique (id, cliente_id);

create table cliente_interaccion (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references cliente(id) on delete cascade,
  contacto_id          uuid,
  tipo                 text not null,
  sentido              text not null default 'SALIENTE',
  fecha                timestamptz not null default now(),
  resumen              text not null,
  notas                text,
  proximo_contacto     date,
  proxima_accion       text,
  realizado_por        uuid default auth.uid(),
  realizado_por_email  text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  -- El contacto tiene que ser del mismo cliente. Al borrarlo sólo se vacía
  -- contacto_id (no cliente_id): la interacción queda, sin contacto.
  constraint cliente_interaccion_contacto_fk foreign key (contacto_id, cliente_id)
    references cliente_contacto (id, cliente_id) on delete set null (contacto_id),
  constraint cliente_interaccion_tipo_check check (
    tipo in ('LLAMADO', 'VISITA', 'WHATSAPP', 'EMAIL', 'OTRO')
  ),
  constraint cliente_interaccion_sentido_check check (sentido in ('SALIENTE', 'ENTRANTE')),
  constraint cliente_interaccion_resumen_check check (btrim(resumen) <> '')
);

comment on table cliente_interaccion is
  'Contactos con un cliente (llamados, visitas, mensajes) con su resultado y el próximo paso';
comment on column cliente_interaccion.contacto_id is
  'Persona del cliente con la que se habló; queda vacía si se borra el contacto';
comment on column cliente_interaccion.sentido is
  'SALIENTE: lo iniciamos nosotros. ENTRANTE: nos contactó el cliente';
comment on column cliente_interaccion.proximo_contacto is
  'Fecha del próximo contacto. Manda la de la interacción más reciente del cliente';
comment on column cliente_interaccion.realizado_por is
  'Usuario que registró la interacción (auth.uid()). Sin FK: los usuarios se manejan desde Auth';
comment on column cliente_interaccion.realizado_por_email is
  'Copia del email de quien la registró, al momento del registro';

create index cliente_interaccion_cliente_fecha_idx on cliente_interaccion (cliente_id, fecha desc);
create index cliente_interaccion_proximo_contacto_idx on cliente_interaccion (proximo_contacto);
create index cliente_interaccion_contacto_idx on cliente_interaccion (contacto_id);

create trigger trg_cliente_interaccion_actualizado before update on cliente_interaccion
  for each row execute function fn_set_actualizado_en();

-- ----- Estado de seguimiento por cliente ---------------------------------

-- Una fila por cliente. La agenda (próximo contacto y acción) sale de su
-- interacción más reciente: registrar una nueva reemplaza la anterior.
-- "Hoy" es la fecha de Argentina, no la del servidor.
create view v_cliente_seguimiento
with (security_invoker = true) as
select
  c.id                 as cliente_id,
  c.codigo_legado,
  c.razon_social,
  c.cuit,
  c.cuit_digitos,
  c.localidad,
  c.telefono,
  c.zona_id,
  z.nombre             as zona,
  c.transporte_id,
  c.activo,
  u.id                 as ultima_interaccion_id,
  u.fecha              as ultima_interaccion_fecha,
  u.tipo               as ultima_interaccion_tipo,
  u.resumen            as ultimo_resumen,
  u.proximo_contacto,
  u.proxima_accion,
  case
    when u.proximo_contacto is null then 'sin_agenda'
    when u.proximo_contacto < h.hoy then 'atrasado'
    when u.proximo_contacto = h.hoy then 'hoy'
    when u.proximo_contacto <= h.hoy + 7 then 'proximo'
    else 'mas_adelante'
  end                  as estado_seguimiento
from cliente c
left join zona z on z.id = c.zona_id
left join lateral (
  select i.id, i.fecha, i.tipo, i.resumen, i.proximo_contacto, i.proxima_accion
  from cliente_interaccion i
  where i.cliente_id = c.id
  order by i.fecha desc, i.creado_en desc, i.id desc
  limit 1
) u on true
cross join (
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy
) h;

comment on view v_cliente_seguimiento is
  'Último contacto y próximo contacto de cada cliente, con el estado de seguimiento '
  '(atrasado, hoy, proximo, mas_adelante o sin_agenda) contra la fecha de Argentina';
