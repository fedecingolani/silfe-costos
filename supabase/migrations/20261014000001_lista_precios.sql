-- =====================================================================
-- Silfe Costos - Listas de precios (Fase 2)
-- Tope de la alícuota de IVA, tablas de listas con la foto de cada ítem,
-- vista con las filas de partida de una lista nueva y función que guarda
-- una lista completa en una sola transacción.
-- Las listas guardadas son inmutables: para corregir una, se duplica.
-- La RLS y los permisos de las tablas están en 20261014000002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tope de la alícuota de IVA del producto
-- ---------------------------------------------------------------------

alter table producto
  add constraint producto_alicuota_iva_maxima check (alicuota_iva <= 100);

-- ---------------------------------------------------------------------
-- Listas de precios
-- ---------------------------------------------------------------------

create table lista_precio (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (btrim(nombre) <> ''),
  titulo      text,
  notas       text,
  creado_en   timestamptz not null default now(),
  creado_por  uuid default auth.uid()
);

comment on table lista_precio is
  'Lista de precios guardada. Inmutable: no se modifica ni se borra; para corregirla se duplica';
comment on column lista_precio.nombre is 'Nombre interno de la lista, para el índice';
comment on column lista_precio.titulo is
  'Encabezado que se imprime en la lista (ej. "LISTA DE PRECIOS DICIEMBRE 2023")';
comment on column lista_precio.notas is 'Notas libres de la lista';
comment on column lista_precio.creado_por is 'Usuario que guardó la lista (auth.uid())';

create table lista_precio_item (
  id               uuid primary key default gen_random_uuid(),
  lista_id         uuid not null references lista_precio(id) on delete restrict,
  orden            int not null,
  es_repuesto      boolean not null default false,
  producto_id      uuid references producto(id) on delete set null,
  codigo           text,
  descripcion      text not null check (btrim(descripcion) <> ''),
  presentacion     text,
  alicuota_iva     numeric(5,2) not null default 21
                   constraint lista_precio_item_alicuota_iva_rango
                   check (alicuota_iva >= 0 and alicuota_iva <= 100),
  precio_sugerido  numeric,
  precio_final     numeric not null check (precio_final >= 0),
  unique (lista_id, orden)
);

create index lista_precio_item_producto_idx on lista_precio_item (producto_id);

comment on table lista_precio_item is
  'Ítem de una lista de precios. Guarda una foto de los datos al crear la lista, no una referencia viva';
comment on column lista_precio_item.orden is 'Posición del ítem en la lista impresa';
comment on column lista_precio_item.es_repuesto is
  'Verdadero para los subgrupos que se listan como repuesto debajo de un producto o al final';
comment on column lista_precio_item.producto_id is
  'Producto de origen. Vacío en los ítems manuales o si el producto se borró después';
comment on column lista_precio_item.codigo is 'Código copiado al crear la lista (opcional en los manuales)';
comment on column lista_precio_item.descripcion is 'Descripción copiada al crear la lista, editable antes de guardar';
comment on column lista_precio_item.presentacion is
  'Nombre de la unidad de la presentación de venta (ej. Docena), copiado al crear la lista';
comment on column lista_precio_item.alicuota_iva is 'Alícuota de IVA en porcentaje, copiada al crear la lista';
comment on column lista_precio_item.precio_sugerido is
  'Precio de la presentación calculado al crear la lista, sin redondear. Vacío en los ítems manuales';
comment on column lista_precio_item.precio_final is 'Precio que se publica en la lista, sin IVA';

-- ---------------------------------------------------------------------
-- Filas de partida de una lista nueva, en el orden de impresión:
--   1. cada TERMINADO activo, por código, seguido de los SUBGRUPO activos
--      que usa (por código), marcados como repuesto. Un subgrupo usado por
--      varios terminados aparece debajo de cada uno;
--   2. al final, los SUBGRUPO activos que no usa ningún TERMINADO activo.
-- ---------------------------------------------------------------------

