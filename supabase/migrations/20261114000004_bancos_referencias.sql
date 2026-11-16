-- =====================================================================
-- Charoli Gestión - Bancos: las cuentas de fondos y los cheques
-- referencian la tabla banco
--
-- cuenta_fondos.banco y cheque.banco pasan a ser claves foráneas por
-- nombre a banco(nombre) (20261114000002_bancos.sql). Las funciones SQL,
-- las descripciones de movimientos y los PDF que leen `banco` como texto
-- siguen igual. No se tocan recibo_medio.banco ni orden_pago_medio.banco.
--
-- Renombrar un banco:
--   - cuenta_fondos acompaña el cambio (on update cascade).
--   - cheque no: un cheque es inmutable (fn_cheque_validar no deja cambiar
--     su banco), así que su FK no tiene cascada y renombrar un banco usado
--     en cheques falla (cheque_banco_fkey). Se desactiva y se crea otro.
--
-- Datos ya cargados, antes de crear las FK (clave de comparación: sin
-- tildes, en minúsculas y con los espacios colapsados, como el índice
-- banco_nombre_clave_uq):
--   1. Cada valor cargado cuya clave no coincide con ningún banco se agrega
--      como banco activo (uno por clave; si hay varias grafías, la más
--      usada y, a igual uso, la primera en orden de bytes, que pone las
--      mayúsculas antes: "Banco Galicia" antes que "banco galicia").
--   2. Las cuentas de fondos se llevan al nombre del banco que coincide por
--      clave ("BANCO MACRO " → "Banco Macro"). Un banco vacío pasa a null.
--   3. Los cheques no se modifican: el trigger de cheques no se desactiva
--      ni se debilita. Cada grafía de un cheque que no está tal cual en la
--      tabla se agrega como banco INACTIVO (el índice por clave sólo cuenta
--      los activos), para que la FK valga sin perder el dato.
--   No se unifican variantes distintas ("BNA" y "Banco de la Nación
--   Argentina" quedan como dos bancos): eso queda para después.
-- =====================================================================

create function pg_temp.clave_banco(valor text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(translate(valor, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
$$;

-- 1. Valores cargados sin un banco con la misma clave.
insert into banco (nombre)
select distinct on (pg_temp.clave_banco(valor)) valor
from (
  select valor, count(*) as usos
  from (
    select regexp_replace(btrim(banco), '\s+', ' ', 'g') as valor from cuenta_fondos where btrim(banco) <> ''
    union all
    select regexp_replace(btrim(banco), '\s+', ' ', 'g') from cheque where btrim(banco) <> ''
  ) todos
  group by valor
) cargados
where not exists (
  select 1 from banco b where pg_temp.clave_banco(b.nombre) = pg_temp.clave_banco(cargados.valor)
)
order by pg_temp.clave_banco(valor), usos desc, valor collate "C"
on conflict do nothing;

-- 2. Cuentas de fondos: al nombre del banco con la misma clave (el activo, si hay).
update cuenta_fondos
set banco = null
where banco is not null and btrim(banco) = '';

update cuenta_fondos c
set banco = (
  select b.nombre
  from banco b
  where pg_temp.clave_banco(b.nombre) = pg_temp.clave_banco(c.banco)
  order by b.activo desc, b.nombre
  limit 1
)
where c.banco is not null
  and not exists (select 1 from banco b where b.nombre = c.banco and b.activo);

-- 3. Cheques: cada grafía que no está tal cual, como banco inactivo.
insert into banco (nombre, activo)
select distinct ch.banco, false
from cheque ch
where not exists (select 1 from banco b where b.nombre = ch.banco)
on conflict do nothing;

drop function pg_temp.clave_banco(text);

-- ----- Claves foráneas ------------------------------------------------------

alter table cuenta_fondos
  add constraint cuenta_fondos_banco_fkey foreign key (banco) references banco (nombre) on update cascade;

alter table cheque
  add constraint cheque_banco_fkey foreign key (banco) references banco (nombre);

create index cuenta_fondos_banco_idx on cuenta_fondos (banco) where banco is not null;
create index cheque_banco_idx on cheque (banco);
