-- =====================================================================
-- Charoli Gestión - API de compras: CAE y origen al guardar
--
-- guardar_comprobante_compra (última versión: 20261105000009) lee además de
-- p_comprobante:
--   - cae y cae_vencimiento: al crear, se guardan (vacío: null). Al
--     actualizar un borrador sólo cambian si p_comprobante trae la clave;
--     la pantalla no las manda, así que editar un borrador que vino por la
--     API conserva su CAE;
--   - origen ('manual' | 'api'): sólo al crear; sin la clave es 'manual'.
--     Al actualizar no cambia.
-- Lo demás, sin cambios. La API (POST /api/v1/comprobantes-compra) la
-- llama con la service-role key (permisos en 20261106000006).
-- =====================================================================

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
        comprobante_asociado_id = (p_comprobante->>'comprobante_asociado_id')::uuid,
        -- La pantalla no manda el CAE: sin la clave, se conserva.
        cae = case when p_comprobante ? 'cae' then nullif(btrim(p_comprobante->>'cae'), '') else cae end,
        cae_vencimiento = case when p_comprobante ? 'cae_vencimiento'
                               then (p_comprobante->>'cae_vencimiento')::date else cae_vencimiento end
    where id = v_id;
  else
    insert into public.comprobante_compra (
      proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones,
      comprobante_asociado_id, cae, cae_vencimiento, origen
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
      (p_comprobante->>'comprobante_asociado_id')::uuid,
      nullif(btrim(p_comprobante->>'cae'), ''),
      (p_comprobante->>'cae_vencimiento')::date,
      coalesce(p_comprobante->>'origen', 'manual')
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

comment on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) is
  'Crea o actualiza un comprobante de compra en borrador (con su factura asociada, si es una nota, el renglón de remito de cada renglón, CAE y origen) y reemplaza sus renglones y percepciones; da de alta en el catálogo los artículos nuevos. Bloquea los remitos de los renglones en orden de id. Devuelve el id';

-- create or replace conserva los permisos; se repiten por claridad.
revoke execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
