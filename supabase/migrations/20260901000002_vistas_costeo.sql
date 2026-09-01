-- =====================================================================
-- Silfe Costos - Vistas de costeo
-- =====================================================================

-- Precio vigente de cada materia prima: se prioriza el marcado como
-- preferido y, en su defecto, el más reciente con vigencia iniciada.
create view v_materia_prima_precio
with (security_invoker = true) as
select distinct on (mp.id)
  mp.id            as materia_prima_id,
  pr.id            as precio_id,
  pr.proveedor_id,
  pv.nombre        as proveedor,
  pr.precio        as precio_compra,
  pr.moneda,
  pr.incluye_iva,
  pr.vigente_desde,
  pr.es_preferido
from materia_prima mp
left join precio_materia_prima pr
  on pr.materia_prima_id = mp.id
 and pr.vigente_desde <= current_date
left join proveedor pv on pv.id = pr.proveedor_id
order by mp.id, pr.es_preferido desc nulls last, pr.vigente_desde desc nulls last, pr.creado_en desc nulls last;

-- Costo de la materia prima expresado en su unidad de uso.
create view v_materia_prima_costo
with (security_invoker = true) as
select
  mp.id,
  mp.codigo,
  mp.nombre,
  mp.categoria,
  mp.activo,
  mp.factor_conversion,
  mp.merma_pct,
  uc.id            as unidad_compra_id,
  uc.codigo        as unidad_compra,
  uu.id            as unidad_uso_id,
  uu.codigo        as unidad_uso,
  vp.precio_id,
  vp.proveedor_id,
  vp.proveedor,
  vp.precio_compra,
  vp.moneda,
  vp.vigente_desde,
  -- precio por unidad de uso, antes de merma
  case when vp.precio_compra is null then null
       else vp.precio_compra / mp.factor_conversion
  end as costo_unitario_uso,
  -- costo real considerando el desperdicio propio del material
  case when vp.precio_compra is null then null
       else (vp.precio_compra / mp.factor_conversion) / (1 - mp.merma_pct / 100.0)
  end as costo_unitario_uso_con_merma
from materia_prima mp
join unidad_medida uc on uc.id = mp.unidad_compra_id
join unidad_medida uu on uu.id = mp.unidad_uso_id
left join v_materia_prima_precio vp on vp.materia_prima_id = mp.id;

-- Costo de cada proceso aplicado a un producto, por unidad producida.
create view v_proceso_costo
with (security_invoker = true) as
select
  pp.id,
  pp.producto_id,
  pp.proceso_id,
  p.codigo                 as proceso_codigo,
  p.nombre                 as proceso,
  pp.orden,
  pp.modo,
  pp.minutos,
  pp.categoria_mano_obra_id,
  cmo.nombre               as categoria,
  cmo.costo_hora,
  cmo.cargas_sociales_pct,
  cmo.costo_hora * (1 + cmo.cargas_sociales_pct / 100.0) as costo_hora_cargado,
  pp.costo_fijo,
  pp.cantidad_por_ciclo,
  pp.notas,
  case pp.modo
    when 'TIEMPO' then (pp.minutos / 60.0)
                        * cmo.costo_hora * (1 + cmo.cargas_sociales_pct / 100.0)
                        / pp.cantidad_por_ciclo
    when 'FIJO'   then pp.costo_fijo / pp.cantidad_por_ciclo
  end as costo,
  case when pp.modo = 'TIEMPO' then pp.minutos / pp.cantidad_por_ciclo else 0 end as minutos_por_unidad
from producto_proceso pp
join proceso p on p.id = pp.proceso_id
left join categoria_mano_obra cmo on cmo.id = pp.categoria_mano_obra_id;

create view v_producto_mano_obra
with (security_invoker = true) as
select
  producto_id,
  coalesce(sum(costo), 0)               as costo_mano_obra,
  coalesce(sum(minutos_por_unidad), 0)  as minutos,
  count(*)                              as cantidad_procesos
from v_proceso_costo
group by producto_id;

