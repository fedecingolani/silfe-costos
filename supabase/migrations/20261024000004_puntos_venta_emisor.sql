-- =====================================================================
-- Silfe Costos - Puntos de venta fuera del emisor
-- 20261024000001_comprobantes.sql copió arca_emisor.punto_venta a la tabla
-- punto_venta y dejó la columna como obsoleta hasta mover la pantalla de
-- ARCA. La pantalla ya administra los puntos de venta: se borra la columna.
--
-- Antes de borrarla se copia otra vez (por si alguien la cambió desde la
-- pantalla vieja después de la migración anterior). Si no hay ningún punto
-- de venta, se crea el 7 electrónico, que es el que usa la empresa para la
-- factura electrónica (ver la spec de comprobantes de venta).
-- =====================================================================

insert into punto_venta (numero, nombre, electronico)
select punto_venta, 'Factura electrónica', true
from arca_emisor
where punto_venta is not null
on conflict (numero) do nothing;

insert into punto_venta (numero, nombre, electronico)
select 7, 'Factura electrónica', true
where not exists (select 1 from punto_venta);

alter table arca_emisor drop column punto_venta;
