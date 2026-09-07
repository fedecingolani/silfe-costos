-- =====================================================================
-- Silfe Costos - Contactos de proveedor
-- Un proveedor puede tener varias personas de contacto (vendedor,
-- administración, etc.), igual que cliente_contacto para clientes.
-- =====================================================================

create table proveedor_contacto (
  id            uuid primary key default gen_random_uuid(),
  proveedor_id  uuid not null references proveedor(id) on delete cascade,
  nombre        text not null,
  cargo         text,
  telefono      text,
  email         text,
  orden         int not null default 0,
  creado_en     timestamptz not null default now()
);

create index proveedor_contacto_idx on proveedor_contacto (proveedor_id, orden);
