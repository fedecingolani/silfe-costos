-- =====================================================================
-- Charoli Gestión - Actualización de precios al confirmar una compra
--
-- Al confirmar un comprobante de compra se puede actualizar, renglón por
-- renglón, el precio de la materia prima con el de la factura. Nada se
-- actualiza solo: la app muestra la comparación y el usuario elige, para
-- que un precio raro (una oferta, un error de tipeo) no llegue al costeo.
--
-- precios_comprobante_compra(id): una fila por renglón con materia prima
-- (los renglones libres no aparecen; la materia prima es la vigente del
-- artículo, la misma que tomará el renglón al confirmar). Sirve también
-- para un borrador:
--   - precio_factura: precio unitario con el descuento, dividido por el
--     factor de conversión del artículo (cuántas unidades de compra de la
--     materia prima trae una unidad del proveedor), a 4 decimales como
--     precio_materia_prima.precio. Se parte del precio unitario y no de
--     importe / cantidad para no arrastrar el redondeo a centavos del
--     importe. En A y M el precio es sin IVA; en B y C ya incluye el IVA,
--     que no se computa como crédito, así que es el costo real y se toma
--     tal cual;
--   - precio_vigente: el precio del proveedor para esa materia prima a la
--     fecha del comprobante (el de vigente_desde más reciente hasta esa
--     fecha; a igual fecha, el último cargado). Vacío si no tiene;
--   - cambio: no hay precio vigente o es distinto del de la factura.
--
-- confirmar_comprobante_compra(id, renglones): confirma como antes y,
-- en la misma transacción, carga un precio por cada renglón elegido: del
-- proveedor del comprobante, sin IVA, vigente desde la fecha del
-- comprobante y con el número en observaciones. Si algo falla, el
-- comprobante no queda confirmado. El nuevo precio es el preferido de la
-- materia prima cuando el preferido era de ese mismo proveedor o cuando
-- no había preferido (como la carga a mano, que lo marca por defecto); si
-- el preferido es de otro proveedor, lo respeta. El preferido anterior
-- deja de serlo, así hay uno solo (precio_mp_preferido_uq).
--
-- Errores nuevos (siguen la lista de 20261105000003):
--   CP010 renglon_sin_precio           (el renglón elegido no es del
--                                       comprobante o no tiene materia prima)
--   CP011 materia_prima_repetida       (dos renglones elegidos con la
--                                       misma materia prima)
-- =====================================================================

-- ----- Vista previa ------------------------------------------------------

create or replace function public.precios_comprobante_compra(p_id uuid)
returns table (
  comprobante_compra_item_id uuid,
  orden                      integer,
  descripcion                text,
  materia_prima_id           uuid,
  materia_prima_codigo       text,
  materia_prima_nombre       text,
  unidad_compra              text,
  precio_factura             numeric(18,4),
  precio_vigente             numeric(18,4),
  incluye_iva                boolean,
  cambio                     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    r.orden,
    r.descripcion,
    r.materia_prima_id,
    r.codigo,
    r.nombre,
    r.unidad_compra,
    r.precio_factura,
    v.precio,
    v.incluye_iva,
    v.precio is null or v.precio <> r.precio_factura
  from (
    select
      i.id,
      i.orden,
      i.descripcion,
      mp.id as materia_prima_id,
      mp.codigo,
      mp.nombre,
      u.codigo as unidad_compra,
      round(i.precio_unitario * (1 - i.descuento_pct / 100) / a.factor_conversion, 4)::numeric(18,4) as precio_factura,
      c.proveedor_id,
      c.fecha
    from public.comprobante_compra c
    join public.comprobante_compra_item i on i.comprobante_compra_id = c.id
    join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
    join public.materia_prima mp on mp.id = a.materia_prima_id
    join public.unidad_medida u on u.id = mp.unidad_compra_id
    where c.id = p_id
  ) r
  left join lateral (
    select p.precio, p.incluye_iva
    from public.precio_materia_prima p
    where p.materia_prima_id = r.materia_prima_id
      and p.proveedor_id = r.proveedor_id
      and p.vigente_desde <= r.fecha
    order by p.vigente_desde desc, p.creado_en desc
    limit 1
  ) v on true
  order by r.orden, r.id;
$$;

comment on function public.precios_comprobante_compra(uuid) is
  'Por renglón con materia prima: precio de la factura por unidad de compra (sin IVA en A y M), precio vigente del proveedor a la fecha del comprobante y si cambió';

-- ----- Confirmar ---------------------------------------------------------

-- Se reemplaza la versión de un argumento: con el default, una llamada
-- con sólo el id sigue funcionando y no hay dos funciones que elegir.
drop function public.confirmar_comprobante_compra(uuid);

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
    v_preferido := not exists (
      select 1 from public.precio_materia_prima pr
      where pr.materia_prima_id = v_precio.materia_prima_id
        and pr.es_preferido
        and pr.proveedor_id is distinct from v_c.proveedor_id
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
  'Confirma un comprobante de compra en borrador (con renglones, total mayor que cero y artículos con materia prima) y carga el precio de la factura de los renglones elegidos. Devuelve el comprobante';

revoke execute on function public.precios_comprobante_compra(uuid) from public, anon;
revoke execute on function public.confirmar_comprobante_compra(uuid, uuid[]) from public, anon;
grant execute on function public.precios_comprobante_compra(uuid) to authenticated;
grant execute on function public.confirmar_comprobante_compra(uuid, uuid[]) to authenticated;