create view v_lista_precio_base
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
  ceil(c.precio_presentacion / 100) * 100   as precio_redondeado
from filas f
join producto p                on p.id = f.producto_id
left join v_producto_costo c   on c.id = p.id
left join unidad_medida um     on um.id = coalesce(p.unidad_venta_id, p.unidad_id)
order by orden;

comment on view v_lista_precio_base is
  'Filas de partida para una lista de precios nueva, en el orden de impresión, con el precio de la presentación y su redondeo a la centena';
comment on column v_lista_precio_base.padre_producto_id is
  'TERMINADO debajo del cual se lista el repuesto. Vacío en los productos y en los otros repuestos';
comment on column v_lista_precio_base.precio_sugerido is 'precio_presentacion de v_producto_costo, sin redondear';
comment on column v_lista_precio_base.precio_redondeado is 'precio_sugerido redondeado hacia arriba a la centena';

-- ---------------------------------------------------------------------
-- Guardado atómico de una lista
-- ---------------------------------------------------------------------

-- p_items es un arreglo de objetos con: orden (opcional, por defecto la
-- posición en el arreglo), es_repuesto, producto_id, codigo, descripcion,
-- presentacion, alicuota_iva (21 por defecto), precio_sugerido y
-- precio_final. Los datos de los ítems de producto se guardan tal como
-- llegan: son la foto que el usuario revisó y editó en pantalla.
--
-- security definer: los usuarios autenticados no tienen permiso de
-- insert sobre las tablas, así que esta función es la única vía para
-- crear una lista. Por eso search_path vacío y nombres calificados.
create or replace function public.crear_lista_precio(
  p_nombre text,
  p_titulo text,
  p_notas  text,
  p_items  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista_id  uuid;
  v_item      jsonb;
  v_posicion  bigint;
begin
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'La lista necesita un nombre';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La lista necesita al menos un ítem';
  end if;

  for v_item, v_posicion in
    select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality as e
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'El ítem % no es válido', v_posicion;
    end if;

    if coalesce(btrim(v_item ->> 'descripcion'), '') = '' then
      raise exception 'El ítem % necesita una descripción', v_posicion;
    end if;

    if v_item ->> 'precio_final' is null or (v_item ->> 'precio_final')::numeric < 0 then
      raise exception 'El ítem % necesita un precio final mayor o igual a 0', v_posicion;
    end if;
  end loop;

  insert into public.lista_precio (nombre, titulo, notas)
  values (btrim(p_nombre), nullif(btrim(p_titulo), ''), nullif(btrim(p_notas), ''))
  returning id into v_lista_id;

  insert into public.lista_precio_item (
    lista_id, orden, es_repuesto, producto_id, codigo, descripcion,
    presentacion, alicuota_iva, precio_sugerido, precio_final
  )
  select
    v_lista_id,
    coalesce((e.value ->> 'orden')::int, e.ordinality::int),
    coalesce((e.value ->> 'es_repuesto')::boolean, false),
    (e.value ->> 'producto_id')::uuid,
    nullif(btrim(e.value ->> 'codigo'), ''),
    btrim(e.value ->> 'descripcion'),
    nullif(btrim(e.value ->> 'presentacion'), ''),
    coalesce((e.value ->> 'alicuota_iva')::numeric, 21),
    (e.value ->> 'precio_sugerido')::numeric,
    (e.value ->> 'precio_final')::numeric
  from jsonb_array_elements(p_items) with ordinality as e;

  return v_lista_id;
end;
$$;

comment on function public.crear_lista_precio(text, text, text, jsonb) is
  'Guarda una lista de precios y todos sus ítems en una sola transacción: o se guarda todo o nada';

revoke execute on function public.crear_lista_precio(text, text, text, jsonb) from public, anon;
grant execute on function public.crear_lista_precio(text, text, text, jsonb) to authenticated;
