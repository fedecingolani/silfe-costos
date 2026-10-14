-- =====================================================================
-- Silfe Costos - Redondeo de v_lista_precio_base
-- El redondeo a la centena se aplicaba sobre el precio sin redondear, así
-- que un decimal residual de un cálculo (ej. 24500.0000001) subía a la
-- centena siguiente (24600). Ahora se redondea a centavos antes del ceil.
-- La vista conserva columnas, security_invoker y permisos.
-- =====================================================================

-- Precio redondeado hacia arriba a la centena, a partir del precio
-- redondeado a centavos. Inmutable: sólo depende de su argumento.
create or replace function public.redondear_precio_lista(p_precio numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.ceil(pg_catalog.round(p_precio, 2) / 100) * 100;
$$;

comment on function public.redondear_precio_lista(numeric) is
  'Redondea un precio hacia arriba a la centena, después de redondearlo a centavos';

-- La vista es security_invoker: quien la consulta necesita EXECUTE.
revoke execute on function public.redondear_precio_lista(numeric) from public, anon;
grant execute on function public.redondear_precio_lista(numeric) to authenticated;

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
  public.redondear_precio_lista(c.precio_presentacion) as precio_redondeado
from filas f
join producto p                on p.id = f.producto_id
left join v_producto_costo c   on c.id = p.id
left join unidad_medida um     on um.id = coalesce(p.unidad_venta_id, p.unidad_id)
order by orden;

comment on view v_lista_precio_base is
  'Filas de partida para una lista de precios nueva, en el orden de impresión, con el precio de la presentación y su redondeo a la centena';
comment on column v_lista_precio_base.precio_redondeado is
  'precio_sugerido redondeado a centavos y después hacia arriba a la centena';
