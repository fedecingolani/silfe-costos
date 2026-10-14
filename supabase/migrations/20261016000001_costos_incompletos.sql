-- =====================================================================
-- Silfe Costos - Costos incompletos en v_lista_precio_base
-- v_producto_costo toma como 0 el costo de una materia prima sin precio
-- vigente, así que el precio sugerido nunca es null: un producto con un
-- precio faltante sale con un sugerido bajo o en 0 sin aviso. Se agrega
-- al final de la vista la marca costos_incompletos, para que el editor
-- exija un precio manual en esos productos.
-- La vista conserva columnas, orden, security_invoker y permisos.
-- =====================================================================

create or replace view v_lista_precio_base
with (security_invoker = true) as
with terminado as (
  select p.id, p.codigo
  from producto p
  where p.tipo = 'TERMINADO' and p.activo
),
uso as (
  select distinct pc.producto_id as padre_id, pc.subgrupo_id
  from producto_componente pc
  join terminado t on t.id = pc.producto_id
  join producto s  on s.id = pc.subgrupo_id
  where pc.tipo = 'SUBGRUPO' and s.activo
),
filas as (
  -- seccion 0: productos con sus repuestos; seccion 1: otros repuestos
  select t.id as producto_id, null::uuid as padre_producto_id, false as es_repuesto,
         0 as seccion, t.codigo as codigo_padre, 0 as nivel
  from terminado t
  union all
  select u.subgrupo_id, u.padre_id, true, 0, t.codigo, 1
  from uso u
  join terminado t on t.id = u.padre_id
  union all
  select s.id, null::uuid, true, 1, null::text, 1
  from producto s
  where s.tipo = 'SUBGRUPO' and s.activo
    and not exists (select 1 from uso u where u.subgrupo_id = s.id)
),
-- Productos con alguna materia prima sin precio vigente: propia o dentro
-- de uno de sus subgrupos (la estructura tiene dos niveles).
sin_precio as (
  select cd.producto_id
  from v_componente_detalle cd
  where cd.sin_precio
  union
  select padre.producto_id
  from producto_componente padre
  join v_componente_detalle cd on cd.producto_id = padre.subgrupo_id and cd.sin_precio
  where padre.tipo = 'SUBGRUPO'
)
select
  row_number() over (order by f.seccion, f.codigo_padre, f.nivel, p.codigo) as orden,
  f.es_repuesto,
  f.producto_id,
  f.padre_producto_id,
  p.codigo,
  p.nombre                                  as descripcion,
  um.nombre                                 as presentacion,
  p.alicuota_iva,
  c.precio_presentacion                     as precio_sugerido,
  public.redondear_precio_lista(c.precio_presentacion) as precio_redondeado,
  coalesce(c.precio_presentacion, 0) <= 0
    or exists (select 1 from sin_precio sp where sp.producto_id = f.producto_id)
                                            as costos_incompletos
from filas f
join producto p                on p.id = f.producto_id
left join v_producto_costo c   on c.id = p.id
left join unidad_medida um     on um.id = coalesce(p.unidad_venta_id, p.unidad_id)
order by orden;

comment on column v_lista_precio_base.costos_incompletos is
  'Verdadero si falta el precio vigente de alguna materia prima (propia o de un subgrupo) o si el precio sugerido es 0: el sugerido no es confiable y hace falta un precio manual';

-- Se reafirman los permisos junto al cambio (se conservan al reemplazar
-- la vista).
revoke all on public.v_lista_precio_base from anon;
revoke insert, update, delete on public.v_lista_precio_base from authenticated;
grant select on public.v_lista_precio_base to authenticated;