-- Costo unitario de cada subgrupo (materiales propios + mano de obra propia).
create view v_subgrupo_costo
with (security_invoker = true) as
select
  p.id                                  as subgrupo_id,
  p.codigo,
  p.nombre,
  coalesce(m.costo_materiales, 0)       as costo_materiales,
  coalesce(mo.costo_mano_obra, 0)       as costo_mano_obra,
  coalesce(mo.minutos, 0)               as minutos,
  coalesce(m.costo_materiales, 0) + coalesce(mo.costo_mano_obra, 0) as costo_total
from producto p
left join (
  select
    pc.producto_id,
    sum(pc.cantidad / (1 - pc.merma_pct / 100.0) * coalesce(mpc.costo_unitario_uso_con_merma, 0)) as costo_materiales
  from producto_componente pc
  join v_materia_prima_costo mpc on mpc.id = pc.materia_prima_id
  where pc.tipo = 'MATERIA_PRIMA'
  group by pc.producto_id
) m on m.producto_id = p.id
left join v_producto_mano_obra mo on mo.producto_id = p.id
where p.tipo = 'SUBGRUPO';

-- Detalle de cada línea de estructura, con su costo resuelto.
create view v_componente_detalle
with (security_invoker = true) as
select
  pc.id,
  pc.producto_id,
  pc.tipo,
  pc.orden,
  pc.cantidad,
  pc.merma_pct,
  pc.notas,
  pc.materia_prima_id,
  pc.subgrupo_id,
  coalesce(mpc.codigo, sc.codigo)                       as codigo,
  coalesce(mpc.nombre, sc.nombre)                       as nombre,
  coalesce(mpc.unidad_uso, um.codigo, 'u')              as unidad,
  mpc.proveedor,
  mpc.merma_pct                                         as merma_material_pct,
  coalesce(mpc.costo_unitario_uso_con_merma, sc.costo_total) as costo_unitario,
  pc.cantidad / (1 - pc.merma_pct / 100.0)              as cantidad_con_merma,
  pc.cantidad / (1 - pc.merma_pct / 100.0)
    * coalesce(mpc.costo_unitario_uso_con_merma, sc.costo_total) as costo_total,
  case when pc.tipo = 'MATERIA_PRIMA' and mpc.precio_compra is null then true else false end as sin_precio
from producto_componente pc
left join v_materia_prima_costo mpc on mpc.id = pc.materia_prima_id
left join v_subgrupo_costo sc      on sc.subgrupo_id = pc.subgrupo_id
left join producto sp              on sp.id = pc.subgrupo_id
left join unidad_medida um         on um.id = sp.unidad_id;

