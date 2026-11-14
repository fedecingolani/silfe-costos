-- =====================================================================
-- Charoli Gestión - Bancos: tabla editable de bancos
--
-- El banco de las cuentas de fondos y de los cheques de terceros pasa a
-- elegirse de una lista en lugar de escribirse a mano, para que no haya
-- variantes del mismo dato ("Banco Nación", "BNA", "Nacion"). La lista se
-- edita en Configuración → Bancos: se crean, se renombran y se desactivan
-- (no se borran). Un banco inactivo no aparece en los selectores, pero los
-- registros que ya lo usan lo siguen mostrando.
--
-- Nombre:
--   - Único tal cual (banco_nombre_key): es la clave de las referencias
--     por nombre que agrega 20261114000004_bancos_referencias.sql.
--   - Además, dos bancos ACTIVOS no pueden diferir sólo en mayúsculas,
--     tildes o espacios (banco_nombre_clave_uq). El índice es parcial: los
--     cheques no se pueden modificar (fn_cheque_validar), así que una
--     variante ya cargada en un cheque ("BANCO MACRO") se conserva como un
--     banco inactivo aparte para que su referencia valga.
--   No usa unaccent (la extensión no está habilitada): quita las tildes
--   con translate().
--
-- Se precarga con los bancos que operan en Argentina, por su nombre usual.
-- =====================================================================

create table banco (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  constraint banco_nombre_check check (btrim(nombre) <> '')
);

comment on table banco is
  'Bancos que se eligen en las cuentas de fondos y en los cheques de terceros. No se borran: se desactivan';
comment on column banco.nombre is
  'Nombre del banco. Las cuentas de fondos y los cheques lo referencian por nombre';

create unique index banco_nombre_clave_uq on banco (
  lower(btrim(regexp_replace(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
) where activo;

insert into banco (nombre)
select nombre
from unnest(array[
  'Banco de la Nación Argentina',
  'Banco de la Provincia de Buenos Aires',
  'Banco de Galicia',
  'Banco Santander',
  'BBVA',
  'Banco Macro',
  'Banco Credicoop',
  'ICBC',
  'Banco Patagonia',
  'Banco Supervielle',
  'Banco Hipotecario',
  'Banco Ciudad',
  'Banco Comafi',
  'HSBC',
  'Banco de Córdoba',
  'Banco de Santa Fe',
  'Banco de Entre Ríos',
  'Banco de San Juan',
  'Banco de Santiago del Estero',
  'Banco de Corrientes',
  'Banco del Chubut',
  'Banco de la Pampa',
  'Banco Provincia del Neuquén',
  'Banco de Tierra del Fuego',
  'Banco del Chaco',
  'Banco de Formosa',
  'Banco Rioja',
  'Banco Santa Cruz',
  'Banco del Tucumán',
  'Banco Municipal de Rosario',
  'Banco Industrial (BIND)',
  'Banco Columbia',
  'Banco Mariva',
  'Banco Piano',
  'Banco Julio',
  'Banco Roela',
  'Banco Meridian',
  'Banco Saenz',
  'Banco CMF',
  'Banco Masventas',
  'Banco BICE',
  'Banco Coinag',
  'Banco Dino',
  'Brubank',
  'Wilobank',
  'Banco del Sol',
  'Banco Voii',
  'Banco de Valores',
  'Bank of China',
  'Banco Bradesco',
  'BNP Paribas',
  'Citibank N.A.',
  'Banco de la República Oriental del Uruguay'
]) as nombre
on conflict do nothing;
