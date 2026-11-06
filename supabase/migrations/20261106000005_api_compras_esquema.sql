-- =====================================================================
-- Charoli Gestión - API de compras (esquema)
--
-- Factura Digital manda las facturas de compra que digitaliza y consulta o
-- da de alta proveedores por una API HTTP (/api/v1/*) autenticada con una
-- clave por integración (ver odd/tasks/api-compras.md).
--
--   - api_clave: claves de API. Se guarda el SHA-256 (hex) de la clave y un
--     prefijo visible para reconocerla; la clave completa se muestra una
--     sola vez al crearla. Alcanza SHA-256 porque la clave es aleatoria de
--     32 bytes, no una contraseña. Una clave revocada (revocada_en) no
--     autentica más.
--   - comprobante_compra: cae, cae_vencimiento y origen (manual o api).
--   - proveedor.cuit: pasa a guardarse sólo con dígitos y es único entre
--     proveedores, así la API encuentra al proveedor por CUIT. Lo normaliza
--     un trigger al guardar (sin guiones, puntos ni espacios; vacío pasa a
--     null), y los que ya estaban se normalizan acá. Si después de normalizar quedan dos proveedores con el mismo
--     CUIT, la migración falla y los lista: hay que unificarlos a mano (no
--     se fusionan solos). El control de 11 dígitos se agrega NOT VALID: los
--     CUIT viejos mal cargados se conservan, pero toda escritura nueva (y
--     cualquier cambio de un proveedor con un CUIT así) tiene que cumplirlo.
--
-- RLS y permisos en 20261106000006_rls_api_compras.sql.
-- =====================================================================

-- ----- Claves de API ------------------------------------------------------

create table api_clave (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  prefijo        text not null,
  hash           text not null,
  creado_en      timestamptz not null default now(),
  creado_por     uuid default auth.uid(),
  revocada_en    timestamptz,
  ultimo_uso_en  timestamptz,
  constraint api_clave_nombre_check check (btrim(nombre) <> ''),
  constraint api_clave_prefijo_check check (btrim(prefijo) <> ''),
  constraint api_clave_hash_check check (hash ~ '^[0-9a-f]{64}$')
);

create unique index api_clave_hash_uq on api_clave (hash);

comment on table api_clave is
  'Claves de API de las integraciones (Factura Digital). Sólo se guarda el hash; una revocada no autentica';
comment on column api_clave.nombre is 'Para qué integración es la clave';
comment on column api_clave.prefijo is 'Primeros caracteres de la clave, para reconocerla en la pantalla';
comment on column api_clave.hash is 'SHA-256 de la clave completa, en hexadecimal (64 caracteres)';
comment on column api_clave.creado_por is 'Usuario que la creó (auth.uid()). Sin FK: los usuarios se manejan desde Auth';
comment on column api_clave.revocada_en is 'Momento en que se revocó. Con valor, la clave no autentica más';
comment on column api_clave.ultimo_uso_en is 'Último pedido autenticado con la clave (aproximado: se actualiza sin bloquear)';

-- ----- Comprobantes de compra: CAE y origen -------------------------------

alter table comprobante_compra
  add column cae text,
  add column cae_vencimiento date,
  add column origen text not null default 'manual',
  add constraint comprobante_compra_origen_check check (origen in ('manual', 'api')),
  add constraint comprobante_compra_cae_check check (cae is null or btrim(cae) <> '');

comment on column comprobante_compra.cae is 'CAE (o CAI) del comprobante del proveedor, si se conoce';
comment on column comprobante_compra.cae_vencimiento is 'Vencimiento del CAE';
comment on column comprobante_compra.origen is 'manual (cargado en la pantalla) | api (enviado por una integración)';

-- ----- CUIT del proveedor: sólo dígitos y único -----------------------------

-- Lo normaliza la base al guardar (como cliente.cuit_digitos en ventas):
-- vale para la pantalla, la API, el seed y SQL directo.
create or replace function public.fn_proveedor_normalizar_cuit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.cuit := nullif(regexp_replace(new.cuit, '[^0-9]', '', 'g'), '');
  return new;
end;
$$;

comment on function public.fn_proveedor_normalizar_cuit() is
  'Deja el CUIT del proveedor sólo con dígitos (vacío: null) antes de guardarlo';

create trigger trg_proveedor_normalizar_cuit
  before insert or update of cuit on proveedor
  for each row execute function public.fn_proveedor_normalizar_cuit();

revoke execute on function public.fn_proveedor_normalizar_cuit() from anon, authenticated, public;

-- El trigger normaliza los que ya estaban.
update proveedor
set cuit = nullif(regexp_replace(cuit, '[^0-9]', '', 'g'), '')
where cuit is distinct from nullif(regexp_replace(cuit, '[^0-9]', '', 'g'), '');

do $$
declare
  v_repetidos text;
begin
  select string_agg(format('%s (%s)', d.cuit, d.nombres), '; ' order by d.cuit)
  into v_repetidos
  from (
    select p.cuit, string_agg(p.nombre, ', ' order by p.nombre) as nombres
    from proveedor p
    where p.cuit is not null
    group by p.cuit
    having count(*) > 1
  ) d;

  if v_repetidos is not null then
    raise exception 'Hay proveedores con el mismo CUIT: %. Unificalos o corregí el CUIT antes de aplicar esta migración.',
      v_repetidos;
  end if;
end;
$$;

alter table proveedor
  add constraint proveedor_cuit_check check (cuit ~ '^[0-9]{11}$') not valid;

create unique index proveedor_cuit_uq on proveedor (cuit) where cuit is not null;

comment on column proveedor.cuit is 'CUIT sólo con dígitos (11), único entre proveedores. Vacío: null';
