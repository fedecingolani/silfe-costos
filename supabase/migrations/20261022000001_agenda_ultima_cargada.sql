-- La agenda del cliente (próximo contacto y acción) sale de la interacción
-- cargada más recientemente (creado_en), aunque tenga una fecha anterior:
-- si se registra tarde un llamado de ayer, su agenda reemplaza a la vigente.
-- El "último contacto" sigue siendo el de fecha más reciente.
-- Se reemplaza la vista con las mismas columnas y en el mismo orden, así se
-- conservan los permisos (sólo lectura para authenticated, nada para anon).
create or replace view v_cliente_seguimiento
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
  a.proximo_contacto,
  a.proxima_accion,
  case
    when a.proximo_contacto is null then 'sin_agenda'
    when a.proximo_contacto < h.hoy then 'atrasado'
    when a.proximo_contacto = h.hoy then 'hoy'
    when a.proximo_contacto <= h.hoy + 7 then 'proximo'
    else 'mas_adelante'
  end                  as estado_seguimiento
from cliente c
left join zona z on z.id = c.zona_id
-- Último contacto: la interacción de fecha más reciente.
left join lateral (
  select i.id, i.fecha, i.tipo, i.resumen
  from cliente_interaccion i
  where i.cliente_id = c.id
  order by i.fecha desc, i.creado_en desc, i.id desc
  limit 1
) u on true
-- Agenda: la interacción cargada más recientemente.
left join lateral (
  select i.proximo_contacto, i.proxima_accion
  from cliente_interaccion i
  where i.cliente_id = c.id
  order by i.creado_en desc, i.fecha desc, i.id desc
  limit 1
) a on true
cross join (
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy
) h;

comment on view v_cliente_seguimiento is
  'Último contacto (por fecha) y agenda (de la interacción cargada más recientemente) de cada '
  'cliente, con el estado de seguimiento (atrasado, hoy, proximo, mas_adelante o sin_agenda) '
  'contra la fecha de Argentina';

create index if not exists cliente_interaccion_cliente_creado_idx
  on cliente_interaccion (cliente_id, creado_en desc);
