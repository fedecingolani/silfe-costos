-- =====================================================================
-- Silfe Costos - Datos de venta del producto
-- Alícuota de IVA y presentación de venta (ej. "x docena"), y precio por
-- presentación expuesto desde la vista de costeo.
-- Los valores por defecto dejan a los productos existentes igual que
-- antes: IVA 21, factor 1 y unidad de venta igual a la de costeo.
-- =====================================================================

alter table producto
  add column alicuota_iva     numeric(5,2)  not null default 21 check (alicuota_iva >= 0),
  add column unidad_venta_id  uuid references unidad_medida(id),
  add column factor_venta     numeric(18,6) not null default 1 check (factor_venta > 0);

comment on column producto.alicuota_iva is
  'Alícuota de IVA en porcentaje (ej. 10.5 o 21). El precio sugerido es sin IVA';
comment on column producto.unidad_venta_id is
  'Unidad de la presentación de venta (ej. docena). Vacía significa igual a unidad_id (unidad de costeo)';
comment on column producto.factor_venta is
  'Cantidad de unidades de costeo por presentación de venta. Costeado y vendido por docena: 1; costeado por unidad y vendido por docena: 12';

-- ---------------------------------------------------------------------
-- Vista de costeo: se agregan columnas al final (create or replace view
-- no permite reordenar ni renombrar las existentes).
-- ---------------------------------------------------------------------

create or replace view v_producto_costo
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
),
precio as (
  select
    c.*,
    c.costo_materiales + c.costo_mano_obra as costo_directo,
    (c.costo_materiales + c.costo_mano_obra) * c.gastos_generales_pct / 100.0 as gastos_generales,
    (c.costo_materiales + c.costo_mano_obra) * (1 + c.gastos_generales_pct / 100.0) as costo_total,
    (c.costo_materiales + c.costo_mano_obra) * (1 + c.gastos_generales_pct / 100.0)
      * (1 + c.margen_pct / 100.0) as precio_sugerido
  from calculado c
)
select
  pr.*,
  -- datos de venta (agregados en 20261013000001)
  p.alicuota_iva,
  coalesce(p.unidad_venta_id, p.unidad_id) as unidad_venta_id,
  p.factor_venta,
  pr.precio_sugerido * p.factor_venta      as precio_presentacion
from precio pr
join producto p on p.id = pr.id;

-- Se reafirma que la vista es de sólo lectura (los permisos se conservan
-- al reemplazarla, pero así queda explícito junto al cambio).
revoke insert, update, delete on v_producto_costo from authenticated;

-- La docena es la presentación de venta más común. Se agrega también acá (además
-- del seed) para que exista en el proyecto remoto, que no corre el seed.
insert into unidad_medida (codigo, nombre, magnitud) values
  ('doc', 'Docena', 'UNIDAD')
on conflict (codigo) do nothing;
