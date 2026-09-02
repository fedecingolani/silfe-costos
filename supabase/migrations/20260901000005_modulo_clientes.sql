-- =====================================================================
-- Silfe Costos - Módulo de clientes
-- Clientes a los que se les vende, con su zona de venta y contactos.
-- =====================================================================

create table zona (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  creado_en  timestamptz not null default now()
);

comment on table zona is 'Catálogo cerrado de zonas de venta';

insert into zona (nombre) values
  ('Centro'),
  ('Cuyo'),
  ('Libre'),
  ('Noreste'),
  ('Noroeste'),
  ('Sur')
on conflict (nombre) do nothing;

create table cliente (
  id             uuid primary key default gen_random_uuid(),
  codigo_legado  integer,
  razon_social   text not null,
  cuit           text,
  direccion      text,
  localidad      text,
  provincia      text,
  codigo_postal  text,
  telefono       text,
  zona_id        uuid references zona(id),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

comment on column cliente.codigo_legado is
  'Código numérico del sistema anterior; puede no existir en clientes nuevos';
comment on column cliente.cuit is
  'Texto libre: en la práctica hay CUITs repetidos o placeholder, no se fuerza unicidad';

create index cliente_zona_idx on cliente (zona_id);
create index cliente_razon_social_idx on cliente (lower(razon_social));

create table cliente_contacto (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references cliente(id) on delete cascade,
  nombre      text not null,
  cargo       text,
  telefono    text,
  orden       int not null default 0,
  creado_en   timestamptz not null default now()
);

create index cliente_contacto_idx on cliente_contacto (cliente_id, orden);
