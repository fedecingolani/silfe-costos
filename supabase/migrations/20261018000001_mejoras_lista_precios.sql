-- =====================================================================
-- Silfe Costos - Mejoras de listas de precios
-- 1. Un producto usado en una lista guardada ya no se puede borrar: la FK
--    lista_precio_item.producto_id pasa de "on delete set null" a
--    "on delete restrict". Con set null, borrar un producto reescribía
--    listas que son inmutables. Para sacarlo de las listas nuevas, se
--    desactiva.
-- 2. crear_lista_precio rechaza precios NaN o infinitos (numeric los
--    acepta y NaN no es menor a 0) y un precio sugerido negativo. Se
--    recrea con la misma firma, security definer, search_path y permisos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- FK del producto de un ítem
-- ---------------------------------------------------------------------

alter table public.lista_precio_item
  drop constraint lista_precio_item_producto_id_fkey;

alter table public.lista_precio_item
  add constraint lista_precio_item_producto_id_fkey
  foreign key (producto_id) references public.producto(id) on delete restrict;

comment on column public.lista_precio_item.producto_id is
  'Producto de origen. Vacío en los ítems manuales. Un producto usado en una lista no se puede borrar: se desactiva';

-- ---------------------------------------------------------------------
-- Guardado atómico de una lista, con validación de precios no finitos
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
  v_final     numeric;
  v_sugerido  numeric;
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

    v_final := (v_item ->> 'precio_final')::numeric;
    if v_final is null or v_final < 0
       or v_final in ('NaN'::numeric, 'Infinity'::numeric) then
      raise exception 'El ítem % necesita un precio final mayor o igual a 0', v_posicion;
    end if;

    v_sugerido := (v_item ->> 'precio_sugerido')::numeric;
    if v_sugerido is not null
       and (v_sugerido < 0 or v_sugerido in ('NaN'::numeric, 'Infinity'::numeric)) then
      raise exception 'El ítem % tiene un precio sugerido inválido: tiene que ser un número mayor o igual a 0', v_posicion;
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
