-- =====================================================================
-- Charoli Gestión - Correcciones de las revisiones de compras
--
--   - guardar_comprobante_compra bloquea los remitos de compra de los
--     renglones (los nuevos y los que reemplaza) en orden de id antes de
--     tocar los renglones. Antes los bloqueaba el trigger
--     trg_comprobante_compra_item_remito renglón por renglón, en el orden
--     de los renglones, mientras facturar_remitos_compra los bloquea por
--     id: dos guardados a la vez con los mismos remitos en distinto orden
--     podían trabarse (deadlock, 40P01). El trigger sigue bloqueando (ya
--     tiene el bloqueo, no espera) y controlando el tope.
--   - confirmar_comprobante_compra: el precio de una factura con fecha
--     anterior a la del precio preferido vigente de la materia prima no
--     pasa a ser el preferido ni desplaza al vigente (el costeo volvía a
--     un precio viejo); queda como fila histórica.
--
-- Todo es create or replace: se puede volver a correr.
-- =====================================================================

-- ----- Guardar un comprobante ---------------------------------------------------

-- Igual que en 20261105000007; además, antes de borrar o insertar
-- renglones bloquea (for update, como el trigger del renglón) los remitos
-- de compra de los renglones nuevos y de los que se reemplazan, en orden
-- de id, como facturar_remitos_compra. Así dos guardados a la vez se
-- esperan en lugar de trabarse.
create or replace function public.guardar_comprobante_compra(
  p_id uuid,
  p_comprobante jsonb,
  p_items jsonb,
  p_percepciones jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_estado text;
  v_proveedor uuid := (p_comprobante->>'proveedor_id')::uuid;
  v_fecha date := coalesce(
    (p_comprobante->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_item jsonb;
  v_orden bigint;
  v_art public.proveedor_articulo;
begin
  if v_id is not null then
    select c.estado into v_estado
    from public.comprobante_compra c
    where c.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el comprobante de compra.'
        using errcode = 'CP004', hint = 'comprobante_inexistente';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El comprobante está %: no se puede modificar.', v_estado
        using errcode = 'CP001', hint = 'comprobante_inmutable';
    end if;
  end if;

  -- Los remitos de los renglones nuevos y de los que se reemplazan, en
  -- orden de id (el mismo que facturar_remitos_compra).
  perform 1
  from public.remito_compra r
  where r.id in (
    select ri.remito_compra_id
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e(item)
    join public.remito_compra_item ri on ri.id = (e.item->>'remito_compra_item_id')::uuid
    union
    select ri.remito_compra_id
    from public.comprobante_compra_item ci
    join public.remito_compra_item ri on ri.id = ci.remito_compra_item_id
    where ci.comprobante_compra_id = v_id
  )
  order by r.id
  for update;

  if v_id is not null then
    -- Primero los renglones: así la cabecera puede cambiar de proveedor o de letra.
    delete from public.comprobante_compra_item where comprobante_compra_id = v_id;
    delete from public.comprobante_compra_percepcion where comprobante_compra_id = v_id;

    update public.comprobante_compra
    set proveedor_id = v_proveedor,
        tipo = p_comprobante->>'tipo',
        letra = p_comprobante->>'letra',
        punto_venta = (p_comprobante->>'punto_venta')::integer,
        numero = (p_comprobante->>'numero')::bigint,
        fecha = v_fecha,
        fecha_vencimiento = (p_comprobante->>'fecha_vencimiento')::date,
        observaciones = p_comprobante->>'observaciones',
        comprobante_asociado_id = (p_comprobante->>'comprobante_asociado_id')::uuid
    where id = v_id;
  else
    insert into public.comprobante_compra (
      proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones,
      comprobante_asociado_id
    )
    values (
      v_proveedor,
      p_comprobante->>'tipo',
      p_comprobante->>'letra',
      (p_comprobante->>'punto_venta')::integer,
      (p_comprobante->>'numero')::bigint,
      v_fecha,
      (p_comprobante->>'fecha_vencimiento')::date,
      p_comprobante->>'observaciones',
      (p_comprobante->>'comprobante_asociado_id')::uuid
    )
    returning id into v_id;
  end if;

  for v_item, v_orden in
    select e.item, e.orden from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden)
  loop
    v_art := public.fn_compras_articulo(v_proveedor, v_item);

    insert into public.comprobante_compra_item (
      comprobante_compra_id, orden, proveedor_articulo_id, codigo_proveedor, descripcion, unidad,
      cantidad, precio_unitario, descuento_pct, alicuota_iva, exento, remito_compra_item_id
    )
    values (
      v_id,
      (v_orden - 1)::integer,
      v_art.id,
      coalesce(nullif(v_item->>'codigo_proveedor', ''), v_art.codigo),
      -- Tal cual la escribió el proveedor (sin recortar); en blanco, la del artículo.
      coalesce(case when btrim(v_item->>'descripcion') <> '' then v_item->>'descripcion' end,
               v_art.descripcion, v_item->>'descripcion'),
      coalesce(nullif(v_item->>'unidad', ''), v_art.unidad),
      (v_item->>'cantidad')::numeric,
      coalesce((v_item->>'precio_unitario')::numeric, 0),
      coalesce((v_item->>'descuento_pct')::numeric, 0),
      (v_item->>'alicuota_iva')::numeric,
      coalesce((v_item->>'exento')::boolean, false),
      (v_item->>'remito_compra_item_id')::uuid
    );
  end loop;

  insert into public.comprobante_compra_percepcion (comprobante_compra_id, tipo, jurisdiccion, descripcion, importe)
  select
    v_id,
    e.p->>'tipo',
    nullif(btrim(e.p->>'jurisdiccion'), ''),
    nullif(btrim(e.p->>'descripcion'), ''),
    (e.p->>'importe')::numeric
  from jsonb_array_elements(coalesce(p_percepciones, '[]'::jsonb)) as e(p);

  return v_id;
end;
$$;

comment on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) is
  'Crea o actualiza un comprobante de compra en borrador (con su factura asociada, si es una nota, y el renglón de remito de cada renglón) y reemplaza sus renglones y percepciones; da de alta en el catálogo los artículos nuevos. Bloquea los remitos de los renglones en orden de id. Devuelve el id';

-- ----- Confirmar ---------------------------------------------------------

-- Igual que en 20261105000006; el precio nuevo no pasa a ser el preferido
-- si el preferido vigente tiene vigente_desde posterior a la fecha de la
-- factura (una factura del mismo día sí lo reemplaza).
create or replace function public.confirmar_comprobante_compra(
  p_id uuid,
  p_actualizar_precios uuid[] default '{}'
)
returns public.comprobante_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.comprobante_compra;
  v_descripcion text;
  v_observaciones text;
  v_precio record;
  v_preferido boolean;
begin
  select * into v_c
  from public.comprobante_compra c
  where c.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el comprobante de compra.'
      using errcode = 'CP004', hint = 'comprobante_inexistente';
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'Sólo se confirma un comprobante en borrador (el comprobante está %).', v_c.estado
      using errcode = 'CP002', hint = 'transicion_invalida';
  end if;
  -- Las notas no cambian precios de costeo: sólo las facturas.
  if v_c.tipo <> 'factura' and cardinality(coalesce(p_actualizar_precios, '{}')) > 0 then
    raise exception 'Las notas de crédito y débito no actualizan precios de materias primas.'
      using errcode = 'CP013', hint = 'nota_sin_precios';
  end if;
  if not exists (select 1 from public.comprobante_compra_item i where i.comprobante_compra_id = v_c.id) then
    raise exception 'El comprobante no tiene renglones.'
      using errcode = 'CP005', hint = 'comprobante_sin_items';
  end if;

  select i.descripcion into v_descripcion
  from public.comprobante_compra_item i
  join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
  where i.comprobante_compra_id = v_c.id and a.materia_prima_id is null
  order by i.orden
  limit 1;
  if found then
    raise exception 'El artículo "%" no tiene materia prima asociada.', v_descripcion
      using errcode = 'CP007', hint = 'articulo_sin_materia_prima';
  end if;

  -- El trigger del renglón copia la materia prima vigente del artículo.
  update public.comprobante_compra_item i
  set materia_prima_id = a.materia_prima_id
  from public.proveedor_articulo a
  where a.id = i.proveedor_articulo_id
    and i.comprobante_compra_id = v_c.id
    and i.materia_prima_id is distinct from a.materia_prima_id;

  select * into v_c from public.comprobante_compra c where c.id = p_id;
  if v_c.total <= 0 then
    raise exception 'El total del comprobante tiene que ser mayor que cero.'
      using errcode = 'CP006', hint = 'total_no_positivo';
  end if;

  -- El trigger sólo deja pasar a confirmado con esta marca de la transacción.
  perform set_config('compras.confirmando', v_c.id::text, true);
  update public.comprobante_compra
  set estado = 'confirmado',
      confirmado_en = now()
  where id = v_c.id
  returning * into v_c;
  perform set_config('compras.confirmando', '', true);

  -- ----- Precios elegidos ------------------------------------------------
  p_actualizar_precios := coalesce(p_actualizar_precios, '{}');

  if exists (
    select 1
    from unnest(p_actualizar_precios) as e(item_id)
    where not exists (
      select 1 from public.precios_comprobante_compra(v_c.id) p
      where p.comprobante_compra_item_id = e.item_id
    )
  ) then
    raise exception 'Sólo se actualiza el precio de un renglón del comprobante con materia prima.'
      using errcode = 'CP010', hint = 'renglon_sin_precio';
  end if;

  select p.materia_prima_nombre into v_descripcion
  from public.precios_comprobante_compra(v_c.id) p
  where p.comprobante_compra_item_id = any (p_actualizar_precios)
  group by p.materia_prima_id, p.materia_prima_nombre
  having count(*) > 1
  limit 1;
  if found then
    raise exception 'Elegiste dos renglones de "%": el precio se actualiza con uno solo.', v_descripcion
      using errcode = 'CP011', hint = 'materia_prima_repetida';
  end if;

  v_observaciones := 'Compra '
    || case v_c.tipo when 'factura' then 'FC' when 'nota_credito' then 'NC' else 'ND' end
    || ' ' || v_c.letra || ' '
    || lpad(v_c.punto_venta::text, 5, '0') || '-' || lpad(v_c.numero::text, 8, '0');

  for v_precio in
    select p.materia_prima_id, p.precio_factura
    from public.precios_comprobante_compra(v_c.id) p
    where p.comprobante_compra_item_id = any (p_actualizar_precios)
  loop
    -- Preferido: si era de este proveedor o no había, pasa al precio nuevo.
    -- Con una factura de fecha anterior a la del preferido vigente, el
    -- precio nuevo queda como histórico y el preferido no cambia.
    v_preferido := not exists (
      select 1 from public.precio_materia_prima pr
      where pr.materia_prima_id = v_precio.materia_prima_id
        and pr.es_preferido
        and (pr.proveedor_id is distinct from v_c.proveedor_id or pr.vigente_desde > v_c.fecha)
    );
    if v_preferido then
      update public.precio_materia_prima
      set es_preferido = false
      where materia_prima_id = v_precio.materia_prima_id
        and es_preferido;
    end if;

    insert into public.precio_materia_prima
      (materia_prima_id, proveedor_id, precio, incluye_iva, vigente_desde, es_preferido, observaciones)
    values
      (v_precio.materia_prima_id, v_c.proveedor_id, v_precio.precio_factura, false, v_c.fecha, v_preferido, v_observaciones);
  end loop;

  return v_c;
end;
$$;

comment on function public.confirmar_comprobante_compra(uuid, uuid[]) is
  'Confirma un comprobante de compra en borrador (con renglones, total mayor que cero y artículos con materia prima) y, si es una factura, carga el precio de los renglones elegidos (como preferido salvo que el preferido sea de otro proveedor o de fecha posterior a la factura). Devuelve el comprobante';

-- ----- Permisos -----------------------------------------------------------------

-- create or replace conserva los permisos; se repiten por claridad.
revoke execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.confirmar_comprobante_compra(uuid, uuid[]) from public, anon;
grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.confirmar_comprobante_compra(uuid, uuid[]) to authenticated;