-- Costo total por producto, con apertura de materiales / mano de obra.
create view v_producto_costo
with (security_invoker = true) as
with mat_directa as (
  select
    pc.producto_id,
    sum(pc.cantidad / (1 - pc.merma_pct / 100.0) * coalesce(mpc.costo_unitario_uso_con_merma, 0)) as costo
  from producto_componente pc
  join v_materia_prima_costo mpc on mpc.id = pc.materia_prima_id
  where pc.tipo = 'MATERIA_PRIMA'
  group by pc.producto_id
),
desde_subgrupos as (
  select
    pc.producto_id,
    sum(pc.cantidad / (1 - pc.merma_pct / 100.0) * sc.costo_materiales) as costo_materiales,
    sum(pc.cantidad / (1 - pc.merma_pct / 100.0) * sc.costo_mano_obra)  as costo_mano_obra,
    sum(pc.cantidad / (1 - pc.merma_pct / 100.0) * sc.minutos)          as minutos
  from producto_componente pc
  join v_subgrupo_costo sc on sc.subgrupo_id = pc.subgrupo_id
  where pc.tipo = 'SUBGRUPO'
  group by pc.producto_id
),
base as (
  select
    p.id,
    p.codigo,
    p.nombre,
    p.tipo,
    p.activo,
    p.descripcion,
    coalesce(md.costo, 0)                    as materiales_directos,
    coalesce(ds.costo_materiales, 0)         as materiales_subgrupos,
    coalesce(mo.costo_mano_obra, 0)          as mano_obra_directa,
    coalesce(ds.costo_mano_obra, 0)          as mano_obra_subgrupos,
    coalesce(mo.minutos, 0) + coalesce(ds.minutos, 0) as minutos_totales,
    par.moneda,
    par.gastos_generales_pct,
    par.margen_pct
  from producto p
  left join mat_directa md          on md.producto_id = p.id
  left join desde_subgrupos ds      on ds.producto_id = p.id
  left join v_producto_mano_obra mo on mo.producto_id = p.id
  cross join parametro_costeo par
),
calculado as (
  select
    base.*,
    materiales_directos + materiales_subgrupos as costo_materiales,
    mano_obra_directa + mano_obra_subgrupos    as costo_mano_obra
  from base
)
select
  c.*,
  c.costo_materiales + c.costo_mano_obra as costo_directo,
  (c.costo_materiales + c.costo_mano_obra) * c.gastos_generales_pct / 100.0 as gastos_generales,
  (c.costo_materiales + c.costo_mano_obra) * (1 + c.gastos_generales_pct / 100.0) as costo_total,
  (c.costo_materiales + c.costo_mano_obra) * (1 + c.gastos_generales_pct / 100.0)
    * (1 + c.margen_pct / 100.0) as precio_sugerido
from calculado c;

-- Explosión de materiales: todas las materias primas que consume un
-- producto terminado, atravesando los subgrupos.
create view v_explosion_materiales
with (security_invoker = true) as
select
  pc.producto_id,
  null::uuid       as subgrupo_id,
  null::text       as subgrupo_nombre,
  mpc.id           as materia_prima_id,
  mpc.codigo,
  mpc.nombre,
  mpc.unidad_uso   as unidad,
  mpc.proveedor,
  pc.cantidad / (1 - pc.merma_pct / 100.0) as cantidad,
  pc.cantidad / (1 - pc.merma_pct / 100.0) * coalesce(mpc.costo_unitario_uso_con_merma, 0) as costo
from producto_componente pc
join v_materia_prima_costo mpc on mpc.id = pc.materia_prima_id
where pc.tipo = 'MATERIA_PRIMA'
union all
select
  padre.producto_id,
  sg.id            as subgrupo_id,
  sg.nombre        as subgrupo_nombre,
  mpc.id           as materia_prima_id,
  mpc.codigo,
  mpc.nombre,
  mpc.unidad_uso   as unidad,
  mpc.proveedor,
  (padre.cantidad / (1 - padre.merma_pct / 100.0)) * (hijo.cantidad / (1 - hijo.merma_pct / 100.0)) as cantidad,
  (padre.cantidad / (1 - padre.merma_pct / 100.0)) * (hijo.cantidad / (1 - hijo.merma_pct / 100.0))
    * coalesce(mpc.costo_unitario_uso_con_merma, 0) as costo
from producto_componente padre
join producto sg               on sg.id = padre.subgrupo_id
join producto_componente hijo  on hijo.producto_id = sg.id and hijo.tipo = 'MATERIA_PRIMA'
join v_materia_prima_costo mpc on mpc.id = hijo.materia_prima_id
where padre.tipo = 'SUBGRUPO';

-- Dónde se usa cada materia prima (impacto de un cambio de precio).
create view v_uso_materia_prima
with (security_invoker = true) as
select
  e.materia_prima_id,
  p.id      as producto_id,
  p.codigo  as producto_codigo,
  p.nombre  as producto_nombre,
  p.tipo    as producto_tipo,
  e.subgrupo_nombre,
  sum(e.cantidad) as cantidad,
  sum(e.costo)    as costo
from v_explosion_materiales e
join producto p on p.id = e.producto_id
group by e.materia_prima_id, p.id, p.codigo, p.nombre, p.tipo, e.subgrupo_nombre;
