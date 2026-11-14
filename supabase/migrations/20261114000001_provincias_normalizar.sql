-- =====================================================================
-- Charoli Gestión - Provincias: normalizar los valores cargados
--
-- La provincia del cliente y de sus sucursales pasa a elegirse de una
-- lista fija (src/lib/provincias.ts, las 24 jurisdicciones). Esta
-- migración lleva al nombre de la lista los valores ya cargados que
-- coinciden sin importar mayúsculas, tildes ni espacios ("cordoba",
-- " NEUQUEN " → "Córdoba", "Neuquén"), más los nombres usuales de la
-- Ciudad Autónoma de Buenos Aires ("CABA", "Capital Federal").
--
-- Los valores que no coinciden quedan como están: la pantalla los sigue
-- mostrando y los conserva al editar. No hay restricción en la base.
--
-- No se tocan las copias históricas de la provincia del cliente
-- (comprobante.receptor_provincia y los datos de remitos y presupuestos):
-- son lo que se emitió en su momento.
--
-- No usa unaccent (la extensión no está habilitada): quita las tildes con
-- translate().
-- =====================================================================

create temporary table provincia_canonica (clave text primary key, nombre text not null);

insert into provincia_canonica (clave, nombre)
select lower(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), nombre
from unnest(array[
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán'
]) as nombre;

insert into provincia_canonica (clave, nombre) values
  ('caba', 'Ciudad Autónoma de Buenos Aires'),
  ('capital federal', 'Ciudad Autónoma de Buenos Aires');

-- Clave de comparación: sin tildes, en minúsculas y con los espacios colapsados.
create function pg_temp.clave_provincia(valor text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(translate(valor, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
$$;

update cliente c
set provincia = p.nombre
from provincia_canonica p
where pg_temp.clave_provincia(c.provincia) = p.clave
  and c.provincia is distinct from p.nombre;

update cliente_sucursal s
set provincia = p.nombre
from provincia_canonica p
where pg_temp.clave_provincia(s.provincia) = p.clave
  and s.provincia is distinct from p.nombre;

drop function pg_temp.clave_provincia(text);
drop table provincia_canonica;
