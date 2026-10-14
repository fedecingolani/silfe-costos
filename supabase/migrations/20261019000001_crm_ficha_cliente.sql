-- =====================================================================
-- Silfe Costos - Ficha completa del cliente (Fase 6, CRM)
-- Condición frente al IVA, datos bancarios, transporte habitual,
-- sucursales y direcciones de entrega, y contactos ampliados.
-- Todos los campos nuevos son opcionales: los clientes existentes siguen
-- funcionando sin cambios.
-- =====================================================================

-- ----- Transportes ------------------------------------------------------

create table transporte (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique,
  telefono       text,
  observaciones  text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

comment on table transporte is
  'Catálogo de transportes (expresos, fletes) con los que se despacha a los clientes';
comment on column transporte.activo is
  'Un transporte en uso no se puede borrar: se desactiva para que no se ofrezca más';

-- ----- Cliente: datos fiscales, bancarios y transporte --------------------

alter table cliente
  add column condicion_iva   text,
  add column cbu             text,
  add column cvu             text,
  add column alias_bancario  text,
  add column transporte_id   uuid references transporte(id) on delete restrict,
  add column observaciones   text,
  add constraint cliente_condicion_iva_check check (
    condicion_iva in ('Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final')
  ),
  add constraint cliente_cbu_check check (cbu ~ '^[0-9]{22}$'),
  add constraint cliente_cvu_check check (cvu ~ '^[0-9]{22}$'),
  add constraint cliente_alias_bancario_check check (
    char_length(alias_bancario) between 6 and 20 and alias_bancario ~ '^[A-Za-z0-9.-]+$'
  );

comment on column cliente.direccion is
  'Domicilio fiscal (junto con localidad, provincia y código postal)';
comment on column cliente.condicion_iva is
  'Condición frente al IVA: Responsable Inscripto, Monotributista, Exento o Consumidor Final';
comment on column cliente.cbu is
  'CBU de 22 dígitos. La base sólo valida el formato; los dígitos verificadores los avisa la app';
comment on column cliente.cvu is
  'CVU de 22 dígitos (cuentas de billeteras virtuales). La base sólo valida el formato';
comment on column cliente.alias_bancario is
  'Alias de CBU o CVU: de 6 a 20 caracteres, letras, números, punto y guion';
comment on column cliente.transporte_id is
  'Transporte habitual del cliente; una sucursal puede tener uno propio';
comment on column cliente.observaciones is
  'Notas libres sobre el cliente';

create index cliente_transporte_idx on cliente (transporte_id);
create index cliente_cuit_idx on cliente (cuit);

-- ----- Sucursales y direcciones de entrega ---------------------------------

create table cliente_sucursal (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references cliente(id) on delete cascade,
  nombre           text not null,
  direccion        text,
  localidad        text,
  provincia        text,
  codigo_postal    text,
  telefono         text,
  observaciones    text,
  recibe_entregas  boolean not null default true,
  principal        boolean not null default false,
  transporte_id    uuid references transporte(id) on delete restrict,
  orden            int not null default 0,
  creado_en        timestamptz not null default now()
);

comment on table cliente_sucursal is
  'Sucursales y direcciones de entrega de un cliente (casa central, depósitos, etc.)';
comment on column cliente_sucursal.nombre is
  'Nombre corto para reconocerla, ej. "Casa central" o "Depósito Cipolletti"';
comment on column cliente_sucursal.recibe_entregas is
  'Indica si la sucursal es un punto de entrega';
comment on column cliente_sucursal.principal is
  'Dirección de entrega principal del cliente; puede haber una sola por cliente';
comment on column cliente_sucursal.transporte_id is
  'Transporte propio de la sucursal; si falta se usa el habitual del cliente';

create index cliente_sucursal_idx on cliente_sucursal (cliente_id, orden);
-- Permite que un contacto apunte a una sucursal de su mismo cliente.
alter table cliente_sucursal
  add constraint cliente_sucursal_id_cliente_key unique (id, cliente_id);
create index cliente_sucursal_transporte_idx on cliente_sucursal (transporte_id);
create unique index cliente_sucursal_principal_unica
  on cliente_sucursal (cliente_id) where principal;

-- Cambia la sucursal principal de un cliente: primero desmarca la anterior y
-- después marca la nueva, en la misma transacción, para respetar el índice
-- único parcial. security invoker: corre con los permisos de quien llama.
create or replace function public.marcar_sucursal_principal(p_sucursal_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cliente_id uuid;
begin
  select cliente_id into v_cliente_id
  from public.cliente_sucursal
  where id = p_sucursal_id;

  if v_cliente_id is null then
    raise exception 'No existe la sucursal %', p_sucursal_id
      using errcode = 'no_data_found';
  end if;

  update public.cliente_sucursal
     set principal = false
   where cliente_id = v_cliente_id and principal and id <> p_sucursal_id;

  update public.cliente_sucursal
     set principal = true
   where id = p_sucursal_id;
end;
$$;

comment on function public.marcar_sucursal_principal(uuid) is
  'Marca una sucursal como la principal de su cliente y desmarca la anterior';

-- ----- Contactos ampliados -------------------------------------------------

alter table cliente_contacto
  add column email          text,
  add column whatsapp       text,
  add column observaciones  text,
  add column sucursal_id    uuid,
  -- La sucursal tiene que ser del mismo cliente. Al borrarla sólo se vacía
  -- sucursal_id (no cliente_id).
  add constraint cliente_contacto_sucursal_fk foreign key (sucursal_id, cliente_id)
    references cliente_sucursal (id, cliente_id) on delete set null (sucursal_id),
  add constraint cliente_contacto_email_check check (position('@' in email) > 1);

comment on column cliente_contacto.email is
  'Email del contacto; la base sólo controla que tenga una arroba';
comment on column cliente_contacto.whatsapp is
  'Número de WhatsApp, en texto libre';
comment on column cliente_contacto.sucursal_id is
  'Sucursal donde trabaja el contacto; queda vacía si se borra la sucursal';

create index cliente_contacto_sucursal_idx on cliente_contacto (sucursal_id);
